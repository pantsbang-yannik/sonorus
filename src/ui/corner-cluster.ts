import { BadgeVisibility } from './track-badge'
import { attachTooltip } from './tooltip'
import type { DockMode } from './control-dock'

const ICON_SIZE = 18
const BASE_COLOR = 'rgba(255, 255, 255, 0.45)'
const HOVER_COLOR = 'rgba(255, 255, 255, 0.85)'

// 三枚图标沿用既有画法（设置/星系原样迁自 control-dock，全屏迁自 FullscreenButton）
const SETTINGS_SVG = '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
const GALAXY_SVG = '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
  '<path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5 0 2.6-2.1 3.9-4.2 3.2"/>' +
  '<path d="M12 20.5c-4.7 0-8.5-3.8-8.5-8.5 0-2.6 2.1-3.9 4.2-3.2"/>' +
  '<circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none"/>' +
  '<circle cx="6" cy="17" r="0.9" fill="currentColor" stroke="none"/>'
const FULLSCREEN_SVG = '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'

export interface CornerClusterDeps {
  setWindowMode: (m: DockMode) => void
  /** 星系图鉴：与全屏并肩的模式级切换（主界面布局重组：自操作坞迁入） */
  toggleGalaxy: () => void
  /** 设置：系统组，独立 34px 大间距（同上迁入；就近右上面板弹出位） */
  toggleSettings: () => void
}

/**
 * 右上「模式/系统角」——设置 ｜ 星系图鉴 · 全屏（主界面布局重组，替代 FullscreenButton）。
 * 从角落往内：全屏（最角落，肌肉记忆 + Fitts）→ 星系图鉴 →｜34px｜→ 设置。
 * 显隐模型复用 BadgeVisibility hover 显影；fullscreen 态只藏全屏枚（退出走 Esc/⌃⌘F/双击），
 * 星系/设置两态恒可用。top 34px + no-drag：顶部 28px 是 OS 级拖拽区，会吞点击（既往教训）。
 */
export class CornerCluster {
  private visibility: BadgeVisibility
  private container: HTMLElement
  /** 全屏按钮节点——fullscreen 态单独 display:none，其余两枚不受影响 */
  private fsBtn: HTMLElement
  /** 上次写入 DOM 的可见状态——去重，visible 变化才写样式（同 dock/角标） */
  private lastVisibleState: boolean | null = null
  private tooltipCleanups: (() => void)[] = []

  constructor(parent: HTMLElement, private deps: CornerClusterDeps) {
    this.visibility = new BadgeVisibility(3)

    this.container = document.createElement('div')
    this.container.id = 'corner-cluster'
    this.container.style.cssText = `
      position: fixed;
      right: 24px;
      top: 34px;
      display: flex;
      gap: 34px;
      pointer-events: none;
      opacity: 0;
      filter: blur(6px);
      transition: opacity 500ms cubic-bezier(0.33, 1, 0.68, 1),
                  filter 500ms cubic-bezier(0.33, 1, 0.68, 1);
    `
    ;(this.container.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'no-drag'

    const sysGroup = document.createElement('div')
    sysGroup.style.cssText = 'display: flex; gap: 18px;'
    sysGroup.appendChild(this.makeButton('设置', '⌘,', SETTINGS_SVG, () => this.deps.toggleSettings()))

    const modeGroup = document.createElement('div')
    modeGroup.style.cssText = 'display: flex; gap: 18px;'
    modeGroup.appendChild(this.makeButton('星系图鉴', undefined, GALAXY_SVG, () => this.deps.toggleGalaxy()))
    this.fsBtn = this.makeButton('全屏', '⌃⌘F', FULLSCREEN_SVG, () => this.deps.setWindowMode('fullscreen'))
    modeGroup.appendChild(this.fsBtn)

    this.container.appendChild(sysGroup)
    this.container.appendChild(modeGroup)
    parent.appendChild(this.container)
  }

  setMode(m: DockMode): void {
    this.fsBtn.style.display = m === 'fullscreen' ? 'none' : ''
  }

  setEnabled(on: boolean): void {
    this.visibility.setEnabled(on)
    this.updateDOM()
  }

  pokeActivity(): void {
    this.visibility.poke()
  }

  update(dt: number): void {
    this.visibility.update(dt)
    this.updateDOM()
  }

  get visible(): boolean {
    return this.visibility.visible
  }

  /** 容器节点——供 PanelCoordinator.setTriggerContainers 登记为点外部关的忽略区（设置钮在此） */
  get element(): HTMLElement {
    return this.container
  }

  private makeButton(title: string, shortcut: string | undefined, svg: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button')
    this.tooltipCleanups.push(attachTooltip(btn, title, 'bottom', shortcut))
    btn.style.cssText = `
      pointer-events: auto;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      color: ${BASE_COLOR};
      transition: color 200ms;
    `
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="${ICON_SIZE}" height="${ICON_SIZE}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`
    btn.addEventListener('click', onClick)
    btn.addEventListener('mouseenter', () => { btn.style.color = HOVER_COLOR })
    btn.addEventListener('mouseleave', () => { btn.style.color = BASE_COLOR })
    return btn
  }

  private updateDOM(): void {
    if (this.visible === this.lastVisibleState) return
    this.lastVisibleState = this.visible
    if (this.visible) {
      this.container.style.opacity = '1'
      this.container.style.filter = 'blur(0)'
    } else {
      this.container.style.opacity = '0'
      this.container.style.filter = 'blur(6px)'
    }
  }

  dispose(): void {
    for (const cleanup of this.tooltipCleanups) cleanup()
    this.tooltipCleanups = []
    this.container.remove()
  }
}
