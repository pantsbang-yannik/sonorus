import { describe, it, expect } from 'vitest'
import { NebulaStateMachine } from '../../src/scenes/nebula/state'

function run(m: NebulaStateMachine, sec: number, silence: boolean, hasTarget: boolean) {
  const steps = Math.round(sec * 60)
  for (let i = 0; i < steps; i++) m.update(1 / 60, { silence, hasTarget })
}

describe('NebulaStateMachine', () => {
  it('初始 sleep；第一个声音 → awakening → (无封面) nebula', () => {
    const m = new NebulaStateMachine({ awakeningSec: 1 })
    expect(m.state).toBe('sleep')
    run(m, 0.5, false, false)
    expect(m.state).toBe('awakening')
    expect(m.awakenProgress).toBeGreaterThan(0.3)
    run(m, 0.6, false, false)
    expect(m.state).toBe('nebula')
    expect(m.awakenProgress).toBe(1)
  })
  it('苏醒时已有封面 → 直入 cover；封面得失切换 cover↔nebula', () => {
    const m = new NebulaStateMachine({ awakeningSec: 0.5 })
    run(m, 0.6, false, true)
    expect(m.state).toBe('cover')
    run(m, 0.1, false, false)
    expect(m.state).toBe('nebula')
    run(m, 0.1, false, true)
    expect(m.state).toBe('cover')
  })
  it('静默持续 10s 才入睡，中途有声重置计时', () => {
    const m = new NebulaStateMachine({ awakeningSec: 0.1, sleepAfterSec: 10 })
    run(m, 0.2, false, false) // 醒来
    run(m, 8, true, false)
    expect(m.state).toBe('nebula') // 8s 还没睡
    run(m, 1, false, false)        // 有声打断
    run(m, 9, true, false)
    expect(m.state).toBe('nebula') // 重新计时，9s 未到
    run(m, 1.5, true, false)
    expect(m.state).toBe('sleep')
    expect(m.awakenProgress).toBe(0)
  })
  it('awakeningSec 可动态设置：苏醒中调整只影响剩余速率，progress 不回退', () => {
    const m = new NebulaStateMachine({ awakeningSec: 2 })
    run(m, 0.5, false, false) // 醒到 progress 0.25
    const p = m.awakenProgress
    m.awakeningSec = 0.5      // 改快
    m.update(1 / 60, { silence: false, hasTarget: false })
    expect(m.awakenProgress).toBeGreaterThan(p) // 不回退且继续前进
  })
  it('hasTarget 泛化（Phase B1 T3）：几何形状目标同样进入 cover（=有形态）态', () => {
    const sm = new NebulaStateMachine({ awakeningSec: 0.1 })
    sm.update(0.05, { silence: false, hasTarget: false }) // sleep→awakening
    sm.update(0.2, { silence: false, hasTarget: false }) // awakening 完成→nebula
    expect(sm.state).toBe('nebula')
    sm.update(0.016, { silence: false, hasTarget: true }) // 形状目标就绪（不必是封面）
    expect(sm.state).toBe('cover')
    sm.update(0.016, { silence: false, hasTarget: false })
    expect(sm.state).toBe('nebula')
  })
})
