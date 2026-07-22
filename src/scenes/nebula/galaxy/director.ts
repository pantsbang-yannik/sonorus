// 星系对象管家（spec §三）：持有点云/中心/相机/accents（后续任务的 trails）。
// index.ts 只与本门面对话；morph/uniform 记账仍归 index.ts 闭包（分工见 index.ts galaxy 块注释）。
import * as THREE from 'three/webgpu'
import type { ShapePointCloud } from '../cover-points'
import type { GalaxyView, GalaxyStar } from './types'
import { layoutGalaxy, galaxyRadius } from './layout'
import { bakeGalaxyCloud, type BakedGalaxy } from './star-field'
import { GalaxyCamera } from './camera'
import { GalaxyAccents } from './accents'
import { GalaxyTrails } from './trails'
import { GalaxyStarSprites } from './star-sprites'
import { GalaxyCoverAtlas } from './cover-atlas'
import { pickStar, type ProjectedStar } from './pick'

const BASE_DIST_K = 1.9   // 相机基准距离 = 半径 × 系数（稀疏小星团自然贴近）
const BASE_DIST_MIN = 1.7
const BASE_DIST_MAX = 4.4
const CLICK_PICK_PX = 24       // 点击拾取半径：CSS px（spec T8 字面值）
const HOVER_PICK_PX = 18       // hover 拾取半径：CSS px（spec T8 字面值）

export class GalaxyDirector {
  readonly camera: GalaxyCamera
  baked: BakedGalaxy | null = null
  private view: GalaxyView | null = null
  private nowPlayingKey: string | null = null
  private readonly accents = new GalaxyAccents()
  private readonly trails = new GalaxyTrails()
  private readonly sprites = new GalaxyStarSprites()
  private readonly atlas = new GalaxyCoverAtlas()
  private hoverKey: string | null = null
  private selectedKey: string | null = null
  private selectedTexReady = false // 语义：选中星大图已从图集就绪并应用
  /** 跨 mount/unmount 存活的上次星集，用于诞生辉光 diff；初值 null=尚未进过一次星系（spec §六） */
  private prevStarKeys: Set<string> | null = null

  constructor(private scene: THREE.Scene, private dom: HTMLElement) {
    this.camera = new GalaxyCamera(dom)
  }

  mount(view: GalaxyView, count: number): ShapePointCloud {
    this.view = view
    const placements = layoutGalaxy(view.stars.map((s) => s.key))
    this.baked = bakeGalaxyCloud(view.stars, placements, count)
    this.sprites.build(view.stars, placements)
    this.sprites.resetReveal() // morph 落定后（update 恢复运行时）从黑淡入
    this.sprites.setFilterDim(view.stars, view.filterView ? new Set(view.filterView.activeKeys) : null)
    this.atlas.build(view.stars, this.baked.centers)
    this.camera.setBaseDist(Math.min(BASE_DIST_MAX, Math.max(BASE_DIST_MIN, galaxyRadius(view.stars.length) * BASE_DIST_K)))
    this.camera.attach()
    this.scene.add(this.accents.group)
    this.scene.add(this.trails.group)
    this.scene.add(this.sprites.group)
    this.scene.add(this.atlas.group)
    this.applySelection(view.selectedKey)
    this.spawnBirths(view.stars)
    this.rebuildTrail(view)
    return this.baked.cloud
  }

