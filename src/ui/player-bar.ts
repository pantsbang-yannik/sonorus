// 本地播放控制条:封面 + 双行曲目(标题/歌手) + 上下一首 + 播放/暂停 + 进度滑块 + 循环开关 + 关闭。
// 挂 #audelyra-overlay(仓库铁律),常驻部件(非 Panel:不参与互斥/退台仲裁,同 TrackBadge 定位)。
// z-index 9995:在 dropOverlay(9996)之下——播放中再拖新文件,暗幕盖住控制条是正确语义。
const FONT = `-apple-system, "PingFang SC", sans-serif`
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'

export interface PlayerBarDeps {
  onToggle: () => void
  onSeek: (sec: number) => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onLoopToggle: () => void
  onQueueSelect: (id: number) => void
  onQueueRemove: (id: number) => void
}

/** 当前曲目落款素材:标题兜底文件名,歌手/封面未知时置 null */
export interface NowPlaying {
  title: string
  artist: string | null
  coverDataUrl: string | null
}

/** 队列行展示素材:active 标记当前正在放的一首 */
export interface QueueRow {
  id: number
  title: string
  artist: string | null
  active: boolean
}

/** 83 → '1:23';NaN/Infinity(duration 未知期)→ '0:00' */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const PLAY_SVG = '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'
const PAUSE_SVG = '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>' +
  '<rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>'
const PREV_SVG = '<path d="M7 5v14" stroke="currentColor" stroke-width="1.8"/><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none"/>'
const NEXT_SVG = '<path d="M17 5v14" stroke="currentColor" stroke-width="1.8"/><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none"/>'
const LOOP_SVG = '<path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>'
const QUEUE_SVG = '<path d="M4 6h16M4 12h16M4 18h9"/>'

export class PlayerBar {
  private root: HTMLElement
  private coverEl: HTMLImageElement
  private titleEl: HTMLElement
  private artistEl: HTMLElement
  private toggleBtn: HTMLButtonElement
  private loopBtn: HTMLButtonElement
  private queueBtn: HTMLButtonElement
  private queueWrap: HTMLElement
  private slider: HTMLInputElement
  private curEl: HTMLElement
  private durEl: HTMLElement
  /** 拖动滑块期间为 true:setTime 不许覆盖用户手上的滑块位置 */
  private scrubbing = false
  /** show()/hide() 语义状态,与 suppressed 正交叠加(同 TrackBadge 惯例) */
  private shown = false
  /** 前台层压制(如 ShapePicker 打开时让位):真实可见性 = shown && !suppressed */
  private suppressed = false
  /** 队列列表展开状态 */
  private queueExpanded = false
  private queueRowEls: HTMLElement[] = []

  constructor(parent: HTMLElement, private deps: PlayerBarDeps) {
    this.root = document.createElement('div')
    this.root.style.cssText = `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; max-width: min(72vw, 560px);
      padding: 10px 16px; border-radius: 8px; background: rgba(20, 26, 36, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: rgba(255, 255, 255, 0.85); font: 300 13px ${FONT}; letter-spacing: 0.04em;
      opacity: 0; filter: blur(6px); pointer-events: none; z-index: 9995;
      transition: opacity 400ms ${EASE}, filter 400ms ${EASE};`

    this.coverEl = document.createElement('img') as HTMLImageElement
    this.coverEl.setAttribute('data-role', 'cover')
    this.coverEl.style.cssText = `width: 30px; height: 30px; border-radius: 5px; object-fit: cover;
      background: rgba(255, 255, 255, 0.06); display: none; flex: none;`
    this.root.appendChild(this.coverEl)

    const textBox = document.createElement('div')
    textBox.style.cssText = `display: flex; flex-direction: column; gap: 1px; max-width: 150px; min-width: 60px; overflow: hidden;`
    this.titleEl = document.createElement('span')
    this.titleEl.setAttribute('data-role', 'title')
    this.titleEl.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
    this.artistEl = document.createElement('span')
    this.artistEl.setAttribute('data-role', 'artist')
    this.artistEl.style.cssText = `font-size: 11px; opacity: 0.55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: none;`
    textBox.appendChild(this.titleEl)
    textBox.appendChild(this.artistEl)
    this.root.appendChild(textBox)

    const prevBtn = this.makeButton(() => deps.onPrev(), 'prev')
    prevBtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PREV_SVG}</svg>`
    this.root.appendChild(prevBtn)

    this.toggleBtn = this.makeButton(() => deps.onToggle(), 'toggle')
    this.setPlaying(false)
    this.root.appendChild(this.toggleBtn)

    const nextBtn = this.makeButton(() => deps.onNext(), 'next')
    nextBtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${NEXT_SVG}</svg>`
    this.root.appendChild(nextBtn)

