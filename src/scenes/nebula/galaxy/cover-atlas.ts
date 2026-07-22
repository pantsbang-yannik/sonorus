// 封面图集（视觉重做 spec §3.3）：全部 128px 缩略烘进 2048² 图集页，渐进就绪；
// 封面按屏幕投影尺寸滞回淡入——凑近哪片哪片全亮，不限张数不跳变。
// 分层：AtlasLoader（取图/分格/落格，零 three 依赖，可测）+ GalaxyCoverAtlas（三维呈现薄壳，亲验）。
import * as THREE from 'three/webgpu'
import { instancedBufferAttribute, texture, uv, vec2, float } from 'three/tsl'
import type { GalaxyStar } from './types'
import { getGalaxyArtworkFetcher } from './covers'

// ===== 亲验旋钮 =====
export const ATLAS_PAGE = 2048
export const ATLAS_CELL = 128
export const ATLAS_COLS = ATLAS_PAGE / ATLAS_CELL   // 16
export const ATLAS_PER_PAGE = ATLAS_COLS * ATLAS_COLS // 256
export const COVER_IN_PX = 150       // 投影像素 ≥ 此值淡入封面（亲验：默认距离~2.0时投影≈119px，需推近到~1.6才出封面——封面只属于近景）
export const COVER_OUT_PX = 118      // 投影像素 < 此值淡出（滞回带防抖）
export const COVER_WORLD_SIZE = 0.2  // 封面面片世界边长
export const COVER_MAX_OPACITY = 0.92 // 沿 V1 COVER_TARGET_IN 语义
export const COVER_FADE_RATE = 6
export const ATLAS_FETCH_CONCURRENCY = 4

export interface AtlasSlot { page: number; col: number; row: number }

/** 按首现序为唯一 artworkKey 分格（同专辑多星共用一格） */
export function assignAtlasSlots(artworkKeys: string[]): Map<string, AtlasSlot> {
  const slots = new Map<string, AtlasSlot>()
  for (const key of artworkKeys) {
    if (slots.has(key)) continue
    const i = slots.size
    slots.set(key, {
      page: Math.floor(i / ATLAS_PER_PAGE),
      col: i % ATLAS_COLS,
      row: Math.floor(i / ATLAS_COLS) % ATLAS_COLS,
    })
  }
  return slots
}

/** 世界尺寸 worldSize 在距离 dist 处的屏幕投影像素（透视投影，fovYDeg 全角） */
export function apparentPx(worldSize: number, dist: number, fovYDeg: number, viewportH: number): number {
  return (worldSize * viewportH) / (2 * Math.max(dist, 1e-6) * Math.tan((fovYDeg * Math.PI) / 360))
}

/** 滞回目标：≥IN 进、<OUT 退、中间保持（防镜头微动闪烁） */
export function coverFadeTarget(prev: 0 | 1, px: number): 0 | 1 {
  if (px >= COVER_IN_PX) return 1
  if (px < COVER_OUT_PX) return 0
  return prev
}

/** bytes → ImageBitmap（同 covers.ts 已知 TS 泛型冲突处理：裁精确字节段断言 ArrayBuffer） */
async function decodeBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return createImageBitmap(new Blob([buf]))
}

/** 页面绘制面：AtlasLoader 只认这个口，prod 由 GalaxyCoverAtlas 包 canvas，测试注入假实现（脱 DOM） */
export interface AtlasPageSurface {
  draw(bitmap: ImageBitmap, x: number, y: number): void
  markDirty(): void
}

/** 取图/分格/落格调度：并发受限、失败静默跳过（星退纯光点，spec §五）、cancel 即停（退出守卫） */
export class AtlasLoader {
  readonly ready = new Set<string>()
  onReady?: (key: string) => void
  private slots = new Map<string, AtlasSlot>()
  private cancelled = false
  private readonly decode: (bytes: Uint8Array) => Promise<ImageBitmap>
  private readonly concurrency: number

  constructor(opts: { decode?: (bytes: Uint8Array) => Promise<ImageBitmap>; concurrency?: number } = {}) {
    this.decode = opts.decode ?? decodeBitmap
    this.concurrency = opts.concurrency ?? ATLAS_FETCH_CONCURRENCY
  }

  slotOf(key: string): AtlasSlot | undefined { return this.slots.get(key) }

