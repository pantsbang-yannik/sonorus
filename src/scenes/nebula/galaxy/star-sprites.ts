// 光点星（视觉重做 spec §3.1）：全星单 draw call 实例化辉光广告牌。
// 贴图=锐核+光晕+淡十字星芒（离屏 canvas 单例，惯例同 accents.ts glowTexture）。
// TSL 纪律：SpriteNodeMaterial 顶点管线禁内置 positionView；uniform 字段禁显式类型注解（M2/M3-conclusions）。
import * as THREE from 'three/webgpu'
import { instancedBufferAttribute, instanceIndex, texture, uniform, uv, vec2, float, hash } from 'three/tsl'
import type { GalaxyStar } from './types'
import type { StarPlacement } from './layout'
import { starWeight } from './star-field'

// ===== 亲验旋钮 =====
export const SIZE_BASE = 0.05        // 世界单位，1 次星的光晕直径基数
export const SIZE_PER_W = 0.026      // 尺寸随权重增量（亲验调参一轮：封面阈值抬高后光点星要立得住）
export const BRIGHT_BASE = 0.38      // 亮度下限（1 次星也看得见；亲验调参一轮增亮）
export const BRIGHT_PER_W = 0.18     // 亮度随权重增量
export const BRIGHT_GAMMA = 1.35     // >1 非线性拉开明暗层次（听得多的星显著更亮）
export const DIM_FACTOR = 0.12       // 筛选未命中调暗（V1 语义迁移）
export const DEFAULT_TINT: [number, number, number] = [0.55, 0.65, 1.0] // 无封面星默认星色（V1 迁移）
export const REVEAL_RATE = 3         // 进场淡入指数趋近速率（~1s 到位）
export const TWINKLE_AMP = 0.08      // 微闪烁幅度（亲验不好看就归 0）
export const TWINKLE_SPEED = 1.7     // 微闪烁角速度
const STAR_TEX_SIZE = 128

export function starSize(w: number): number { return SIZE_BASE + SIZE_PER_W * w }

export function starBrightness(w: number): number {
  return Math.min(1, BRIGHT_BASE + BRIGHT_PER_W * Math.pow(Math.max(0, w - 1), BRIGHT_GAMMA) * 0.45)
}

export interface StarInstances { positions: Float32Array; colors: Float32Array; sizes: Float32Array }

export function buildStarInstances(stars: GalaxyStar[], placements: StarPlacement[]): StarInstances {
  const n = stars.length
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = starWeight(stars[i].playCount)
    const tint = stars[i].tint ?? DEFAULT_TINT
    const bright = starBrightness(w)
    positions[i * 3] = placements[i].x
    positions[i * 3 + 1] = placements[i].y
    positions[i * 3 + 2] = placements[i].z
    colors[i * 3] = tint[0] * bright
    colors[i * 3 + 1] = tint[1] * bright
    colors[i * 3 + 2] = tint[2] * bright
    sizes[i] = starSize(w)
  }
  return { positions, colors, sizes }
}

export function computeDims(stars: GalaxyStar[], activeKeys: Set<string> | null): Float32Array {
  const dims = new Float32Array(stars.length)
  for (let i = 0; i < stars.length; i++) {
    dims[i] = activeKeys !== null && !activeKeys.has(stars[i].key) ? DIM_FACTOR : 1
  }
  return dims
}

let sharedStarTex: THREE.CanvasTexture | null = null
/** 星贴图：锐核（内 12% 纯白）+ 指数感光晕 + 两道淡十字星芒；离屏 canvas 单例。
 * export 供 accents 辉光类（脉动/hover/诞生）共用（fb2：旧纯白径向渐变糙团退役，辉光与星同一质感） */
export function starTexture(): THREE.CanvasTexture {
  if (sharedStarTex) return sharedStarTex
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = STAR_TEX_SIZE
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const r = STAR_TEX_SIZE / 2
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.12, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.30)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.07)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, STAR_TEX_SIZE, STAR_TEX_SIZE)
    // 淡十字星芒：水平/垂直两道细线性渐变，additive 叠加
    ctx.globalCompositeOperation = 'lighter'
    for (const horizontal of [true, false]) {
      const g = horizontal
        ? ctx.createLinearGradient(0, r, STAR_TEX_SIZE, r)
        : ctx.createLinearGradient(r, 0, r, STAR_TEX_SIZE)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, 'rgba(255,255,255,0.22)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      if (horizontal) ctx.fillRect(0, r - 1.5, STAR_TEX_SIZE, 3)
      else ctx.fillRect(r - 1.5, 0, 3, STAR_TEX_SIZE)
    }
  }
  sharedStarTex = new THREE.CanvasTexture(canvas)
  return sharedStarTex
}

