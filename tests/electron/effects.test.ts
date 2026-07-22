import { describe, it, expect } from 'vitest'
import { applySettingsEffects, type EffectsDeps } from '../../electron/effects'
import { DEFAULT_SETTINGS, type SonorusSettings } from '../../electron/settings'

const make = (): { deps: EffectsDeps; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    deps: {
      setLoginItem: (v) => calls.push(`login:${v}`),
      startPowerBlocker: () => { calls.push('blocker:start'); return 7 },
      stopPowerBlocker: (id) => calls.push(`blocker:stop:${id}`)
    }
  }
}
const s = (patch: Partial<SonorusSettings>): SonorusSettings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('applySettingsEffects', () => {
  it('首次（prev=null）全量应用 loginItem；默认不开防休眠', () => {
    const { deps, calls } = make()
    const id = applySettingsEffects(null, DEFAULT_SETTINGS, null, deps)
    expect(calls).toContain('login:false')
    expect(id).toBeNull()
  })

  it('preventSleep 开 → 启动 blocker 并返回 id；再关 → 停掉并返回 null', () => {
    const { deps, calls } = make()
    const id = applySettingsEffects(DEFAULT_SETTINGS, s({ preventSleep: true }), null, deps)
    expect(id).toBe(7)
    const id2 = applySettingsEffects(s({ preventSleep: true }), DEFAULT_SETTINGS, id, deps)
    expect(id2).toBeNull()
    expect(calls).toContain('blocker:stop:7')
  })

  it('preventSleep 持续开着不重复 start（幂等）', () => {
    const { deps, calls } = make()
    const id = applySettingsEffects(s({ preventSleep: true }), s({ preventSleep: true, tier: 'low' }), 7, deps)
    expect(id).toBe(7)
    expect(calls.filter((c) => c === 'blocker:start')).toEqual([])
  })

  it('launchAtLogin 变化才调 setLoginItem', () => {
    const { deps, calls } = make()
    applySettingsEffects(DEFAULT_SETTINGS, s({ launchAtLogin: true }), null, deps)
    expect(calls).toContain('login:true')
    calls.length = 0
    applySettingsEffects(s({ launchAtLogin: true }), s({ launchAtLogin: true, tier: 'mid' }), null, deps)
    expect(calls).toEqual([]) // 无关字段变化不触发副作用
  })
})
