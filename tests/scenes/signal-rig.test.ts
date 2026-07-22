import { describe, it, expect } from 'vitest'
import { SignalRig, KICK_GAMMA, KICK_FLOOR, type RigUniforms } from '../../src/scenes/nebula/signal-rig'
import type { Signals } from '../../src/engine/types'

function mkUniforms(): RigUniforms {
  return {
    uDrive: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uEnergy: { value: 0 },
    uBeat: { value: 0 }, uBeatGlow: { value: 0 }, uDrop: { value: 0 },
    uSleepBreath: { value: 0 },
    uKick: { value: 0 }, uKickMode: { value: 0 }, uBeatAge: { value: 2 },
    uKickEnv: { value: 0 }, uTempo: { value: 1 }
  }
}
function mkSignal(over: Partial<Signals> = {}): Signals {
  return {
    t: 0, loudness: { instant: 0.8, smooth: 0.8 }, bands: { low: 0.6, mid: 0.2, high: 0.005 },
    spectrum: new Float32Array(512), beat: { onBeat: false, strength: 0 }, bpm: 120,
    energy: 0.5, drop: false, silence: false, ...over
  }
}

describe('SignalRig', () => {
  it('drive 跟随响度包络；活跃频段（相对自身峰值）推力大，静默频段被下限压住', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 60; i++) rig.update(1 / 60, mkSignal())
    expect(u.uDrive.value).toBeGreaterThan(0.6)
    // low=0.6 达自身滚动峰值 → rel≈1；high=0.005 < 0.02 下限 → rel≈0.25
    expect(u.uLow.value).toBeGreaterThan(u.uHigh.value * 2)
    expect(u.uEnergy.value).toBeGreaterThan(0.2) // energy=0.5 经 (0.08,2.0) 包络
  })
  it('鼓点站位相邻不重复且在 0..4；两种打击模式在 12 拍内都出现', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    const sites: number[] = []
    let maxBeat = 0
    let maxGlow = 0
    for (let i = 0; i < 12; i++) {
      sites.push(rig.update(1 / 60, mkSignal({ beat: { onBeat: true, strength: 1 } })))
      maxBeat = Math.max(maxBeat, u.uBeat.value)
      maxGlow = Math.max(maxGlow, u.uBeatGlow.value)
    }
    for (let i = 0; i < sites.length; i++) {
      expect(sites[i]).toBeGreaterThanOrEqual(0)
      expect(sites[i]).toBeLessThan(5)
      if (i > 0) expect(sites[i]).not.toBe(sites[i - 1])
    }
    // 哈希由拍序号决定 → 确定性；12 拍内两路必然都被触发过
    expect(maxBeat).toBeGreaterThan(0.5)
    expect(maxGlow).toBeGreaterThan(0.5)
  })
  it('uKick 单帧语义：鼓点帧非零（弱拍有 0.34 下限），下一帧归零；kickMode ∈ {0,1,2}', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    rig.update(1 / 60, mkSignal({ beat: { onBeat: true, strength: 0.2 } })) // 弱检测拍
    // T10d 打击锐化复位：strength^GAMMA 幂次放大 + 下限 FLOOR——信号缝 bug 修复后力度有真实对比度，
    // 下限只兜"完全没力"的底，不再把弱拍抹平到"够狠"（fb5 对位重标定 GAMMA 1.35→1.7：0.2^1.7≈0.065 → floor 0.34）
    expect(u.uKick.value).toBeCloseTo(KICK_FLOOR, 5)
    expect([0, 1, 2]).toContain(u.uKickMode.value)
    expect(u.uBeatAge.value).toBeLessThan(0.05) // 打击时钟归零起步
    rig.update(1 / 60, mkSignal())
    expect(u.uKick.value).toBe(0) // 单帧冲量：下一帧必归零
    expect(u.uBeatAge.value).toBeGreaterThan(0) // 时钟继续走
  })
  it('打击锐化幂次：强拍近满值、中位拍明显轻——强弱分明（fb5 对位重标定 GAMMA=1.7：0.9→0.84，0.55→0.36）', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    rig.update(1 / 60, mkSignal({ beat: { onBeat: true, strength: 0.9 } }))
    const strong = u.uKick.value
    expect(strong).toBeCloseTo(Math.pow(0.9, KICK_GAMMA), 5)
    const u2 = mkUniforms()
    const rigMid = new SignalRig(u2)
    // 0.5^1.7≈0.308 会被下限 0.34 吃掉（不再体现幂次本身），改用 0.55（0.55^1.7≈0.362，刚好在下限之上）
    rigMid.update(1 / 60, mkSignal({ beat: { onBeat: true, strength: 0.55 } }))
    const mid = u2.uKick.value
    expect(mid).toBeCloseTo(Math.pow(0.55, KICK_GAMMA), 5)
    expect(strong / mid).toBeGreaterThan(2) // 幂次放大后强弱对比 ≥2×（旧线性+0.55 下限只有 1.6×）
  })
  it('uKickEnv AR 起落：有限 attack（首帧不满血=无瞬移），3 帧内达峰，~0.35s 落到 1/7 以下', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    rig.update(1 / 60, mkSignal({ beat: { onBeat: true, strength: 1 } }))
    const first = u.uKickEnv.value
    expect(first).toBeGreaterThan(0.1) // 已经在动
    expect(first).toBeLessThan(0.999) // 但不是瞬移满值——位置连续性铁律
    rig.update(1 / 60, mkSignal())
    rig.update(1 / 60, mkSignal())
    const peak = u.uKickEnv.value
    expect(peak).toBeGreaterThan(0.85) // 3 帧（50ms）内到位——依然干脆
    for (let i = 0; i < 20; i++) rig.update(1 / 60, mkSignal()) // ≈0.33s ≈ 3 个半衰期
    expect(u.uKickEnv.value).toBeLessThan(peak / 7) // 频谱柱级快落
  })
  it('uTempo 跟随 BPM（110 为基准 1.0，钳 0.7..1.6）；bpm null 回归 1', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 600; i++) rig.update(1 / 60, mkSignal({ bpm: 176 }))
    expect(u.uTempo.value).toBeGreaterThan(1.4) // 176/110=1.6 封顶
    for (let i = 0; i < 600; i++) rig.update(1 / 60, mkSignal({ bpm: 60 }))
    expect(u.uTempo.value).toBeLessThan(0.8) // 60/110 → 钳到 0.7
    for (let i = 0; i < 600; i++) rig.update(1 / 60, mkSignal({ bpm: null }))
    expect(u.uTempo.value).toBeGreaterThan(0.9) // 无 BPM 回基准
  })
  it('无鼓点帧返回 -1；drop 信号与 triggerDrop 都注入 uDrop；null 信号下全部衰减', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    expect(rig.update(1 / 60, mkSignal())).toBe(-1)
    rig.update(1 / 60, mkSignal({ drop: true }))
    expect(u.uDrop.value).toBeGreaterThan(0.8)
    for (let i = 0; i < 600; i++) rig.update(1 / 60, null)
    expect(u.uDrive.value).toBeLessThan(0.05)
    expect(u.uDrop.value).toBeLessThan(0.05)
    rig.triggerDrop(0.9) // 场景侧冲量入口（苏醒仪式路径）
    rig.update(1 / 60, null)
    expect(u.uDrop.value).toBeGreaterThan(0.7)
  })
})

