// galaxy-card.ts —— 星系图鉴右侧信息卡：点选一颗星后展示曲目详情 + 可点播放日历。
// 挂 parent（#audelyra-overlay 铁律）；样式家族同 savedToast（深底/毛玻璃/细边框），显隐过渡 500ms
// 同 dock；Esc 关卡走 window capture + stopPropagation 先例（player-bar.ts），只在 isOpen 时
// 消费，不连带关掉其它面板。关闭动作（Esc / × 按钮）只上报 deps.onClose，不自行 hide()——
// 精确复刻 PlayerBar 关闭按钮的解耦惯例：真正隐藏交外部（T12）在收到回调后调用 hide()。
import type { GalaxyDay, GalaxyStar } from '../scenes/nebula/galaxy/types'

const FONT = `-apple-system, "PingFang SC", sans-serif`
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const HIDE_TRANSITION_MS = 500

export interface GalaxyCardDeps {
  onPickDay: (date: string) => void
  onClose: () => void
}

/** 累计时长（取整分钟）：≥60min → "N 小时 M 分钟"，否则 "M 分钟"；不足 1 分钟按 1 算 */
function formatDuration(totalSeconds: number): string {
  let minutes = Math.round(totalSeconds / 60)
  if (minutes < 1) minutes = 1
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `${h} 小时 ${m} 分钟`
  }
  return `${minutes} 分钟`
}

/** ISO 时间戳 → 本地时区 YYYY-MM-DD（首听/最近用；与 GalaxyDay.date 同格式口径，非 UTC 切片） */
function formatLocalDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class GalaxyCard {
  private container: HTMLElement
  private titleEl: HTMLElement
  private artistEl: HTMLElement
  private metaEl: HTMLElement
  private dayListEl: HTMLElement
  private open_ = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open_) return
    e.stopPropagation()
    this.deps.onClose()
  }

  constructor(parent: HTMLElement, private deps: GalaxyCardDeps) {
    this.container = document.createElement('div')
    this.container.id = 'galaxy-card'
    this.container.style.cssText = `
      position: fixed;
      right: 2vw;
      top: 8vh;
      max-height: 84vh;
      width: 300px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border-radius: 8px;
      background: rgba(20, 26, 36, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: rgba(255, 255, 255, 0.85);
      font-family: ${FONT};
      font-weight: 300;
      letter-spacing: 0.04em;
      font-size: 13px;
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      visibility: hidden;
      z-index: 9994;
      transition: opacity 500ms ${EASE}, filter 500ms ${EASE};
    `

    const closeBtn = document.createElement('button')
    closeBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.5);
      transition: color 200ms;
    `
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    closeBtn.addEventListener('click', () => this.deps.onClose())
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = 'rgba(255, 255, 255, 0.9)' })
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = 'rgba(255, 255, 255, 0.5)' })
    this.container.appendChild(closeBtn)

    this.titleEl = document.createElement('div')
    this.titleEl.style.cssText = `
      font-size: 15px;
      font-weight: 400;
      color: rgba(255, 255, 255, 0.95);
      padding-right: 20px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `
    this.container.appendChild(this.titleEl)

    this.artistEl = document.createElement('div')
    this.artistEl.style.cssText = `opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
    this.container.appendChild(this.artistEl)

    this.metaEl = document.createElement('div')
    this.metaEl.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      opacity: 0.75;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    `
    this.container.appendChild(this.metaEl)

    const dayHeader = document.createElement('div')
    dayHeader.textContent = '播放日期'
    dayHeader.style.cssText = `opacity: 0.5; font-size: 12px; padding-top: 2px;`
    this.container.appendChild(dayHeader)

    // 听一年后几百天不破版：容器限高滚动，不撑爆卡片（fb 教训同款防御）
    this.dayListEl = document.createElement('div')
    this.dayListEl.style.cssText = `display: flex; flex-direction: column; max-height: 40vh; overflow-y: auto;`
    this.container.appendChild(this.dayListEl)

    parent.appendChild(this.container)
  }

  private metaRow(text: string): HTMLElement {
    const el = document.createElement('div')
    el.textContent = text
    return el
  }

  private dayRow(day: GalaxyDay): HTMLElement {
    const el = document.createElement('div')
    el.textContent = `${day.date.slice(5)} · ${day.count}次`
    el.style.cssText = `padding: 4px 0; cursor: pointer; opacity: 0.7; transition: opacity 200ms;`
    el.addEventListener('click', () => this.deps.onPickDay(day.date))
    el.addEventListener('mouseenter', () => { el.style.opacity = '1' })
    el.addEventListener('mouseleave', () => { el.style.opacity = '0.7' })
    return el
  }

  /** 歌名/歌手/听过N次/累计时长(取整分钟)/首听·最近(本地日期)/日子列表(倒序,每项可点) */
  show(star: GalaxyStar): void {
    this.titleEl.textContent = star.title
    this.artistEl.textContent = star.artist

    this.metaEl.innerHTML = ''
    this.metaEl.appendChild(this.metaRow(`听过 ${star.playCount} 次`))
    this.metaEl.appendChild(this.metaRow(`累计时长 ${formatDuration(star.totalListenedSeconds)}`))
    this.metaEl.appendChild(this.metaRow(`首听 ${formatLocalDate(star.firstAt)}`))
    this.metaEl.appendChild(this.metaRow(`最近 ${formatLocalDate(star.lastAt)}`))

    this.dayListEl.innerHTML = ''
    const days = [...star.days].reverse() // days 升序（type 注释）→ 倒序展示，最近的日子排最前
    for (const day of days) this.dayListEl.appendChild(this.dayRow(day))

    this.open_ = true
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.container.style.visibility = 'visible'
    this.container.style.pointerEvents = 'auto'
    this.container.style.opacity = '1'
    this.container.style.filter = 'blur(0)'
    window.addEventListener('keydown', this.onKeydown, true)
  }

  hide(): void {
    if (!this.open_) return
    this.open_ = false
    this.container.style.opacity = '0'
    this.container.style.filter = 'blur(6px)'
    this.container.style.pointerEvents = 'none'
    window.removeEventListener('keydown', this.onKeydown, true)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.container.style.visibility = 'hidden'
    }, HIDE_TRANSITION_MS)
  }

  get isOpen(): boolean {
    return this.open_
  }

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    window.removeEventListener('keydown', this.onKeydown, true)
    this.container.remove()
  }
}
