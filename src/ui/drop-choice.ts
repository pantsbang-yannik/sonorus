// 拖放用途选择条（自定义背景 v1 spec §二）：拖图松手后浮出「拼成图形 / 铺成背景」两大按钮（纯文字，产品禁 emoji）。
// 非 Panel 不进 PanelCoordinator（生命周期秒级，无场景退台语义）；Esc/点外部=取消无副作用；
// 开着时全窗口拖放挂起（main.ts isSuspended 汇流）。交互三件套镜像 shape-picker 既有实现。
export interface DropChoiceDeps {
  onShape: (f: File) => void
  onBackground: (f: File) => void
  /** 模态计数（快捷键/空闲提示压制走 main.ts 的 setModal 汇流） */
  setModalOpen?: (open: boolean) => void
}

const FONT = `-apple-system, "SF Pro Display", sans-serif`

export class DropChoice {
  private readonly container: HTMLElement
  private readonly titleEl: HTMLElement
  private readonly shapeBtn: HTMLElement
  private file: File | null = null
  private open_ = false
  private outsideClickTimer: ReturnType<typeof setTimeout> | null = null

  private onKey = (e: KeyboardEvent): void => {
    if (!this.open_) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      this.close()
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.open_) return
    if (this.container.contains(e.target as Node | null)) return
    this.close()
  }

  constructor(parent: HTMLElement, private deps: DropChoiceDeps) {
    this.container = document.createElement('div')
    this.container.setAttribute('data-role', 'drop-choice')
    this.container.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 22px 28px;
      border-radius: 16px;
      background: rgba(10, 12, 20, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(14px);
      font-family: ${FONT};
      font-weight: 300;
      letter-spacing: 0.06em;
      color: rgba(255, 255, 255, 0.85);
      z-index: 30;
      pointer-events: auto;
    `
    this.container.style.display = 'none' // 被测样式显式属性写（FakeEl 不解析 cssText）
    // #audelyra-overlay 根容器是 pointer-events:none（点击穿透到画布），可交互组件必须自己开回来
    // （shape-picker 同款纪律）。漏掉此行=整个浮层点击穿透：点按钮命中画布→触发点外部关闭，
    // 回调永不执行且外观像"选择成功"（亲验实锤的静默失效，fake DOM 测不出 CSS 穿透语义）
    this.container.style.pointerEvents = 'auto'
    this.titleEl = document.createElement('div')
    this.titleEl.textContent = '这张图想怎么用？'
    this.titleEl.style.cssText = 'font-size: 14px;'
    // 简要说明（v2 拍板：兑现背景开关告知）：铺成背景后主体粒子默认隐藏，可在调音台「背景」页开回
    const note = document.createElement('div')
    note.setAttribute('data-role', 'drop-choice-note')
    note.textContent = '铺成背景后，主体粒子默认隐藏——可在调音台「背景」页开回'
    note.style.cssText = 'font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: -6px;'
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; gap: 14px;'
    // 纯文字按钮（产品纪律：禁用 emoji 图标）
    this.shapeBtn = this.makeButton('拼成图形', 'drop-choice-shape', () => this.choose('shape'))
    btnRow.append(
      this.shapeBtn,
      this.makeButton('铺成背景', 'drop-choice-background', () => this.choose('background')),
    )
    this.container.append(this.titleEl, note, btnRow)
    parent.appendChild(this.container)
  }

  private makeButton(text: string, role: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('div')
    btn.textContent = text
    btn.setAttribute('data-role', role)
    btn.style.cssText = `
      padding: 12px 22px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      cursor: pointer;
      font-size: 13px;
    `
    btn.addEventListener('click', onClick)
    return btn
  }

  private choose(kind: 'shape' | 'background'): void {
    const f = this.file
    this.close()
    if (!f) return
    if (kind === 'shape') this.deps.onShape(f)
    else this.deps.onBackground(f)
  }

  /** 弹出选择条接管这个文件；backgroundOnly=视频（图形不适用，只亮铺成背景）。再次 ask 覆盖前一个（后拖的赢，前一个静默作废） */
  ask(file: File, opts?: { backgroundOnly?: boolean }): void {
    this.file = file
    const bgOnly = opts?.backgroundOnly === true
    this.titleEl.textContent = bgOnly ? '这个视频想怎么用？' : '这张图想怎么用？'
    this.shapeBtn.style.display = bgOnly ? 'none' : ''
    if (this.open_) return
    this.open_ = true
    this.container.style.display = 'flex'
    document.addEventListener('keydown', this.onKey, true)
    if (this.outsideClickTimer) clearTimeout(this.outsideClickTimer)
    // 点外部延迟注册（shape-picker 同款）：躲开触发 ask 的同一轮事件
    this.outsideClickTimer = setTimeout(() => {
      this.outsideClickTimer = null
      if (this.open_) document.addEventListener('pointerdown', this.onPointerDown, true)
    }, 0)
    this.deps.setModalOpen?.(true)
  }

  get isOpen(): boolean {
    return this.open_
  }

  close(): void {
    if (!this.open_) return
    this.open_ = false
    this.file = null
    this.container.style.display = 'none'
    document.removeEventListener('keydown', this.onKey, true)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    if (this.outsideClickTimer) {
      clearTimeout(this.outsideClickTimer)
      this.outsideClickTimer = null
    }
    this.deps.setModalOpen?.(false)
  }

  dispose(): void {
    this.close()
    this.container.remove()
  }
}
