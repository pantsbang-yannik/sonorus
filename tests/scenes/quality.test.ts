import { describe, it, expect } from 'vitest'
import { TIERS, pickInitialTier, FpsGovernor } from '../../src/scenes/shared/quality'

describe('档位', () => {
  it('webgpu 初档 high（不许默认最高档），webgl 初档 mid', () => {
    expect(pickInitialTier('webgpu').name).toBe('high')
    expect(pickInitialTier('webgl').name).toBe('mid')
    expect(TIERS.low.bloom).toBe(false)
  })
})

describe('FpsGovernor', () => {
  function feed(gov: FpsGovernor, fps: number, seconds: number) {
    const actions: string[] = []
    for (let i = 0; i < Math.round(seconds * fps); i++) actions.push(gov.push(1 / fps))
    return actions.filter((a) => a !== 'keep')
  }
  it('达标不动作；持续低帧按序降级：DPR → 后期 → 涟漪 → 粒子 → floor', () => {
    const gov = new FpsGovernor({ targetFps: 55, windowSec: 1 })
    expect(feed(gov, 60, 3)).toEqual([])
    expect(feed(gov, 30, 1.5)).toContain('lowerDpr')
    expect(feed(gov, 30, 1.5)).toContain('disablePost')
    expect(feed(gov, 30, 1.5)).toContain('dropBgRipple')
    expect(feed(gov, 30, 1.5)).toContain('lowerParticles')
    expect(feed(gov, 30, 1.5)).toContain('floor')
  })
  it('降级后帧率恢复则不再继续降', () => {
    const gov = new FpsGovernor({ targetFps: 55, windowSec: 1 })
    feed(gov, 30, 1.5) // 触发一次 lowerDpr
    expect(feed(gov, 60, 3)).toEqual([])
  })
  // 对抗性回归：均值必须是 frames/acc（总帧数/总时长，时间加权）而非逐帧 1/dt 求算术平均——
  // 后者会被单帧 dt 极小的异常帧成倍放大读数（1 帧 dt=0.5ms 能把整窗 30fps 的真实卡顿
  // 拉成"达标"），dt=0 更会把整窗污染成 Infinity。这条测试防止未来换回脆弱算法。
  it('真实 30fps 卡顿混入极短帧与 dt=0 帧仍触发降级', () => {
    const gov = new FpsGovernor({ targetFps: 55, windowSec: 1 })
    const actions: string[] = []
    for (let i = 0; i < 60; i++) {
      actions.push(gov.push(1 / 30))
      if (i % 10 === 0) {
        actions.push(gov.push(0.0005)) // 计时器毛刺：极短异常帧
        actions.push(gov.push(0)) // 零 dt 帧：1/dt→Infinity 的污染源
      }
    }
    expect(actions.filter((a) => a !== 'keep')).toContain('lowerDpr')
  })
})

describe('背景降级（虚空之镜；亲验 fb1 修订①：倒影退役，序列缩至 5 级）', () => {
  it('降级序列：DPR→后期→涟漪→粒子→floor', () => {
    const g = new FpsGovernor({ targetFps: 55, windowSec: 1 })
    const actions: string[] = []
    for (let t = 0; t < 40 && !actions.includes('floor'); t += 0.05) {
      const a = g.push(0.05) // 20fps 持续低于 46.75 阈值
      if (a !== 'keep') actions.push(a)
    }
    expect(actions).toEqual(['lowerDpr', 'disablePost', 'dropBgRipple', 'lowerParticles', 'floor'])
  })
  it('档位背景能力：high 全套 / mid 无近尘 / low 全关', () => {
    expect(TIERS.high.background).toEqual({ auroraDetail: 'full', ripple: true, nearDust: true })
    expect(TIERS.ultra.background).toEqual(TIERS.high.background)
    expect(TIERS.mid.background).toEqual({ auroraDetail: 'full', ripple: true, nearDust: false })
    expect(TIERS.low.background).toEqual({ auroraDetail: 'simple', ripple: false, nearDust: false })
  })
})
