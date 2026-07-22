// 设置面板——收敛到 BasePanel（Phase A2 T2）：外壳/显影/开合/Esc/点外部关/退台接线均由基座提供，
// 本文件只留内容（addRow 选项行）与单向环刷新逻辑。
// 单向环纪律：点击只 deps.setSettings 上行，选中态永远等 deps.onSettingsChanged 回流刷新，
// 本地绝不直接改选中态——防止与主进程的落盘状态失步（见 M4 计划②第 2 节设计）
import { BasePanel } from './base-panel'

/** 面板自带的设置形状——不 import src/main.ts 的 RendererSettings（局部类型不导出，
 * 形状重复声明是仓库惯例，tsc 在 main.ts 接线处兜结构一致）
 * 批2 搬家：粒子歌名/歌词两组迁入调音台「歌词歌名」tab，本面板回归纯系统项 */
export type PanelSettings = {
  tier: 'auto' | 'high' | 'mid' | 'low'
  launchAtLogin: boolean
  preventSleep: boolean
  onboarded: boolean
  updateCheck: { enabled: boolean; skippedVersion: string | null }
}

export interface PanelDeps {
  getSettings: () => Promise<PanelSettings>
  setSettings: (p: Partial<PanelSettings>) => void
  onSettingsChanged: (cb: (s: PanelSettings) => void) => void
  // 版本行（发布准备② fb1）：版本号展示 + 手动检查更新（动作不走单向环，结果经 update:status 回流）
  getVersion: () => Promise<string>
  onCheckUpdate: () => void
  // 诊断行（发布准备③）：导出本地诊断报告（结果经顶部轻提示回音，不走单向环）
  onExportDiagnostics: () => void
}

/** 一个可点选项（如"低"）：点击触发的 patch + 用于回流刷新时判断是否选中的谓词。
 * patch 可为函数（更新检查开关需带上当前 skippedVersion 整对象回写，防 sanitize 把记账冲掉） */
interface OptionSpec {
  label: string
  patch: Partial<PanelSettings> | ((s: PanelSettings) => Partial<PanelSettings>)
  match: (s: PanelSettings) => boolean
}

/** 渲染出的选项 span + 其选中态谓词——回流刷新时用来重算 opacity */
interface OptionEntry {
  el: HTMLElement
  selected: boolean
  match: (s: PanelSettings) => boolean
}

const SELECTED_OPACITY = '0.85'
const UNSELECTED_OPACITY = '0.35'
const HOVER_OPACITY = '0.6'

export class SettingsPanel extends BasePanel {
  private entries: OptionEntry[] = []
  /** 最近一次回流的设置快照——函数型 patch 的输入（首次回流前点击函数型选项不生效，播种极快可忽略） */
  private latest: PanelSettings | null = null

  constructor(parent: HTMLElement, private deps: PanelDeps) {
    super(parent, { id: 'settings-panel', title: '设置', retreatProfile: 'full' })

    this.addRow('性能', [
      { label: '自动', patch: { tier: 'auto' }, match: (s) => s.tier === 'auto' },
      { label: '高', patch: { tier: 'high' }, match: (s) => s.tier === 'high' },
      { label: '中', patch: { tier: 'mid' }, match: (s) => s.tier === 'mid' },
      { label: '低', patch: { tier: 'low' }, match: (s) => s.tier === 'low' }
    ])
    this.addRow('开机自启', [
      { label: '开', patch: { launchAtLogin: true }, match: (s) => s.launchAtLogin },
      { label: '关', patch: { launchAtLogin: false }, match: (s) => !s.launchAtLogin }
    ])
    this.addRow('防休眠', [
      { label: '开', patch: { preventSleep: true }, match: (s) => s.preventSleep },
      { label: '关', patch: { preventSleep: false }, match: (s) => !s.preventSleep }
    ])
    // 发布准备②：自动检查更新是除歌词外唯一的主动网络请求，可关守隐私；
    // 联网事实须在文案言明（spec 隐私拍板，审②I2）——「（联网）」不能省
    this.addRow('自动检查更新（联网）', [
      { label: '开', patch: (s) => ({ updateCheck: { ...s.updateCheck, enabled: true } }), match: (s) => s.updateCheck.enabled },
      { label: '关', patch: (s) => ({ updateCheck: { ...s.updateCheck, enabled: false } }), match: (s) => !s.updateCheck.enabled }
    ])
    this.addVersionRow()
    this.addActionRow('诊断', '导出报告', () => this.deps.onExportDiagnostics(), 'export-diagnostics')

    // 选中态只有两个来源：启动播种（getSettings）与后续回流（onSettingsChanged），两者共用同一 refresh
    deps.onSettingsChanged((s) => this.refresh(s))
    void deps.getSettings().then((s) => this.refresh(s))
  }