  start(keys: string[], surfaceOf: (page: number) => AtlasPageSurface): void {
    this.slots = assignAtlasSlots(keys)
    const queue = [...this.slots.keys()]
    const worker = async (): Promise<void> => {
      for (;;) {
        const key = queue.shift()
        if (key === undefined || this.cancelled) return
        await this.loadOne(key, surfaceOf)
      }
    }
    for (let i = 0; i < this.concurrency; i++) void worker()
  }

  private async loadOne(key: string, surfaceOf: (page: number) => AtlasPageSurface): Promise<void> {
    const fetcher = getGalaxyArtworkFetcher()
    if (!fetcher) return
    try {
      const bytes = await fetcher(key)
      if (!bytes || this.cancelled) return
      const bitmap = await this.decode(bytes)
      if (this.cancelled) return
      const slot = this.slots.get(key)
      if (!slot) return
      const surface = surfaceOf(slot.page)
      surface.draw(bitmap, slot.col * ATLAS_CELL, slot.row * ATLAS_CELL)
      surface.markDirty()
      this.ready.add(key)
      this.onReady?.(key)
    } catch {
      // 取图/解码失败静默：该星保持纯光点（spec §五）
    }
  }

  cancel(): void { this.cancelled = true }
}

/** 指数趋近（惯例同 accents.ts approach） */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

interface PageRuntime {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  tex: THREE.CanvasTexture
  mesh: THREE.InstancedMesh | null
  aFade: THREE.InstancedBufferAttribute | null
  starIdx: number[] // 本页实例 → 全星下标
}

export class GalaxyCoverAtlas {
  readonly group = new THREE.Group()
  private pages: PageRuntime[] = []
  private loader: AtlasLoader | null = null
  private stars: GalaxyStar[] = []
  private centers: Float32Array = new Float32Array(0)
  private fadeTargets: Float32Array = new Float32Array(0) // per-star 0|1
  private fadeValues: Float32Array = new Float32Array(0)
  private hidden = false
  private readonly selectedClones = new Map<string, THREE.Texture>()

  build(stars: GalaxyStar[], centers: Float32Array): void {
    this.disposeContents()
    this.stars = stars
    this.centers = centers
    this.hidden = false
    this.fadeTargets = new Float32Array(stars.length)
    this.fadeValues = new Float32Array(stars.length)
    const artKeys = stars.filter((s) => s.artworkKey).map((s) => s.artworkKey!)
    if (artKeys.length === 0) return
    this.loader = new AtlasLoader()
    const slots = assignAtlasSlots(artKeys)
    const pageCount = Math.max(...[...slots.values()].map((s) => s.page)) + 1
    for (let p = 0; p < pageCount; p++) this.pages.push(this.makePage(p, stars, slots))
    this.loader.start(artKeys, (page) => ({
      draw: (bitmap, x, y) => { this.pages[page]?.ctx?.drawImage(bitmap, x, y, ATLAS_CELL, ATLAS_CELL) },
      markDirty: () => { const pg = this.pages[page]; if (pg) pg.tex.needsUpdate = true },
    }))
  }

  /** 每页一个实例化广告牌网格：实例=该页封面星，uv 取格子子矩形。
   * flipY 与格子 v origin 的对应关系真机验证（canvas y-down vs 纹理 v-up），此处按 flipY=true 推导 */
  private makePage(page: number, stars: GalaxyStar[], slots: Map<string, AtlasSlot>): PageRuntime {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ATLAS_PAGE
    const ctx = canvas.getContext('2d')
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const starIdx: number[] = []
    for (let i = 0; i < stars.length; i++) {
      const key = stars[i].artworkKey
      if (key && slots.get(key)?.page === page) starIdx.push(i)
    }
    const rt: PageRuntime = { canvas, ctx, tex, mesh: null, aFade: null, starIdx }
    if (starIdx.length === 0) return rt
    const n = starIdx.length
    const positions = new Float32Array(n * 3)
    const uvOffsets = new Float32Array(n * 2)
    const cellUv = ATLAS_CELL / ATLAS_PAGE
    for (let j = 0; j < n; j++) {
      const i = starIdx[j]
      positions[j * 3] = this.centers[i * 3]
      positions[j * 3 + 1] = this.centers[i * 3 + 1]
      positions[j * 3 + 2] = this.centers[i * 3 + 2]
      const slot = slots.get(stars[i].artworkKey!)!
      uvOffsets[j * 2] = slot.col * cellUv
      uvOffsets[j * 2 + 1] = 1 - (slot.row + 1) * cellUv // flipY=true：v 自底向上
    }
    const geo = new THREE.PlaneGeometry(1, 1)
    const aPos = new THREE.InstancedBufferAttribute(positions, 3)
    const aUv = new THREE.InstancedBufferAttribute(uvOffsets, 2)
    const aFade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
    geo.setAttribute('aCoverPos', aPos)
    geo.setAttribute('aCoverUv', aUv)
    geo.setAttribute('aCoverFade', aFade)
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
    // TSL 类型对不齐（同 star-sprites.ts 已知坑，M2/M3-conclusions）：instancedBufferAttribute(arr) 不传
    // 显式类型实参时 TNodeType 推不出字面量、塌成 unknown，下游 .add()/.mul() 链因此报「不存在该属性」——
    // 显式传 <'vec3'|'vec2'|'float'>(arr, 'vec3'|'vec2'|'float') 钉住字面量，运行时行为不变
    mat.positionNode = instancedBufferAttribute<'vec3'>(aPos, 'vec3')
    mat.scaleNode = vec2(float(COVER_WORLD_SIZE), float(COVER_WORLD_SIZE))
    const fadeN = instancedBufferAttribute<'float'>(aFade, 'float')
    const uvN = instancedBufferAttribute<'vec2'>(aUv, 'vec2')
    mat.colorNode = texture(tex, uvN.add(uv().mul(cellUv))).rgb
    mat.opacityNode = fadeN.mul(COVER_MAX_OPACITY)
    rt.mesh = new THREE.InstancedMesh(geo, mat, n)
    rt.mesh.frustumCulled = false
    rt.mesh.renderOrder = 1 // 封面盖在光点之上
    rt.aFade = aFade
    this.group.add(rt.mesh)
    return rt
  }

