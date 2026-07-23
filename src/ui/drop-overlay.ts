// 全窗口拖放遮罩（idea #12 Task 7）：拖图到窗口任意处即可创建自定义形状——纯视觉反馈层，
// 真正的 drop 处理挂在 window（capture），遮罩本身 pointer-events: none（铁律：不放可点元素）。
// root 挂 parent（main.ts 传 #audelyra-overlay，仓库惯例 UI 全在 overlayDiv）：z-index 9996 在
// overlayDiv 内部与轻提示（9997/9999）正确排序——拖拽中 toast 仍在遮罩之上，不会被暗幕盖住。
const FONT = `-apple-system, "PingFang SC", sans-serif`

export interface DropOverlayDeps {
  onDropFiles: (files: File[]) => void
  /** 创建面板开着时挂起：面板自带局部拖放区，避免双热区抢 drop（main.ts 接 shapeCreate.isOpen） */
  isSuspended?: () => boolean
}

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

export class DropOverlay {
  private root: HTMLElement
  private inner: HTMLElement
  /** 进出子元素会连续触发 dragenter/dragleave 抖动——计数器抵消，归零才真正隐藏 */
  private depth = 0

  private onDragEnter = (e: DragEvent): void => {
    e.preventDefault() // 不 preventDefault 则 drop 不触发
    if (this.deps.isSuspended?.() || !hasFiles(e)) return
    // 拖动中 files 不可读但 items 的 MIME 可读(Chromium):音频给播放文案,其余保持拼图文案
    const mime = e.dataTransfer?.items?.[0]?.type ?? ''
    this.inner.textContent = mime.startsWith('audio/') ? '松手，开始播放' : '松手，拼出你的图'
    this.depth++
    this.show()
  }

  private onDragOver = (e: DragEvent): void => {
    e.preventDefault()
  }

  private onDragLeave = (): void => {
    if (this.deps.isSuspended?.()) return
    this.depth = Math.max(0, this.depth - 1)
    if (this.depth === 0) this.hide()
  }

  private onDrop = (e: DragEvent): void => {
    e.preventDefault()
    this.depth = 0
    this.hide()
    if (this.deps.isSuspended?.()) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) this.deps.onDropFiles(files)
  }

  constructor(parent: HTMLElement, private deps: DropOverlayDeps) {
    this.root = document.createElement('div')
    this.root.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.35);
      pointer-events: none;
      opacity: 0;
      z-index: 9996;
      font-family: ${FONT};
      transition: opacity 300ms cubic-bezier(0.33, 1, 0.68, 1);
    `
    this.root.style.pointerEvents = 'none'
    this.root.style.opacity = '0'

    this.inner = document.createElement('div')
    this.inner.style.cssText = `
      width: calc(100% - 48px);
      height: calc(100% - 48px);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed rgba(255, 255, 255, 0.4);
      border-radius: 16px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 20px;
      font-weight: 300;
      letter-spacing: 0.06em;
    `
    this.root.appendChild(this.inner)
    parent.appendChild(this.root)

    window.addEventListener('dragenter', this.onDragEnter, true)
    window.addEventListener('dragover', this.onDragOver, true)
    window.addEventListener('dragleave', this.onDragLeave, true)
    window.addEventListener('drop', this.onDrop, true)
  }

  private show(): void {
    this.root.style.opacity = '1'
  }

  private hide(): void {
    this.root.style.opacity = '0'
  }

  dispose(): void {
    window.removeEventListener('dragenter', this.onDragEnter, true)
    window.removeEventListener('dragover', this.onDragOver, true)
    window.removeEventListener('dragleave', this.onDragLeave, true)
    window.removeEventListener('drop', this.onDrop, true)
    this.root.remove()
  }
}