describe('SignalRig 三层化（Phase C1 T3）', () => {
  it('uMid 通道：mid 活跃时跟随（与 low/high 同款 归一×drive 包络）', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 60; i++) rig.update(1 / 60, mkSignal({ bands: { low: 0.1, mid: 0.7, high: 0.005 } }))
    expect(u.uMid.value).toBeGreaterThan(0.4) // mid=0.7 达自身滚动峰值 rel≈1 × drive≈0.8
    expect(u.uMid.value).toBeGreaterThan(u.uHigh.value * 2)
  })
  it('band attack 缩短（T12b）：高频到来 0.1s 内 uHigh 已过 0.6（旧 0.1s attack 只能到 ~0.5）', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 120; i++) rig.update(1 / 60, mkSignal({ bands: { low: 0.1, mid: 0.1, high: 0.001 } }))
    for (let i = 0; i < 6; i++) rig.update(1 / 60, mkSignal({ bands: { low: 0.1, mid: 0.1, high: 0.6 } }))
    expect(u.uHigh.value).toBeGreaterThan(0.6)
  })
  it('叙事态暴露：drop 信号帧后 rig.narrative.phase === burst；null 信号回 steady 输入', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    // 叙事有 5s 冷启动免疫：先喂 5.5s 平稳信号
    for (let i = 0; i < 330; i++) rig.update(1 / 60, mkSignal({ energy: 0.5 }))
    expect(rig.narrative.phase).toBe('steady')
    rig.update(1 / 60, mkSignal({ energy: 0.8, drop: true }))
    expect(rig.narrative.phase).toBe('burst')
    expect(rig.narrative.progress).toBeGreaterThan(0.9)
  })
})

describe('T10a 双重平滑拆除（Phase C1 T4）', () => {
  it('uEnergy 快起：段落能量到来 0.2s 内已过 0.6（旧 0.5s attack 只能到 ~0.26）', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 12; i++) rig.update(1 / 60, mkSignal({ energy: 0.8 }))
    expect(u.uEnergy.value).toBeGreaterThan(0.6)
  })
  it('uEnergy 慢落：能量离场 1s 后仍 >0.35（release 2.0 保留，安静段软边界缓收不塌）', () => {
    const u = mkUniforms()
    const rig = new SignalRig(u)
    for (let i = 0; i < 120; i++) rig.update(1 / 60, mkSignal({ energy: 0.8 }))
    for (let i = 0; i < 60; i++) rig.update(1 / 60, mkSignal({ energy: 0 }))
    expect(u.uEnergy.value).toBeGreaterThan(0.35)
    expect(u.uEnergy.value).toBeLessThan(0.6)
  })
})