    this.curEl = document.createElement('span')
    this.curEl.style.cssText = `font-variant-numeric: tabular-nums; opacity: 0.7;`
    this.root.appendChild(this.curEl)

    this.slider = document.createElement('input') as HTMLInputElement
    this.slider.setAttribute('type', 'range')
    this.slider.min = '0'
    this.slider.max = '0'
    this.slider.step = '0.1'
    this.slider.style.cssText = `width: 140px; accent-color: rgba(255, 255, 255, 0.7); cursor: pointer;`
    this.slider.addEventListener('pointerdown', () => { this.scrubbing = true })
    // 按住原位松手(value 未变)时浏览器不发 change,scrubbing 会永真卡死滑块跟随——
    // pointerup/pointercancel 兜底清除;change 若紧随其后到达,handler 里的赋值幂等,无副作用
    this.slider.addEventListener('pointerup', () => { this.scrubbing = false })
    this.slider.addEventListener('pointercancel', () => { this.scrubbing = false })
    this.slider.addEventListener('change', () => {
      this.scrubbing = false
      deps.onSeek(Number(this.slider.value))
    })
    this.root.appendChild(this.slider)

    this.durEl = document.createElement('span')
    this.durEl.style.cssText = `font-variant-numeric: tabular-nums; opacity: 0.7;`
    this.root.appendChild(this.durEl)

    this.loopBtn = this.makeButton(() => deps.onLoopToggle(), 'loop', false)
    this.loopBtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${LOOP_SVG}</svg>`
    this.setLoop(false)
    this.root.appendChild(this.loopBtn)

    this.queueBtn = this.makeButton(() => this.toggleQueue(), 'queue-toggle')
    this.queueBtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${QUEUE_SVG}</svg>`
    this.root.appendChild(this.queueBtn)

    const closeBtn = this.makeButton(() => deps.onClose(), 'close')
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
    this.root.appendChild(closeBtn)

    this.queueWrap = document.createElement('div')
    this.queueWrap.setAttribute('data-role', 'queue-list')
    this.queueWrap.style.cssText = `position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
      width: 320px; max-height: 260px; overflow-y: auto; display: none;
      padding: 6px 0; border-radius: 8px; background: rgba(20, 26, 36, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);`
    this.root.appendChild(this.queueWrap)