  /** stars 引用变化 → 重烘焙返回新点云（星/封面同步重建）；filterView 变化 → 只改星实例调暗属性+重建光轨，
   * 不重烘（spec §3.1「筛选变化不再重烘」，性能优于 V1）；只有 selectedKey 变化 → 返回 null（相机/accents 自会响应） */
  setView(view: GalaxyView, count: number): ShapePointCloud | null {
    const prev = this.view
    this.view = view
    const filterChanged = !prev || prev.filterView !== view.filterView
    const starsChanged = !prev || prev.stars !== view.stars
    if (!starsChanged) {
      // 无重建：选中/筛选只改现有实例属性；setFilterDim 喂当前 stars（与上次 build 同引用，长度对齐）
      this.applySelection(view.selectedKey)
      if (filterChanged) {
        this.sprites.setFilterDim(view.stars, view.filterView ? new Set(view.filterView.activeKeys) : null)
        this.rebuildTrail(view)
      }
      return null
    }
    const placements = layoutGalaxy(view.stars.map((s) => s.key))
    this.baked = bakeGalaxyCloud(view.stars, placements, count)
    this.sprites.build(view.stars, placements)
    this.sprites.setFilterDim(view.stars, view.filterView ? new Set(view.filterView.activeKeys) : null)
    this.atlas.build(view.stars, this.baked.centers)
    this.applySelection(view.selectedKey) // 必在 atlas.build 之后：selectedTexReady 反映新图集，未就绪由 updateSelectedTex 逐帧补（否则选中封面悬挂在被 dispose 的旧 clone 上）
    this.rebuildTrail(view) // stars 变了星心也变，光轨点位必刷新
    return this.baked.cloud
  }

  /** filterView 非空 → trailKeys 依次 centerOf 连线（缺失星过滤）；filterView 为空 → 清空光轨 */
  private rebuildTrail(view: GalaxyView): void {
    if (!view.filterView) { this.trails.setTrail([]); return }
    const pts: THREE.Vector3[] = []
    for (const key of view.filterView.trailKeys) {
      const c = this.centerOf(key)
      if (c) pts.push(c)
    }
    this.trails.setTrail(pts)
  }

  setNowPlaying(key: string | null): void { this.nowPlayingKey = key }

  centerOf(key: string): THREE.Vector3 | null {
    const i = this.view?.stars.findIndex((s) => s.key === key) ?? -1
    if (i < 0 || !this.baked) return null
    return new THREE.Vector3(this.baked.centers[i * 3], this.baked.centers[i * 3 + 1], this.baked.centers[i * 3 + 2])
  }

  private applySelection(key: string | null): void {
    this.camera.setFocus(key ? this.centerOf(key) : null)
    this.selectedKey = key
    this.selectedTexReady = false
    if (!key) { this.accents.setSelected(null, null); return }
    const st = this.view?.stars.find((s) => s.key === key) ?? null
    const tex = st?.artworkKey ? this.atlas.selectedTexture(st.artworkKey) : null
    this.selectedTexReady = !!tex
    this.accents.setSelected(this.centerOf(key), tex)
  }

  /** 新星诞生微光（spec §六）：本次 mount 星集里、上次星集没有的 key 挂一枚诞生辉光；首次进入不放动画 */
  private spawnBirths(stars: GalaxyStar[]): void {
    if (this.prevStarKeys !== null) {
      for (const s of stars) {
        if (this.prevStarKeys.has(s.key)) continue
        const c = this.centerOf(s.key)
        if (c) this.accents.spawnBirth(c)
      }
    }
    this.prevStarKeys = new Set(stars.map((s) => s.key))
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.camera.update(dt, camera)
    if (this.view && this.baked) {
      const projected = this.projectStars(camera)
      this.handlePick(projected)
      this.handleHover(projected)
      this.accents.setPulse(this.nowPlayingKey ? this.centerOf(this.nowPlayingKey) : null)
      this.updateSelectedTex()
    }
    this.accents.update(dt, camera)
    this.sprites.update(dt) // 星光淡入/微闪烁逐帧推进（自守卫：无网格时空转）
    this.atlas.update(dt, camera, this.dom.clientHeight) // 封面滞回淡入（自守卫：无 loader 时早退）
  }

