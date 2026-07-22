// 星系模式相位机（纯 reducer，评审 P1-7）：index.ts 只负责执行 actions，转移逻辑全部在此可单测。
// 相位含义：off=live；dissolve=向星系溶解中；on=星系在场；restore=向 live 溶解中。
// caller 约定：morphZero 只在 dissolve/restore 相位、uMorph≤0.02 的帧发；viewActive=最近一次 applyGalaxy 的 active。
export type GalaxyPhase = 'off' | 'dissolve' | 'on' | 'restore'
export type GalaxyEvent = { kind: 'apply'; active: boolean } | { kind: 'morphZero' }
export type GalaxyAction = 'beginDissolve' | 'beginRestore' | 'mount' | 'setView' | 'exitRestore'

export function galaxyStep(
  phase: GalaxyPhase, e: GalaxyEvent, viewActive: boolean
): { phase: GalaxyPhase; actions: GalaxyAction[] } {
  if (e.kind === 'apply') {
    if (e.active) {
      if (phase === 'off') return { phase: 'dissolve', actions: ['beginDissolve'] }
      if (phase === 'on') return { phase: 'on', actions: ['setView'] }
      return { phase, actions: [] } // dissolve：谷底会读最新 view；restore：等谷底按 viewActive 转向
    }
    if (phase === 'on' || phase === 'dissolve') return { phase: 'restore', actions: ['beginRestore'] }
    return { phase, actions: [] }
  }
  // morphZero
  if (phase === 'dissolve') return { phase: 'on', actions: ['mount'] }
  if (phase === 'restore') {
    return viewActive ? { phase: 'dissolve', actions: [] } : { phase: 'off', actions: ['exitRestore'] }
  }
  return { phase, actions: [] }
}