    parent.appendChild(this.root)
  }

  /** hover=false:不挂 mouseenter/mouseleave(循环钮的状态色不许被 hover 复位) */
  private makeButton(onClick: () => void, role: string, hover = true): HTMLButtonElement {
    const btn = document.createElement('button') as HTMLButtonElement
    btn.setAttribute('data-role', role)
    btn.style.cssText = `background: none; border: none; padding: 0; cursor: pointer;
      color: rgba(255, 255, 255, 0.75); display: flex; align-items: center; transition: color 200ms;`
    btn.addEventListener('click', onClick)
    if (hover) {
      btn.addEventListener('mouseenter', () => { btn.style.color = 'rgba(255, 255, 255, 1)' })
      btn.addEventListener('mouseleave', () => { btn.style.color = 'rgba(255, 255, 255, 0.75)' })
    }
    return btn
  }

  /** 显示并以文件名兜底展示;重复调用=切歌,进度归零重来。标签到达后由 setNowPlaying 刷新 */
  show(filename: string): void {
    this.setNowPlaying({ title: filename, artist: null, coverDataUrl: null })
    this.setTime(0, 0)
    this.scrubbing = false
    this.shown = true
    this.applyVisibility()
  }

  setNowPlaying(info: NowPlaying): void {
    this.titleEl.textContent = info.title
    this.artistEl.textContent = info.artist ?? ''
    this.artistEl.style.display = info.artist ? '' : 'none'
    if (info.coverDataUrl) {
      this.coverEl.src = info.coverDataUrl
      this.coverEl.style.display = ''
    } else {
      this.coverEl.src = ''
      this.coverEl.style.display = 'none'
    }
  }

  /** 循环开关状态色:开=点亮,关=暗置。不走 makeButton hover(会被 mouseleave 复位) */
  setLoop(on: boolean): void {
    this.loopBtn.setAttribute('data-on', on ? '1' : '0')
    this.loopBtn.style.color = on ? 'rgba(140, 190, 255, 0.95)' : 'rgba(255, 255, 255, 0.45)'
  }

  /** 前台层压制(如 ShapePicker 打开时让位):正交于 show/hide 的语义状态,同 TrackBadge 惯例 */
  setSuppressed(on: boolean): void {
    this.suppressed = on
    this.applyVisibility()
  }

  private applyVisibility(): void {
    const visible = this.shown && !this.suppressed
    this.root.style.opacity = visible ? '1' : '0'
    this.root.style.filter = visible ? 'blur(0)' : 'blur(6px)'
    this.root.style.pointerEvents = visible ? 'auto' : 'none'
  }

  setPlaying(playing: boolean): void {
    this.toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${playing ? PAUSE_SVG : PLAY_SVG}</svg>`
  }

  setTime(current: number, duration: number): void {
    this.curEl.textContent = fmtTime(current)
    this.durEl.textContent = fmtTime(duration)
    if (duration > 0) this.slider.max = String(duration)
    if (!this.scrubbing) this.slider.value = String(current)
  }

  private toggleQueue(): void {
    this.queueExpanded = !this.queueExpanded
    this.queueWrap.style.display = this.queueExpanded ? 'block' : 'none'
  }

  /** 全量重渲染队列(行数少、事件简单,diff 不值得)。行点击=切歌,行内 × =移除 */
  setQueue(rows: QueueRow[]): void {
    for (const el of this.queueRowEls) el.remove()
    this.queueRowEls = []
    for (const row of rows) {
      const rowEl = document.createElement('div')
      rowEl.setAttribute('data-role', 'queue-row')
      rowEl.setAttribute('data-id', String(row.id))
      rowEl.setAttribute('data-active', row.active ? '1' : '0')
      rowEl.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 7px 14px; cursor: pointer;
        color: ${row.active ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.6)'};
        background: ${row.active ? 'rgba(255, 255, 255, 0.07)' : 'transparent'};`
      rowEl.addEventListener('click', () => this.deps.onQueueSelect(row.id))
      const t = document.createElement('span')
      t.textContent = row.title
      t.style.cssText = `flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
      rowEl.appendChild(t)
      if (row.artist) {
        const a = document.createElement('span')
        a.textContent = row.artist
        a.style.cssText = `font-size: 11px; opacity: 0.5; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
        rowEl.appendChild(a)
      }
      const rm = this.makeButton(() => this.deps.onQueueRemove(row.id), 'row-remove')
      rm.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
      rm.addEventListener('click', (e) => e?.stopPropagation?.())
      rowEl.appendChild(rm)
      this.queueWrap.appendChild(rowEl)
      this.queueRowEls.push(rowEl)
    }
  }

  hide(): void {
    this.shown = false
    this.queueExpanded = false
    this.queueWrap.style.display = 'none'
    this.applyVisibility()
  }

  get element(): HTMLElement {
    return this.root
  }

  dispose(): void {
    this.root.remove()
  }
}