  /** 每帧：距离→投影像素→滞回目标→指数趋近，写回各页 aFade（就绪才允许亮） */
  update(dt: number, camera: THREE.PerspectiveCamera, viewportH: number): void {
    if (!this.loader) return
    const cam = camera.position
    for (const pg of this.pages) {
      if (!pg.aFade) continue
      let dirty = false
      const arr = pg.aFade.array as Float32Array
      for (let j = 0; j < pg.starIdx.length; j++) {
        const i = pg.starIdx[j]
        const key = this.stars[i].artworkKey!
        let target: 0 | 1 = 0
        if (!this.hidden && this.loader.ready.has(key)) {
          const dx = this.centers[i * 3] - cam.x
          const dy = this.centers[i * 3 + 1] - cam.y
          const dz = this.centers[i * 3 + 2] - cam.z
          const px = apparentPx(COVER_WORLD_SIZE, Math.sqrt(dx * dx + dy * dy + dz * dz), camera.fov, viewportH)
          target = coverFadeTarget(this.fadeTargets[i] as 0 | 1, px)
        }
        this.fadeTargets[i] = target
        const next = approach(this.fadeValues[i], target, COVER_FADE_RATE, dt)
        if (Math.abs(next - arr[j]) > 1e-4) { arr[j] = next; dirty = true }
        this.fadeValues[i] = next
      }
      if (dirty) pg.aFade.needsUpdate = true
    }
  }

  /** 选中星大图：页纹理 clone + offset/repeat 裁格（clone 共享像素源，零拷贝），per-key 缓存 */
  selectedTexture(artworkKey: string): THREE.Texture | null {
    if (!this.loader?.ready.has(artworkKey)) return null
    const cached = this.selectedClones.get(artworkKey)
    if (cached) return cached
    const slot = this.loader.slotOf(artworkKey)
    const pg = slot ? this.pages[slot.page] : undefined
    if (!slot || !pg) return null
    const cellUv = ATLAS_CELL / ATLAS_PAGE
    const t = pg.tex.clone()
    t.repeat.set(cellUv, cellUv)
    t.offset.set(slot.col * cellUv, 1 - (slot.row + 1) * cellUv)
    this.selectedClones.set(artworkKey, t)
    return t
  }

  setHidden(h: boolean): void { this.hidden = h }

  /** 退出守卫：进行中的取图/落格停止，重进由 build 重建 loader（惯例同 repo 退出期 cancel） */
  stopLoading(): void { this.loader?.cancel() }

  private disposeContents(): void {
    this.loader?.cancel()
    this.loader = null
    for (const t of this.selectedClones.values()) t.dispose()
    this.selectedClones.clear()
    for (const pg of this.pages) {
      if (pg.mesh) {
        this.group.remove(pg.mesh)
        pg.mesh.geometry.dispose()
        ;(pg.mesh.material as THREE.Material).dispose()
      }
      pg.tex.dispose()
    }
    this.pages = []
  }

  dispose(): void { this.disposeContents() }
}