/** 指数趋近（惯例同 accents.ts approach） */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

export class GalaxyStarSprites {
  readonly group = new THREE.Group()
  private mesh: THREE.InstancedMesh | null = null
  private aDim: THREE.InstancedBufferAttribute | null = null
  // uniform 字段禁显式类型注解（M2 坑）
  private readonly uReveal = uniform(0)
  private readonly uTime = uniform(0)
  private revealValue = 0
  private revealTarget = 1
  private time = 0

  /** 重建全部实例（进场/星集变化各一次；旧网格就地释放） */
  build(stars: GalaxyStar[], placements: StarPlacement[]): void {
    this.disposeMesh()
    const n = stars.length
    if (n === 0) return
    const inst = buildStarInstances(stars, placements)
    const geo = new THREE.PlaneGeometry(1, 1)
    const aPos = new THREE.InstancedBufferAttribute(inst.positions, 3)
    const aCol = new THREE.InstancedBufferAttribute(inst.colors, 3)
    const aSize = new THREE.InstancedBufferAttribute(inst.sizes, 1)
    this.aDim = new THREE.InstancedBufferAttribute(computeDims(stars, null), 1)
    geo.setAttribute('aStarPos', aPos)
    geo.setAttribute('aStarCol', aCol)
    geo.setAttribute('aStarSize', aSize)
    geo.setAttribute('aStarDim', this.aDim)
    // 实例化广告牌：先例 particles.ts:404-460（InstancedMesh + SpriteNodeMaterial）
    const mat = new THREE.SpriteNodeMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    // TSL 类型对不齐（@types/three）：instancedBufferAttribute(arr, 'vec3') 里字面量参数只用于推断值，
    // TNodeType 泛型仍从调用点整体推宽成 string（Node<string>），下游 .mul() 链因此塌成 never——
    // 显式传类型实参 instancedBufferAttribute<'vec3'>(...) 钉住字面量，运行时行为不变（惯例同 sky.ts sampleDir 的 any 退让）
    const posN = instancedBufferAttribute<'vec3'>(aPos, 'vec3')
    const colN = instancedBufferAttribute<'vec3'>(aCol, 'vec3')
    const sizeN = instancedBufferAttribute<'float'>(aSize, 'float')
    const dimN = instancedBufferAttribute<'float'>(this.aDim, 'float')
    mat.positionNode = posN
    mat.scaleNode = vec2(sizeN, sizeN)
    // 微闪烁：per-star 哈希相位缓慢呼吸（hash 只吃标量种子——instanceIndex 合规）
    const twinkle = float(1).add(
      float(TWINKLE_AMP).mul(hash(instanceIndex).mul(6.2832).add(this.uTime.mul(TWINKLE_SPEED)).sin())
    )
    // additive 混合因子为 srcAlpha/ONE，本材质输出 alpha 恒 1，故形状衰减必须折进 colorNode（贴图形状在 alpha 通道）。
    const texN = texture(starTexture(), uv())
    mat.colorNode = texN.rgb.mul(texN.a).mul(colN).mul(dimN).mul(this.uReveal).mul(twinkle)
    this.mesh = new THREE.InstancedMesh(geo, mat, n)
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)
  }

  /** 筛选调暗：只改实例属性，不重建（spec §3.1「筛选变化不再重烘」） */
  setFilterDim(stars: GalaxyStar[], activeKeys: Set<string> | null): void {
    if (!this.aDim) return
    ;(this.aDim.array as Float32Array).set(computeDims(stars, activeKeys))
    this.aDim.needsUpdate = true
  }

  setRevealed(v: boolean): void { this.revealTarget = v ? 1 : 0 }
  /** mount 时归零：星 sprite 在 morph 落定后从黑淡入（spec §3.2） */
  resetReveal(): void { this.revealValue = 0; this.uReveal.value = 0; this.revealTarget = 1 }

  update(dt: number): void {
    this.time += dt
    this.uTime.value = this.time
    this.revealValue = approach(this.revealValue, this.revealTarget, REVEAL_RATE, dt)
    this.uReveal.value = this.revealValue
  }

  private disposeMesh(): void {
    if (!this.mesh) return
    this.group.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = null
    this.aDim = null
  }

  dispose(): void {
    this.disposeMesh()
    // 共享星贴图不 dispose：模块级单例（惯例同 accents 辉光贴图）
  }
}
