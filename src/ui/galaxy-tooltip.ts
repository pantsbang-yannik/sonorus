// galaxy-tooltip.ts —— 星系悬停信息条（fb2）：星上方浮现 歌名 + 歌手·听过N次。
// 挂 parent（#sonorus-overlay 铁律）；pointer-events:none 不抢拾取；坐标由 director 逐帧上报（跟星走）。
// 样式家族同 tooltip.ts（半透明深色 + backdrop-blur + opacity/blur 显影）——那是挂静态元素的
// mouseenter 机制，这里是逐帧移动的 3D 星，机制不同故独立成类，视觉保持一家。
const FONT = `-apple-system, "SF Pro Display", "PingFang SC", sans-serif`
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const OFFSET_Y = 22 // 标签底边距星心 px：浮在光晕上方不压星

export class GalaxyTooltip {
  private el: HTMLElement
  private titleEl: HTMLElement
  private metaEl: HTMLElement
  private shownKey: string | null = null

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.id = 'galaxy-tooltip'
    this.el.style.cssText = `
      position: fixed;
      left: 0; top: 0;
      transform: translate(-50%, -100%);
      pointer-events: none;
      z-index: 9994;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 5px 11px;
      border-radius: 7px;
      background: rgba(20, 20, 26, 0.72);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      font-family: ${FONT};
      letter-spacing: 0.05em;
      white-space: nowrap;
      opacity: 0;
      filter: blur(6px);
      transition: opacity 180ms ${EASE}, filter 180ms ${EASE};
    `
    this.titleEl = document.createElement('div')
    this.titleEl.style.cssText = `font-size: 13px; font-weight: 400; color: rgba(255, 255, 255, 0.92);`
    this.metaEl = document.createElement('div')
    this.metaEl.style.cssText = `font-size: 11px; font-weight: 300; color: rgba(255, 255, 255, 0.55);`
    this.el.appendChild(this.titleEl)
    this.el.appendChild(this.metaEl)
    parent.appendChild(this.el)
  }

  /** 逐帧幂等：同星只挪位置（不重写文本不重触发过渡）；换星更新内容并显影 */
  show(key: string, title: string, artist: string, playCount: number, x: number, y: number): void {
    if (this.shownKey !== key) {
      this.shownKey = key
      this.titleEl.textContent = title
      this.metaEl.textContent = `${artist} · 听过 ${playCount} 次`
      this.el.style.opacity = '1'
      this.el.style.filter = 'blur(0)'
    }
    this.el.style.left = `${x}px`
    this.el.style.top = `${y - OFFSET_Y}px`
  }

  /** 逐帧幂等：已隐藏时零开销 */
  hide(): void {
    if (this.shownKey === null) return
    this.shownKey = null
    this.el.style.opacity = '0'
    this.el.style.filter = 'blur(6px)'
  }
}