  /** 屏幕空间投影缓存：每帧重算一次，hover/click/nearCovers 共用（评审 P2 要求）。
   * NDC→CSS px 走 clientWidth/clientHeight（非 width/height 设备像素后备缓冲），使拾取半径保持 CSS-px 语义 */
  private projectStars(camera: THREE.PerspectiveCamera): ProjectedStar[] {
    const stars = this.view!.stars
    const centers = this.baked!.centers
    const w = this.dom.clientWidth
    const h = this.dom.clientHeight
    const v = new THREE.Vector3()
    const out: ProjectedStar[] = new Array(stars.length)
    for (let i = 0; i < stars.length; i++) {
      v.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]).project(camera)
      out[i] = { key: stars[i].key, x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h, depth: v.z }
    }
    return out
  }

  private handlePick(projected: ProjectedStar[]): void {
    const click = this.camera.consumeClick()
    if (!click) return
    const rect = this.dom.getBoundingClientRect()
    const key = pickStar(click.x - rect.left, click.y - rect.top, projected, CLICK_PICK_PX)
    this.view?.onPick?.(key) // 点空传 null
  }

  private handleHover(projected: ProjectedStar[]): void {
    const p = this.camera.lastPointer
    const rect = this.dom.getBoundingClientRect()
    const key = p ? pickStar(p.x - rect.left, p.y - rect.top, projected, HOVER_PICK_PX) : null
    if (key !== this.hoverKey) {
      this.hoverKey = key
      this.accents.setHover(key ? this.centerOf(key) : null)
      this.dom.style.cursor = key ? 'pointer' : ''
    }
    // 悬浮信息条（fb2）：星心屏幕坐标逐帧上报——镜头漫游时标签跟星走；未悬停帧上报 null（接收方幂等）
    const hit = this.hoverKey ? projected.find((s) => s.key === this.hoverKey) ?? null : null
    this.view?.onHover?.(hit ? { key: this.hoverKey!, x: hit.x, y: hit.y } : null)
  }

  /** 选中封面流转补缺（评审 P2）：applySelection 已传首帧 tex（可能为 null），图集渐进就绪前恒 null，
   * 就绪即补传一次并封顶。图集 selectedTexture 走 per-key 缓存不会被驱逐，故就绪后无需逐帧续命。 */
  private updateSelectedTex(): void {
    if (!this.selectedKey || this.selectedTexReady) return
    const st = this.view!.stars.find((s) => s.key === this.selectedKey)
    if (!st?.artworkKey) return
    const tex = this.atlas.selectedTexture(st.artworkKey)
    if (!tex) return
    this.selectedTexReady = true
    this.accents.setSelected(this.centerOf(this.selectedKey), tex)
  }

  /** 退出起点（评审 P1-1）：镜头回 HOME + 星/封面开始淡出。restore 相位 update 仍在跑，淡出有帧可走，
   * 落地无硬跳。参数照抄 GalaxyCamera.beginExit 现签名（index.ts 唯一新依赖）。 */
  beginExit(...args: Parameters<GalaxyCamera['beginExit']>): void {
    this.camera.beginExit(...args)
    this.sprites.setRevealed(false)
    this.atlas.setHidden(true)
  }

  unmount(): void {
    this.camera.detach()
    this.scene.remove(this.accents.group)
    this.scene.remove(this.trails.group)
    this.scene.remove(this.sprites.group)
    this.scene.remove(this.atlas.group)
    this.atlas.stopLoading() // 退出守卫：停止在途取图，重进由 atlas.build 重建 loader
    this.accents.setPulse(null)
    this.accents.setHover(null)
    this.accents.setSelected(null, null)
    this.trails.setTrail([])
    this.dom.style.cursor = '' // hover 光标退出时还原（spec T8）
    this.hoverKey = null
    this.selectedKey = null
    this.selectedTexReady = false
    this.baked = null
    this.view = null
    // prevStarKeys 不重置：跨 mount/unmount 存活，供下次进场 diff 出诞生辉光
  }
  dispose(): void {
    this.camera.dispose()
    this.accents.dispose()
    this.trails.dispose()
    this.sprites.dispose()
    this.atlas.dispose()
  }
}
