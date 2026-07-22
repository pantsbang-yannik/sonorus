// 面板协调器（Phase A2 T2）：互斥（同一时刻至多一个面板打开）+ 按面板 retreatProfile 驱动
// 共享的 UiStage 退台包络 + 模态计数。BasePanel 本身不知道协调器存在，只对外广播
// onOpenChange——协调器 register 时接管这个 hook，据此仲裁互斥与退台路由。
import type { UiFocusProfile } from '../scenes/types'

/** 协调器只依赖面板的这几样——不要求具体是 BasePanel 实例，测试可用轻量假面板。
 * ignoreOutsideClickWithin 可选：不是所有 PanelLike 都需要接收触发容器（同 setTriggerContainers） */
export interface PanelLike {
  readonly retreatProfile: UiFocusProfile
  onOpenChange: ((open: boolean) => void) | null
  ignoreOutsideClickWithin?: HTMLElement[]
  close(): void
}

/** 协调器只依赖 UiStage 的这三个方法——真实 UiStage 结构兼容，测试可用假实现记录调用 */
export interface UiStageLike {
  push(): void
  pop(): void
  /** 切换退台画风，不重新起 tween——面板互斥切换时舞台已在 v=1，只需换 profile（见 ui-stage.ts） */
  setProfile(profile: UiFocusProfile): void
}

export interface PanelCoordinatorDeps {
  uiStage: UiStageLike
  setModal: (open: boolean) => void
}

export class PanelCoordinator {
  private readonly panels: PanelLike[] = []
  private openPanel: PanelLike | null = null
  /** 互斥切换中标志：关闭「他者」是内部切换的一步，不构成真正的全关，跳过 pop/模态收尾 */
  private switching = false
  /** setTriggerContainers 存下的触发容器（操作坞 + 右上角）——register() 里补设给晚注册的面板 */
  private triggerContainers: HTMLElement[] = []

  constructor(private readonly deps: PanelCoordinatorDeps) {}

  register(panel: PanelLike, profile: UiFocusProfile = panel.retreatProfile): void {
    this.panels.push(panel)
    panel.onOpenChange = (open) => this.handleOpenChange(panel, profile, open)
    if (this.triggerContainers.length) panel.ignoreOutsideClickWithin = this.triggerContainers
  }

  /** 登记触发容器（操作坞、右上模式角）：其内的点击不算「点外部」，防止图标关面板时被自己的
   * pointerdown 抢先 close 导致 toggle() 重开（Task A-toggle-fix）。回填给所有已注册面板 */
  setTriggerContainers(els: HTMLElement[]): void {
    this.triggerContainers = els
    for (const panel of this.panels) panel.ignoreOutsideClickWithin = els
  }

  private handleOpenChange(panel: PanelLike, profile: UiFocusProfile, open: boolean): void {
    if (open) {
      const wasAnyOpenBefore = this.openPanel !== null
      if (wasAnyOpenBefore && this.openPanel !== panel) {
        // 互斥：先关他者。其 close() 会同步回调 handleOpenChange(other, ..., false)——
        // switching 标志让那次回调只清 openPanel 记账，不触发 pop（本次仍有面板保持打开）
        this.switching = true
        this.openPanel!.close()
        this.switching = false
      }
      this.openPanel = panel
      this.deps.uiStage.setProfile(profile)
      if (!wasAnyOpenBefore) {
        this.deps.setModal(true)
        this.deps.uiStage.push()
      }
    } else {
      if (this.openPanel !== panel) return // 陈旧/非当前面板的关闭通知，忽略
      this.openPanel = null
      if (this.switching) return // 互斥切换内部的关闭一步，等新面板 open 完成即可，不单独收尾
      this.deps.setModal(false)
      this.deps.uiStage.pop()
    }
  }

  dispose(): void {
    for (const panel of this.panels) panel.onOpenChange = null
    this.panels.length = 0
    this.openPanel = null
  }
}
