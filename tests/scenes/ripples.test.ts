import { describe, it, expect } from 'vitest'
import {
  RippleController, RIPPLE_MAX, RIPPLE_STRENGTH_MIN, RIPPLE_COOLDOWN_SEC, RIPPLE_LIFE_SEC, RIPPLE_DROP_STRENGTH,
} from '../../src/scenes/nebula/ripples'

const quiet = { onBeat: false, strength: 0, dropEdge: false, silence: false, sleeping: false, gain: 1 }
const beat = (strength: number) => ({ ...quiet, onBeat: true, strength })

describe('RippleController（防海面化④：稀疏而郑重）', () => {
  it('强拍过门槛才起圈；弱拍忽略', () => {
    const c = new RippleController()
    expect(c.update(0.016, beat(RIPPLE_STRENGTH_MIN - 0.01))).toHaveLength(0)
    expect(c.update(0.016, beat(RIPPLE_STRENGTH_MIN))).toHaveLength(1)
  })
  it('冷却期内的强拍被吞；冷却结束恢复', () => {
    const c = new RippleController()
    c.update(0.016, beat(0.9))
    expect(c.update(0.1, beat(0.9))).toHaveLength(1) // 0.1s < 0.4s 冷却
    expect(c.update(RIPPLE_COOLDOWN_SEC, beat(0.9))).toHaveLength(2)
  })
  it('并发上限 3：第 4 圈被丢弃', () => {
    const c = new RippleController()
    for (let i = 0; i < 5; i++) c.update(RIPPLE_COOLDOWN_SEC + 0.01, beat(0.9))
    expect(c.update(0.016, quiet).length).toBeLessThanOrEqual(RIPPLE_MAX)
  })
  it('生命周期：age 超 LIFE 出列', () => {
    const c = new RippleController()
    c.update(0.016, beat(0.9))
    expect(c.update(RIPPLE_LIFE_SEC + 0.1, quiet)).toHaveLength(0)
  })
  it('drop 大涟漪：无视冷却、清空小圈、强度=RIPPLE_DROP_STRENGTH', () => {
    const c = new RippleController()
    c.update(0.016, beat(0.9))
    const out = c.update(0.016, { ...quiet, dropEdge: true })
    expect(out).toHaveLength(1)
    expect(out[0].strength).toBeCloseTo(RIPPLE_DROP_STRENGTH)
  })
  it('silence/sleeping/gain=0 不起圈（存量继续衰老）', () => {
    const c = new RippleController()
    c.update(0.016, beat(0.9))
    expect(c.update(0.5, { ...beat(0.9), silence: true })).toHaveLength(1)  // 不新增
    expect(c.update(0.5, { ...beat(0.9), sleeping: true })).toHaveLength(1)
    expect(c.update(0.5, { ...beat(0.9), gain: 0 })).toHaveLength(1)
  })
  it('gain 缩放强度（滑杆语义）', () => {
    const c = new RippleController()
    const out = c.update(0.016, { ...beat(0.8), gain: 0.5 })
    expect(out[0].strength).toBeCloseTo(0.4)
  })
})
