// 歌词粒子渲染类（spec §5.4）：模板 = title-particles.ts（instancedArray CPU 写入 +
// SpriteNodeMaterial additive + 每粒固定散射向量），差异 = 双 targets 缓冲 + uMix 字变字 morph。
// uniform（spread/fade/mix）全由 LyricsFxProgram 输出、本类纯消费——不做任何调度判断。
// 独立实例不与歌名类共享（uniform 互不相踩，两组设置各管各的）。
import * as THREE from 'three/webgpu'
import { uniform, uv, vec3, mix, smoothstep, saturate, float, hash, instanceIndex, instancedArray } from 'three/tsl'
import type { ShapePointCloud } from '../cover-points'
import { padPositions } from './lyric-points'

const SCATTER_DIST = 1.2 // 同 title：uSpread=1 时最大散布半径（世界单位）
const VISIBLE_EPS = 0.002
/** 朝向缓跟随时间常数（秒）：亲验 fb3 §C 推翻「出生定格看侧面」拍板——镜头环绕大角度后
 * 文字读作斜线切过画面。0.8s 阻尼=永远基本面向镜头，又保留轻微角度漂移的空间感（非硬 billboard） */
const ORIENT_TAU = 0.8

export class LyricsParticles {
  readonly group = new THREE.Group()
  readonly capacity: number

  private readonly uSpread = uniform(1)
  private readonly uFade = uniform(0)
  private readonly uMix = uniform(0) // 双缓冲插值：0=槽0字形 1=槽1字形
  private readonly uScale = uniform(1)
  private readonly uBrightness = uniform(1)
  private readonly uColorMain = uniform(new THREE.Color(0.9, 0.9, 1.0))
  private readonly uColorHi = uniform(new THREE.Color(1.0, 1.0, 1.0))
  private readonly targets0: THREE.StorageBufferNode<'vec3'>
  private readonly targets1: THREE.StorageBufferNode<'vec3'>
  private readonly mesh: THREE.InstancedMesh
  private readonly geo: THREE.PlaneGeometry
  private readonly mat: THREE.SpriteNodeMaterial

  constructor(capacity: number) {
    this.capacity = capacity
    // 节点引用保持同作用域内联（particles.ts:109 惯例，title-particles 同款）
    const targets0 = instancedArray(capacity, 'vec3')
    const targets1 = instancedArray(capacity, 'vec3')
    this.targets0 = targets0
    this.targets1 = targets1

    this.mat = new THREE.SpriteNodeMaterial({
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    })
    const dir = vec3(
      hash(instanceIndex.add(17)).sub(0.5),
      hash(instanceIndex.add(31)).sub(0.5),
      hash(instanceIndex.add(47)).sub(0.5)
    ).mul(2)
    const dist = hash(instanceIndex.add(7)).mul(0.8).add(0.6)
    // 字变字核心：目标点 = 双槽插值——uMix 缓动时每颗粒子从旧字形位置直飞新字形位置
    const target = mix(targets0.element(instanceIndex), targets1.element(instanceIndex), this.uMix)
    this.mat.positionNode = target
      .add(dir.mul(this.uSpread).mul(dist).mul(float(SCATTER_DIST)))
      .mul(this.uScale)
    this.mat.scaleNode = float(0.008).add(hash(instanceIndex.add(11)).mul(0.006)).mul(this.uScale)
    const disc = saturate(smoothstep(0.0, 0.5, uv().sub(0.5).length()).oneMinus()).pow(1.5)
    this.mat.opacityNode = disc.mul(this.uFade).mul(hash(instanceIndex.add(3)).mul(0.45).add(0.55))
    this.mat.colorNode = mix(vec3(this.uColorMain), vec3(this.uColorHi), hash(instanceIndex.add(23)))
      .mul(1.6).mul(this.uBrightness)

    this.geo = new THREE.PlaneGeometry(1, 1)
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity)
    this.mesh.frustumCulled = false
    // 文字层压过日食黑盘(renderOrder 1)——additive 层间加法可交换,提序对其余画面零变化（图形三连终审 I-1）
    this.mesh.renderOrder = 2
    this.group.add(this.mesh)
    this.group.visible = false
  }

  /** 指定槽写入点云；padPositions 护栏保证恰好 capacity*3（偏短补首点，杜绝残留旧句尾点） */
  setCloud(slot: 0 | 1, cloud: ShapePointCloud): void {
    const buf = slot === 0 ? this.targets0 : this.targets1
    const arr = buf.value.array as Float32Array
    arr.set(padPositions(cloud.positions, this.capacity))
    buf.value.needsUpdate = true
  }

  setFrame(spread: number, fade: number, mixValue: number, dim: number): void {
    this.uSpread.value = spread
    this.uFade.value = fade * dim
    this.uMix.value = mixValue
    this.group.visible = this.uFade.value > VISIBLE_EPS
  }

  setPalette(primary: THREE.Color, highlight: THREE.Color): void {
    this.uColorMain.value.copy(primary)
    this.uColorHi.value.copy(highlight)
  }

  setScale(k: number): void {
    this.uScale.value = k
  }

  setBrightness(k: number): void {
    this.uBrightness.value = k
  }

  /** 悬浮高度（歌词位置滑块）：独立滑块连续值直接落 y（原沿用歌名三档表，已退役） */
  setAnchorY(y: number): void {
    this.group.position.y = y
  }

  orientTo(camPos: THREE.Vector3): void {
    this.group.lookAt(camPos)
  }

  private readonly orientTmp = new THREE.Object3D()

  /** 每帧阻尼缓跟随镜头（spawn 帧仍走 orientTo 瞬时对准，本方法只负责此后的持续追随） */
  faceCamera(camPos: THREE.Vector3, dt: number): void {
    this.orientTmp.position.copy(this.group.position)
    this.orientTmp.lookAt(camPos)
    this.group.quaternion.slerp(this.orientTmp.quaternion, 1 - Math.exp(-dt / ORIENT_TAU))
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
