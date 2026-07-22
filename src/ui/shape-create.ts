// 自定义形状创建面板（idea #12 Task 7）：小模态——拖图/点击选图 或 输入文字，二选一创建收藏形状。
// 模态结构镜像 poster-preview.ts 的惯例（居中容器/Esc capture 关/遮罩点击关/opacity 过渡）；
// 玻璃拟态样式复用 shape-picker.ts 的卡片 token（rgba 背景 + 1px 描边 + backdrop-filter）。
const FONT = `-apple-system, "PingFang SC", sans-serif`
const TRANSITION = `opacity 350ms cubic-bezier(0.33, 1, 0.68, 1), filter 350ms cubic-bezier(0.33, 1, 0.68, 1)`
const HIDE_DELAY_MS = 350
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif'

export interface ShapeCreateDeps {
  onSubmitImage: (file: File) => void
  onSubmitText: (text: string) => void
  setModalOpen: (open: boolean) => void // 接 main.ts modalCount（面板开着时主进程不抢焦点）
}

export class ShapeCreatePanel {
  private root: HTMLElement
  private fileInput: HTMLInputElement
  private textInput: HTMLInputElement
  private confirmBtn: HTMLButtonElement
  private dropZone: HTMLElement
  private open_ = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  /** 挂 window capture（同 poster-preview 惯例）：Esc 只弃本面板，不连带关其它可能同开的模态 */
  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.close()
  }

  constructor(parent: HTMLElement, private deps: ShapeCreateDeps) {
    this.root = document.createElement('div')
    this.root.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      visibility: hidden;
      z-index: 9997;
      font-family: ${FONT};
      transition: ${TRANSITION};
    `
    // 初始隐藏态用显式属性写入（tests/ui 的 fakeElement 不解析 cssText，惯例同 shape-picker.ts）
    this.root.style.visibility = 'hidden'
    this.root.style.pointerEvents = 'none'
    this.root.style.opacity = '0'
    // 点暗幕空白处=关闭（e.target 只在点击原始元素时等于 root，点面板内部元素不触发）
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close()
    })

    const panel = document.createElement('div')
    panel.style.cssText = `
      width: 360px;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
      padding: 24px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    `
    this.root.appendChild(panel)

    // 拖图/点击选图区（局部拖放：与全窗口 DropOverlay 互斥，见 main.ts 总装的 isSuspended 接线）
    this.dropZone = document.createElement('div')
    this.dropZone.style.cssText = `
      height: 140px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 0 16px;
      border: 1px dashed rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
      cursor: pointer;
      transition: border-color 200ms, background 200ms;
    `
    this.dropZone.textContent = '拖一张图到这里，或点击选择'
    this.dropZone.addEventListener('click', () => this.fileInput.click())
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault() // 不 preventDefault 则 drop 不触发
      this.dropZone.style.borderColor = 'rgba(160, 200, 255, 0.6)'
    })
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)'
    })
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault()
      this.dropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)'
      const file = e.dataTransfer?.files?.[0]
      if (file) { this.deps.onSubmitImage(file); this.close() }
    })
    panel.appendChild(this.dropZone)

    this.fileInput = document.createElement('input')
    this.fileInput.type = 'file'
    this.fileInput.accept = ACCEPT
    this.fileInput.style.display = 'none'
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0]
      this.fileInput.value = '' // 重置：同一文件可重选（change 事件才会再触发）
      if (file) { this.deps.onSubmitImage(file); this.close() }
    })
    panel.appendChild(this.fileInput)

    const divider = document.createElement('div')
    divider.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      color: rgba(255, 255, 255, 0.35);
      font-size: 12px;
    `
    const line1 = document.createElement('div')
    line1.style.cssText = 'flex: 1; height: 1px; background: rgba(255, 255, 255, 0.12);'
    const orText = document.createElement('span')
    orText.textContent = '或'
    const line2 = document.createElement('div')
    line2.style.cssText = 'flex: 1; height: 1px; background: rgba(255, 255, 255, 0.12);'
    divider.appendChild(line1)
    divider.appendChild(orText)
    divider.appendChild(line2)
    panel.appendChild(divider)

    const textRow = document.createElement('div')
    textRow.style.cssText = 'display: flex; gap: 10px; align-items: center;'
    this.textInput = document.createElement('input')
    this.textInput.maxLength = 30
    this.textInput.placeholder = '输一段字，拼出来'
    this.textInput.style.cssText = `
      flex: 1;
      min-width: 0;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.9);
      font-size: 13px;
      font-family: ${FONT};
      outline: none;
    `
    this.confirmBtn = document.createElement('button')
    this.confirmBtn.textContent = '确认'
    this.confirmBtn.style.cssText = `
      flex: 0 0 auto;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: rgba(160, 200, 255, 0.85);
      color: rgba(10, 14, 20, 0.9);
      font-size: 13px;
      cursor: pointer;
    `
    // 空输入 disabled：input 事件维护，显式属性写（同 fakeElement 约束）
    this.confirmBtn.disabled = true
    this.textInput.addEventListener('input', () => {
      this.confirmBtn.disabled = this.textInput.value.trim() === ''
    })
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.confirmBtn.disabled) this.submitText()
    })
    this.confirmBtn.addEventListener('click', () => this.submitText())
    textRow.appendChild(this.textInput)
    textRow.appendChild(this.confirmBtn)
    panel.appendChild(textRow)

    parent.appendChild(this.root)
  }

  private submitText(): void {
    const t = this.textInput.value.trim()
    if (t === '') return
    this.deps.onSubmitText(t)
    this.close()
  }

  get isOpen(): boolean {
    return this.open_
  }

  open(): void {
    if (this.open_) return
    this.open_ = true
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.textInput.value = ''
    this.confirmBtn.disabled = true
    this.root.style.visibility = 'visible'
    this.root.style.pointerEvents = 'auto'
    this.root.style.opacity = '1'
    this.root.style.filter = 'blur(0)'
    window.addEventListener('keydown', this.onKeydown, true)
    this.deps.setModalOpen(true)
  }

  close(): void {
    if (!this.open_) return
    this.open_ = false
    this.root.style.opacity = '0'
    this.root.style.filter = 'blur(6px)'
    this.root.style.pointerEvents = 'none'
    window.removeEventListener('keydown', this.onKeydown, true)
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.root.style.visibility = 'hidden'
    }, HIDE_DELAY_MS)
    this.deps.setModalOpen(false)
  }

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    window.removeEventListener('keydown', this.onKeydown, true)
    this.root.remove()
  }
}
