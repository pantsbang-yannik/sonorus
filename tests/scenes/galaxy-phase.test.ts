import { describe, it, expect } from 'vitest'
import { galaxyStep } from '../../src/scenes/nebula/galaxy/phase'

describe('galaxyStep（模式相位机，评审 P0/P1 全序列锁死）', () => {
  it('off + apply(active) → dissolve 且发 beginDissolve', () => {
    expect(galaxyStep('off', { kind: 'apply', active: true }, true))
      .toEqual({ phase: 'dissolve', actions: ['beginDissolve'] })
  })
  it('dissolve + morphZero → on 且发 mount（谷底换目标）', () => {
    expect(galaxyStep('dissolve', { kind: 'morphZero' }, true))
      .toEqual({ phase: 'on', actions: ['mount'] })
  })
  it('on + apply(active) → 原地 setView', () => {
    expect(galaxyStep('on', { kind: 'apply', active: true }, true))
      .toEqual({ phase: 'on', actions: ['setView'] })
  })
  it('on/dissolve + apply(!active) → restore 且发 beginRestore（进入中途退出）', () => {
    expect(galaxyStep('on', { kind: 'apply', active: false }, false))
      .toEqual({ phase: 'restore', actions: ['beginRestore'] })
    expect(galaxyStep('dissolve', { kind: 'apply', active: false }, false))
      .toEqual({ phase: 'restore', actions: ['beginRestore'] })
  })
  it('restore + morphZero（view 已不要求进入）→ off 且发 exitRestore', () => {
    expect(galaxyStep('restore', { kind: 'morphZero' }, false))
      .toEqual({ phase: 'off', actions: ['exitRestore'] })
  })
  it('restore + morphZero（view 又要求进入了）→ 转 dissolve 重挂，不发 exitRestore（评审 P0：快速退出→再进入不丢）', () => {
    expect(galaxyStep('restore', { kind: 'morphZero' }, true))
      .toEqual({ phase: 'dissolve', actions: [] })
  })
  it('restore + apply(active) → 相位不动（等谷底转向），不丢调用', () => {
    expect(galaxyStep('restore', { kind: 'apply', active: true }, true))
      .toEqual({ phase: 'restore', actions: [] })
  })
  it('off + apply(!active) / on + morphZero → 无操作', () => {
    expect(galaxyStep('off', { kind: 'apply', active: false }, false))
      .toEqual({ phase: 'off', actions: [] })
    expect(galaxyStep('on', { kind: 'morphZero' }, true))
      .toEqual({ phase: 'on', actions: [] })
  })
})
