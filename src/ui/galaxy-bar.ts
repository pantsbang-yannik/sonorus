// galaxy-bar.ts —— 星系图鉴顶部时间筛选条：全部/最近7天/最近30天 chips + 空态文案 + 周年提示。
// 挂 parent（#sonorus-overlay 铁律）；top:64 避开 28px 拖拽区（fb2 铁律：拖拽区内不许放可点元素），
// 与海报 savedToast 短暂重叠可接受（亲验点）。显隐/色值家族同操作坞（500ms 过渡、0.95/0.45 选中态）。
import type { GalaxyFilter } from '../scenes/nebula/galaxy/types'

const FONT = `-apple-system, "PingFang SC", sans-serif`
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'
const SELECTED_COLOR = 'rgba(255, 255, 255, 0.95)'
const BASE_COLOR = 'rgba(255, 255, 255, 0.45)'
const HOVER_COLOR = 'rgba(255, 255, 255, 0.7)'
const EMPTY_TEXT = '你的宇宙正在等待第一颗星'

export interface GalaxyBarDeps {
  onFilterChange: (f: GalaxyFilter) => void
}

interface ChipEntry {
  filter: GalaxyFilter
  el: HTMLButtonElement
}

/** 筛选档是否等价——不比较对象引用，比较语义（kind + 附带的 days/date） */
function sameFilter(a: GalaxyFilter, b: GalaxyFilter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'range' && b.kind === 'range') return a.days === b.days
  if (a.kind === 'day' && b.kind === 'day') return a.date === b.date
  return true // 两者都是 'all'
}

export class GalaxyBar {
  private container: HTMLElement
  private emptyEl: HTMLElement
  private chipsRow: HTMLElement
  private anniversaryEl: HTMLElement
  private titleBlock: HTMLElement
  private titleEl: HTMLElement
  private titleSubEl: HTMLElement
  private baseChips: ChipEntry[] = []
  /** 'day' 档的动态追加 chip（含 × 关闭），setFilter 时按需重建 */
  private dayChip: ChipEntry | null = null
  private currentFilter: GalaxyFilter = { kind: 'all' }
  private isEmpty = true
  private anniversaryData: { label: string; title: string; onClick: () => void } | null = null

  constructor(parent: HTMLElement, private deps: GalaxyBarDeps) {
    this.container = document.createElement('div')
    this.container.id = 'galaxy-bar'
    this.container.style.cssText = `
      position: fixed;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      z-index: 9994;
      font-family: ${FONT};
      font-weight: 300;
      letter-spacing: 0.04em;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.85);
      white-space: nowrap;
      transition: opacity 500ms ${EASE}, filter 500ms ${EASE};
    `

    this.emptyEl = document.createElement('div')
    this.emptyEl.textContent = EMPTY_TEXT
    this.emptyEl.style.display = 'none'
    this.container.appendChild(this.emptyEl)

    this.chipsRow = document.createElement('div')
    this.chipsRow.style.cssText = `display: flex; gap: 18px;`
    this.container.appendChild(this.chipsRow)

    const specs: { label: string; filter: GalaxyFilter }[] = [
      { label: '全部', filter: { kind: 'all' } },
      { label: '最近 7 天', filter: { kind: 'range', days: 7 } },
      { label: '最近 30 天', filter: { kind: 'range', days: 30 } }
    ]
    for (const spec of specs) {
      const entry = this.makeChip(spec.label, spec.filter, () => this.deps.onFilterChange(spec.filter))
      this.baseChips.push(entry)
      this.chipsRow.appendChild(entry.el)
    }

    this.anniversaryEl = document.createElement('div')
    this.anniversaryEl.style.cssText = `
      cursor: pointer;
      display: none;
      color: rgba(255, 255, 255, 0.7);
      transition: color 200ms;
    `
    this.anniversaryEl.addEventListener('mouseenter', () => { this.anniversaryEl.style.color = SELECTED_COLOR })
    this.anniversaryEl.addEventListener('mouseleave', () => { this.anniversaryEl.style.color = 'rgba(255, 255, 255, 0.7)' })
    this.container.appendChild(this.anniversaryEl)

    parent.appendChild(this.container)

    // 左上角大标题（fb1：用户要清晰的模式身份）。独立定位于拖拽条(28px)下方，不挂在 chips 容器上——
    // 与 container 分离但共享显隐节奏（show/hide 里同步两者 opacity/filter），纯展示不可点
    this.titleBlock = document.createElement('div')
    this.titleBlock.id = 'galaxy-title'
    this.titleBlock.style.cssText = `
      position: fixed;
      left: 36px;
      top: 44px;
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      z-index: 9994;
      transition: opacity 500ms ${EASE}, filter 500ms ${EASE};
    `
    this.titleEl = document.createElement('div')
    this.titleEl.textContent = '星系图鉴'
    this.titleEl.style.cssText = `
      font-family: ${FONT};
      font-weight: 300;
      font-size: 28px;
      color: rgba(255, 255, 255, 0.92);
      letter-spacing: 0.12em;
    `
    this.titleBlock.appendChild(this.titleEl)

    this.titleSubEl = document.createElement('div')
    this.titleSubEl.style.cssText = `
      font-family: ${FONT};
      font-weight: 300;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.45);
      letter-spacing: 0.06em;
      margin-top: 6px;
    `
    this.titleBlock.appendChild(this.titleSubEl)

    parent.appendChild(this.titleBlock)
  }