  private addRow(label: string, options: OptionSpec[]): void {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; justify-content: space-between; gap: 32px; white-space: nowrap;'

    const labelEl = document.createElement('span')
    labelEl.textContent = label
    labelEl.style.cssText = 'color: rgba(255, 255, 255, 0.5);'

    const valuesEl = document.createElement('span')

    options.forEach((opt) => {
      const span = document.createElement('span')
      span.textContent = opt.label
      span.style.cssText = `cursor: pointer; margin-left: 16px; color: rgba(255, 255, 255, ${UNSELECTED_OPACITY});`

      const entry: OptionEntry = { el: span, selected: false, match: opt.match }
      this.entries.push(entry)

      // 点击只上行 setSettings，不本地改选中态——等 onSettingsChanged 回流统一刷新（单向环纪律）
      span.addEventListener('click', () => {
        if (typeof opt.patch === 'function') {
          if (this.latest) this.deps.setSettings(opt.patch(this.latest))
        } else {
          this.deps.setSettings(opt.patch)
        }
      })
      span.addEventListener('mouseenter', () => {
        if (!entry.selected) span.style.color = `rgba(255, 255, 255, ${HOVER_OPACITY})`
      })
      span.addEventListener('mouseleave', () => {
        span.style.color = `rgba(255, 255, 255, ${entry.selected ? SELECTED_OPACITY : UNSELECTED_OPACITY})`
      })

      valuesEl.appendChild(span)
    })

    row.appendChild(labelEl)
    row.appendChild(valuesEl)
    this.appendRow(row)
  }

  /** 版本行（fb1）：左「版本」右「x.y.z ＋ 检查更新」。检查更新是动作不是设置——点击直接上行
   * onCheckUpdate，不进 entries 不参与选中态刷新；结果（已是最新/新版卡片）经 update:status 回渲染层 */
  private addVersionRow(): void {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; justify-content: space-between; gap: 32px; white-space: nowrap;'

    const labelEl = document.createElement('span')
    labelEl.textContent = '版本'
    labelEl.style.cssText = 'color: rgba(255, 255, 255, 0.5);'

    const valuesEl = document.createElement('span')
    const verEl = document.createElement('span')
    verEl.style.cssText = 'margin-left: 16px; color: rgba(255, 255, 255, 0.35);'
    void this.deps.getVersion().then((v) => { verEl.textContent = v })

    const checkEl = document.createElement('span')
    checkEl.textContent = '检查更新'
    checkEl.style.cssText = `cursor: pointer; margin-left: 16px; color: rgba(255, 255, 255, ${UNSELECTED_OPACITY});`
    checkEl.addEventListener('click', () => this.deps.onCheckUpdate())
    checkEl.addEventListener('mouseenter', () => { checkEl.style.color = `rgba(255, 255, 255, ${HOVER_OPACITY})` })
    checkEl.addEventListener('mouseleave', () => { checkEl.style.color = `rgba(255, 255, 255, ${UNSELECTED_OPACITY})` })

    valuesEl.appendChild(verEl)
    valuesEl.appendChild(checkEl)
    row.appendChild(labelEl)
    row.appendChild(valuesEl)
    this.appendRow(row)
  }

  /** 纯动作行（发布准备③ 诊断行）：左标签右单动作，点击直接上行回调，不进 entries 不参与选中态刷新 */
  private addActionRow(label: string, action: string, onClick: () => void, role: string): void {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; justify-content: space-between; gap: 32px; white-space: nowrap;'

    const labelEl = document.createElement('span')
    labelEl.textContent = label
    labelEl.style.cssText = 'color: rgba(255, 255, 255, 0.5);'

    const actionEl = document.createElement('span')
    actionEl.setAttribute('data-role', role)
    actionEl.textContent = action
    actionEl.style.cssText = `cursor: pointer; margin-left: 16px; color: rgba(255, 255, 255, ${UNSELECTED_OPACITY});`
    actionEl.addEventListener('click', onClick)
    actionEl.addEventListener('mouseenter', () => { actionEl.style.color = `rgba(255, 255, 255, ${HOVER_OPACITY})` })
    actionEl.addEventListener('mouseleave', () => { actionEl.style.color = `rgba(255, 255, 255, ${UNSELECTED_OPACITY})` })

    row.appendChild(labelEl)
    row.appendChild(actionEl)
    this.appendRow(row)
  }

  /** 用最新设置重算每个选项的选中态（唯一改选中态的入口） */
  private refresh(s: PanelSettings): void {
    this.latest = s
    for (const entry of this.entries) {
      entry.selected = entry.match(s)
      entry.el.style.color = `rgba(255, 255, 255, ${entry.selected ? SELECTED_OPACITY : UNSELECTED_OPACITY})`
    }
  }
}
