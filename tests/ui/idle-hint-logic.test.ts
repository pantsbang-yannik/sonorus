// 空状态教学 + 权限闭环状态机（发布准备③ spec §2.1）：三态迁移全覆盖
import { describe, expect, it } from 'vitest'
import { IdleHintLogic, type IdleHintInput } from '../../src/ui/idle-hint-logic'

function input(patch: Partial<IdleHintInput> = {}): IdleHintInput {
  return { audible: false, hasTrack: false, captureUnavailable: false, suppressed: false, dt: 1, ...patch }
}

function tick(logic: IdleHintLogic, patch: Partial<IdleHintInput>, times: number): void {
  for (let i = 0; i < times; i++) logic.sample(input(patch))
}

describe('IdleHintLogic', () => {
  it('静置 25s 进 teach，不足不进（突变验证：24s 仍 hidden）', () => {
    const logic = new IdleHintLogic()
    tick(logic, {}, 24)
    expect(logic.state).toBe('hidden')
    tick(logic, {}, 1)
    expect(logic.state).toBe('teach')
  })

  it('teach 后来真声立即回 hidden 且计时清零', () => {
    const logic = new IdleHintLogic()
    tick(logic, {}, 25)
    expect(logic.state).toBe('teach')
    logic.sample(input({ audible: true }))
    expect(logic.state).toBe('hidden')
    tick(logic, {}, 24) // 清零后重新计，24s 不够
    expect(logic.state).toBe('hidden')
  })

  it('在播却静音 8s 进 permission（对齐 onboarding DENIED 口径），7s 不进', () => {
    const logic = new IdleHintLogic()
    tick(logic, { hasTrack: true }, 7)
    expect(logic.state).toBe('hidden')
    tick(logic, { hasTrack: true }, 1)
    expect(logic.state).toBe('permission')
  })

  it('teach 期间开始播歌（静音未到 8s）→ 教学文案不合语境，先藏', () => {
    const logic = new IdleHintLogic()
    tick(logic, {}, 25)
    expect(logic.state).toBe('teach')
    logic.sample(input({ hasTrack: true }))
    expect(logic.state).toBe('hidden')
  })

  it('captureUnavailable 直达 permission，不等交叉判定', () => {
    const logic = new IdleHintLogic()
    logic.sample(input({ captureUnavailable: true }))
    expect(logic.state).toBe('permission')
  })

  it('permission 粘滞：歌停了（去系统设置的半路）指引不消失，真声才解除', () => {
    const logic = new IdleHintLogic()
    tick(logic, { hasTrack: true }, 8)
    expect(logic.state).toBe('permission')
    tick(logic, {}, 30) // 无 track 静置很久，仍粘滞（不掉回 teach）
    expect(logic.state).toBe('permission')
    logic.sample(input({ audible: true }))
    expect(logic.state).toBe('hidden')
  })

  it('计时不得跨间隙累计：在播静音 7s → 空场 5s → 再在播 7s 仍 hidden，第 8s 才判（审②M2 突变杀手）', () => {
    const logic = new IdleHintLogic()
    tick(logic, { hasTrack: true }, 7)
    tick(logic, {}, 5) // 歌停了——在播计时必须清零
    tick(logic, { hasTrack: true }, 7)
    expect(logic.state).toBe('hidden')
    tick(logic, { hasTrack: true }, 1)
    expect(logic.state).toBe('permission')
  })

  it('教学计时被播歌打断后重启：空 20s → 在播 2s → 空 5s 仍 hidden（审②M1 突变杀手）', () => {
    const logic = new IdleHintLogic()
    tick(logic, {}, 20)
    tick(logic, { hasTrack: true }, 2) // 播了段无声的——idle 计时必须清零
    tick(logic, {}, 5)
    expect(logic.state).toBe('hidden')
    tick(logic, {}, 20) // 重新计满 25s 才教学
    expect(logic.state).toBe('teach')
  })

  it('suppressed 强制 hidden 且清零两只计时器', () => {
    const logic = new IdleHintLogic()
    tick(logic, { hasTrack: true }, 7)
    tick(logic, {}, 24)
    logic.sample(input({ suppressed: true }))
    expect(logic.state).toBe('hidden')
    tick(logic, { hasTrack: true }, 7) // 清零后 7s 不够判权限
    expect(logic.state).toBe('hidden')
    tick(logic, {}, 24) // idle 也被清过：24s 不够教学……
    expect(logic.state).toBe('hidden')
  })

  it('suppressed 也能解除 permission 粘滞（面板开着不叠提示）', () => {
    const logic = new IdleHintLogic()
    logic.sample(input({ captureUnavailable: true }))
    expect(logic.state).toBe('permission')
    logic.sample(input({ suppressed: true, captureUnavailable: true }))
    expect(logic.state).toBe('hidden')
  })
})