  private makeChip(label: string, filter: GalaxyFilter, onClick: () => void): ChipEntry {
    const el = document.createElement('button')
    el.textContent = label
    el.style.cssText = `
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font: inherit;
      color: ${BASE_COLOR};
      transition: color 200ms;
    `
    el.addEventListener('click', onClick)
    // 悬停反馈同全站按钮惯例（选中态不被悬停覆盖，鼠标移开靠 applyChipStyles 幂等复位）
    el.addEventListener('mouseenter', () => {
      if (el.style.color !== SELECTED_COLOR) el.style.color = HOVER_COLOR
    })
    el.addEventListener('mouseleave', () => this.applyChipStyles())
    return { el, filter }
  }

  private allChips(): ChipEntry[] {
    return this.dayChip ? [...this.baseChips, this.dayChip] : this.baseChips
  }

  private applyChipStyles(): void {
    for (const chip of this.allChips()) {
      chip.el.style.color = sameFilter(chip.filter, this.currentFilter) ? SELECTED_COLOR : BASE_COLOR
    }
  }

  private render(): void {
    this.emptyEl.style.display = this.isEmpty ? 'block' : 'none'
    this.chipsRow.style.display = this.isEmpty ? 'none' : 'flex'
    const showAnniv = !this.isEmpty && this.anniversaryData !== null
    this.anniversaryEl.style.display = showAnniv ? 'block' : 'none'
    if (showAnniv && this.anniversaryData) {
      this.anniversaryEl.textContent = `${this.anniversaryData.label}，你在听《${this.anniversaryData.title}》`
      this.anniversaryEl.onclick = this.anniversaryData.onClick
    } else {
      this.anniversaryEl.onclick = null
    }
  }

  /** starCount=0 → 只显示空态文案，chips/周年提示一并让位（真正为空时没什么可筛的）；
   * 标题始终显示（标题答"在哪"，空态文案答"缺什么"，两者不冲突） */
  show(starCount: number): void {
    this.isEmpty = starCount === 0
    this.render()
    this.titleSubEl.textContent = this.isEmpty ? '等待第一颗星' : `${starCount} 颗星`
    this.container.style.opacity = '1'
    this.container.style.filter = 'blur(0)'
    this.container.style.pointerEvents = 'auto'
    this.titleBlock.style.opacity = '1'
    this.titleBlock.style.filter = 'blur(0)'
  }

  hide(): void {
    this.container.style.opacity = '0'
    this.container.style.filter = 'blur(6px)'
    this.container.style.pointerEvents = 'none'
    this.titleBlock.style.opacity = '0'
    this.titleBlock.style.filter = 'blur(6px)'
  }

  /** 高亮当前档；kind 'day' 时追加「YYYY-MM-DD ×」chip，点击整枚 chip 即回 all（唯一可做的事——
   * day 档只能靠场景拾取进入，这里只负责退出） */
  setFilter(f: GalaxyFilter): void {
    this.currentFilter = f
    if (this.dayChip) {
      this.dayChip.el.remove()
      this.dayChip = null
    }
    if (f.kind === 'day') {
      const entry = this.makeChip(`${f.date} ×`, f, () => this.deps.onFilterChange({ kind: 'all' }))
      this.dayChip = entry
      this.chipsRow.appendChild(entry.el)
    }
    this.applyChipStyles()
  }

  /** 「{label}，你在听《{title}》」，点击跳那一天；null 隐藏 */
  showAnniversary(a: { label: string; title: string; onClick: () => void } | null): void {
    this.anniversaryData = a
    this.render()
  }

  dispose(): void {
    this.container.remove()
    this.titleBlock.remove()
  }
}
