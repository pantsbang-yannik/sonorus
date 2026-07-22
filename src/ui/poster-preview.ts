// 媒体预览模态（idea #6 海报 / idea #8 Drop 视频共用）：快门后先看再定——「保存」落盘/「放弃」丢弃。
// kind:'image' 显示 <img>，kind:'video' 显示循环静音 <video>；两条竞态修复（聚焦审#1#2）对双形态同样生效。
// 风格随 onboarding：文字按钮 + opacity/blur 显影；模态语义（setModal/uiStage 退台）由装配层包裹。
const FONT = `-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`
const TRANSITION = `opacity 400ms cubic-bezier(0.33, 1, 0.68, 1), filter 400ms cubic-bezier(0.33, 1, 0.68, 1)`
const BTN_BASE_OPACITY = 0.55
const BTN_HOVER_OPACITY = 0.95

export type MediaChoice = 'save' | 'discard'

function makeTextButton(label: string, emphasized: boolean, onClick: () => void): HTMLElement {
  const el = document.createElement('span')
  el.textContent = label
  const base = emphasized ? 0.85 : BTN_BASE_OPACITY
  el.style.cssText = `
    cursor: pointer;
    pointer-events: auto;
    font-size: 13px;
    font-weight: ${emphasized ? 400 : 300};
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, ${base});
  `
  el.addEventListener('click', onClick)
  el.addEventListener('mouseenter', () => { el.style.color = `rgba(255, 255, 255, ${BTN_HOVER_OPACITY})` })
  el.addEventListener('mouseleave', () => { el.style.color = `rgba(255, 255, 255, ${base})` })
  return el
}

export class MediaPreview {
  private root: HTMLElement
  private media: HTMLImageElement | HTMLVideoElement
  private url: string | null = null
  private resolveChoice: ((c: MediaChoice) => void) | null = null
  /** 渐隐收尾定时器与待释放 URL：可取消（聚焦审#1——不可取消时「放弃后 450ms 内重拍」旧定时器
   * 会把新模态藏成全屏隐形拦截层），show 抢在其前会先行清理 */
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private staleUrl: string | null = null
  /** 挂 window capture 而非 document（聚焦审#2）：capture 相位 window 先于 document 触发，
   * 与注册顺序无关——面板开着时拍照，Esc 只弃海报不连带关面板（stopPropagation 拦住 document 层监听） */
  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.settle('discard')
  }

  constructor(parent: HTMLElement, opts: { kind: 'image' | 'video'; saveLabel: string }) {
    this.root = document.createElement('div')
    this.root.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      visibility: hidden;
      z-index: 9998;
      font-family: ${FONT};
      transition: ${TRANSITION};
    `
    // 点暗幕空白处=放弃（点海报/按钮不触发）
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.settle('discard')
    })

    if (opts.kind === 'video') {
      const v = document.createElement('video')
      v.autoplay = true
      v.loop = true
      v.muted = true
      v.playsInline = true
      this.media = v
    } else {
      this.media = document.createElement('img')
    }
    this.media.style.cssText = `
      max-height: 70vh;
      max-width: 80vw;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    `
    this.root.appendChild(this.media)

    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 48px; align-items: center;'
    row.appendChild(makeTextButton('放弃', false, () => this.settle('discard')))
    row.appendChild(makeTextButton(opts.saveLabel, true, () => this.settle('save')))
    this.root.appendChild(row)

    parent.appendChild(this.root)
  }

  /** 展示媒体待裁决；同一时刻只有一份（调用方 shutterBusy 保证），重复调用前一份按放弃结算 */
  show(blob: Blob): Promise<MediaChoice> {
    this.settle('discard') // 防御：不该发生，发生也别泄漏挂起的 Promise/URL
    // 抢在上一份的渐隐收尾之前：取消定时器、立即释放旧 URL（media.src 马上会被新媒体覆盖）
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.staleUrl) {
      URL.revokeObjectURL(this.staleUrl)
      this.staleUrl = null
    }
    this.url = URL.createObjectURL(blob)
    this.media.src = this.url
    this.root.style.visibility = 'visible'
    this.root.style.pointerEvents = 'auto'
    this.root.style.opacity = '1'
    this.root.style.filter = 'blur(0)'
    window.addEventListener('keydown', this.onKeydown, true)
    return new Promise<MediaChoice>((resolve) => { this.resolveChoice = resolve })
  }

  private settle(c: MediaChoice): void {
    if (!this.resolveChoice) return
    const resolve = this.resolveChoice
    this.resolveChoice = null
    window.removeEventListener('keydown', this.onKeydown, true)
    this.root.style.opacity = '0'
    this.root.style.filter = 'blur(6px)'
    this.root.style.pointerEvents = 'none'
    // 渐隐完再藏 + 释放 URL（时长同 TRANSITION；期间 pointer-events 已断，不会误点）
    this.staleUrl = this.url
    this.url = null
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.root.style.visibility = 'hidden'
      this.media.removeAttribute('src')
      if (this.media instanceof HTMLVideoElement) this.media.load() // 断开解码器持有的 blob 引用
      if (this.staleUrl) {
        URL.revokeObjectURL(this.staleUrl)
        this.staleUrl = null
      }
    }, 450)
    resolve(c)
  }
}
