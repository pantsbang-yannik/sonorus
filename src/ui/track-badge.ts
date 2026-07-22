import type { SceneTrackEvent } from '../scenes/types'

/**
 * 纯逻辑显隐状态机——可独立测试
 * 不关心 DOM，只维护可见性状态和计时
 */
export class BadgeVisibility {
  private visible_ = false
  private hasContent_ = true
  private enabled_ = true // 设置开关（独立于 hasContent 的 track 内容语义，不得复用 hasContent_）
  private suppressed_ = false // 前台层压制（如形状选择器打开）：正交于 enabled 的设置语义
  private idleTime: number
  private timeSinceLastActivity = 0

  constructor(idleTime: number) {
    this.idleTime = idleTime
  }

  get visible(): boolean {
    return this.visible_ && this.hasContent_ && this.enabled_ && !this.suppressed_
  }

  poke(): void {
    this.visible_ = true
    this.timeSinceLastActivity = 0
  }

  setHasContent(has: boolean): void {
    this.hasContent_ = has
  }

  setEnabled(on: boolean): void {
    this.enabled_ = on
  }

  setSuppressed(on: boolean): void {
    this.suppressed_ = on
  }

  update(dt: number): void {
    if (this.visible_) {
      this.timeSinceLastActivity += dt
      if (this.timeSinceLastActivity >= this.idleTime) {
        this.visible_ = false
        this.timeSinceLastActivity = 0
      }
    }
  }
}

/**
 * DOM 层角标——管理显隐动画、样式、内容更新
 * 内部持有 BadgeVisibility 并映射 visible 到 CSS class
 */
export class TrackBadge {
  private visibility: BadgeVisibility
  private container: HTMLElement
  private titleEl: HTMLElement
  private artistEl: HTMLElement
  private currentTrack: SceneTrackEvent | null = null
  /** 上次写入 DOM 的可见状态——去重，visible 变化才写样式 */
  private lastVisibleState: boolean | null = null

  constructor(parent: HTMLElement) {
    this.visibility = new BadgeVisibility(3)

    // 创建角标容器
    this.container = document.createElement('div')
    this.container.id = 'track-badge'
    this.container.style.cssText = `
      position: fixed;
      bottom: 32px;
      left: 32px;
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      transition: opacity 500ms cubic-bezier(0.33, 1, 0.68, 1),
                  filter 500ms cubic-bezier(0.33, 1, 0.68, 1);
      font-family: -apple-system, "SF Pro Display", sans-serif;
      color: rgba(255, 255, 255, 0.85);
      line-height: 1.2;
    `

    // 歌名行
    this.titleEl = document.createElement('div')
    this.titleEl.style.cssText = `
      font-size: 15px;
      font-weight: 300;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
      color: rgba(255, 255, 255, 0.85);
    `

    // 歌手行
    this.artistEl = document.createElement('div')
    this.artistEl.style.cssText = `
      font-size: 12px;
      font-weight: 300;
      text-transform: lowercase;
      color: rgba(255, 255, 255, 0.45);
    `

    this.container.appendChild(this.titleEl)
    this.container.appendChild(this.artistEl)
    parent.appendChild(this.container)
  }

  setTrack(t: SceneTrackEvent): void {
    this.currentTrack = t

    if (t.kind === 'unknown') {
      // unknown 时隐藏整个角标，不显示"unknown"字样
      this.visibility.setHasContent(false)
    } else {
      // kind === 'change'
      this.visibility.setHasContent(true)
      this.titleEl.textContent = t.title
      this.artistEl.textContent = t.artist
    }
    // 状态同步后立即写 DOM——unknown 不等下一个 250ms tick 才隐藏
    this.updateDOM()
  }

  pokeActivity(): void {
    this.visibility.poke()
  }

  setEnabled(on: boolean): void {
    this.visibility.setEnabled(on)
    this.updateDOM()
  }

  /** 前台层压制（形状选择器打开时让位，B2 亲验反馈） */
  setSuppressed(on: boolean): void {
    this.visibility.setSuppressed(on)
    this.updateDOM()
  }

  update(dt: number): void {
    this.visibility.update(dt)
    this.updateDOM()
  }

  private updateDOM(): void {
    if (this.visible === this.lastVisibleState) return
    this.lastVisibleState = this.visible
    if (this.visible) {
      this.container.style.opacity = '1'
      this.container.style.filter = 'blur(0)'
    } else {
      this.container.style.opacity = '0'
      this.container.style.filter = 'blur(6px)'
    }
  }

  get visible(): boolean {
    return this.visibility.visible
  }

  dispose(): void {
    this.container.remove()
  }
}
