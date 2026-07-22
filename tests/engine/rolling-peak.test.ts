import { describe, it, expect } from 'vitest'
import { RollingPeak } from '../../src/engine/rolling-peak'

describe('RollingPeak', () => {
  it('恒定输入 → 相对值 1；峰值随半衰期衰减后小输入相对值回升', () => {
    const rp = new RollingPeak(30, 1e-4)
    for (let i = 0; i < 60; i++) rp.update(0.5, 1 / 60)
    expect(rp.update(0.5, 1 / 60)).toBeCloseTo(1, 5)
    // 30s 半衰期：静默 30s 后 peak 减半，同幅输入相对值仍 1，半幅输入 ≈1
    for (let i = 0; i < 1800; i++) rp.update(0, 1 / 60)
    expect(rp.update(0.25, 1 / 60)).toBeCloseTo(1, 1)
  })
  it('floor 防无声抬满：v << floor 时相对值被压低', () => {
    const rp = new RollingPeak(30, 0.02)
    expect(rp.update(0.005, 1 / 60)).toBeCloseTo(0.25, 2) // 0.005/0.02
  })
  it('seed 播种防冷启动打满', () => {
    const rp = new RollingPeak(30, 1e-4)
    rp.seed(0.5)
    expect(rp.update(0.1, 1 / 60)).toBeCloseTo(0.2, 2) // 相对已播种的峰值
  })
})
