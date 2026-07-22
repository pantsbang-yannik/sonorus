// 设置的主进程副作用（M4 设计 2.4：主进程侧项直接应用）。纯决策函数，electron API 经 deps 注入。
import type { SonorusSettings } from './settings'

export interface EffectsDeps {
  setLoginItem: (open: boolean) => void
  startPowerBlocker: () => number
  stopPowerBlocker: (id: number) => void
}

/**
 * 按 prev→next 差异应用副作用；prev=null 表示启动首次全量应用。
 * 返回新的 powerSaveBlocker id（null=未阻止休眠）——调用方持有并在下次传回。
 */
export function applySettingsEffects(
  prev: SonorusSettings | null,
  next: SonorusSettings,
  blockerId: number | null,
  deps: EffectsDeps
): number | null {
  if (!prev || prev.launchAtLogin !== next.launchAtLogin) deps.setLoginItem(next.launchAtLogin)
  if (next.preventSleep && blockerId === null) return deps.startPowerBlocker()
  if (!next.preventSleep && blockerId !== null) {
    deps.stopPowerBlocker(blockerId)
    return null
  }
  return blockerId
}
