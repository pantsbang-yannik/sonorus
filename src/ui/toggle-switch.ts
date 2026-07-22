// iOS 风格透明白开关（Phase A2 T4）：调音台「启用」控件从文字/复选换成滑块气质。
// 白色带透明度，非品牌色——与面板整体的白/透明设计语言同源（同 base-panel 的 rgba(255,255,255,*) 层级）。

export interface ToggleSwitchOptions {
  checked: boolean
  onChange: (on: boolean) => void
}

const TRACK_WIDTH = 34
const TRACK_HEIGHT = 20
const THUMB_SIZE = 16
const THUMB_MARGIN = 2
const TRACK_OFF = 'rgba(255, 255, 255, 0.14)'
const TRACK_ON = 'rgba(255, 255, 255, 0.32)'
const THUMB_COLOR = 'rgba(255, 255, 255, 0.9)'
const TRANSITION_MS = 200

export class ToggleSwitch {
  private readonly track: HTMLElement
  private readonly thumb: HTMLElement
  private checked: boolean

  constructor(parent: HTMLElement, private readonly opts: ToggleSwitchOptions) {
    this.checked = opts.checked

    this.track = document.createElement('div')
    this.track.style.cssText = `
      position: relative;
      display: inline-block;
      flex: none;
      width: ${TRACK_WIDTH}px;
      height: ${TRACK_HEIGHT}px;
      border-radius: ${TRACK_HEIGHT / 2}px;
      cursor: pointer;
      transition: background-color ${TRANSITION_MS}ms ease;
    `

    this.thumb = document.createElement('div')
    this.thumb.style.cssText = `
      position: absolute;
      top: ${THUMB_MARGIN}px;
      left: ${THUMB_MARGIN}px;
      width: ${THUMB_SIZE}px;
      height: ${THUMB_SIZE}px;
      border-radius: 50%;
      background: ${THUMB_COLOR};
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      transition: transform ${TRANSITION_MS}ms ease;
    `

    this.track.appendChild(this.thumb)
    this.track.addEventListener('click', () => {
      this.checked = !this.checked
      this.paint()
      this.opts.onChange(this.checked)
    })
    this.paint()

    parent.appendChild(this.track)
  }

  get el(): HTMLElement {
    return this.track
  }

  /** 外部同步态——不触发 onChange（区别于用户点击） */
  setChecked(on: boolean): void {
    this.checked = on
    this.paint()
  }

  private paint(): void {
    this.track.style.backgroundColor = this.checked ? TRACK_ON : TRACK_OFF
    const travel = TRACK_WIDTH - THUMB_SIZE - THUMB_MARGIN * 2
    this.thumb.style.transform = `translateX(${this.checked ? travel : 0}px)`
  }

  dispose(): void {
    this.track.remove()
  }
}
