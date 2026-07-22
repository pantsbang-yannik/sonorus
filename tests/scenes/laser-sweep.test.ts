import { describe, it, expect } from 'vitest'
import { LaserSweep, LASER_POOL, LASER_TOP_POOL, LASER_BOTTOM_POOL, LASER_BEAMS_MIN, LASER_SPREAD_MIN, LASER_SPREAD_MAX, type LaserInputs } from '../../src/scenes/nebula/linework/laser-sweep'

const DT = 1 / 60
const calm: LaserInputs = { onBeat: false, strength: 0, dropEdge: false, silence: false, sleeping: false, energy: 0.2, rateMul: 1, spreadMul: 1, speedMul: 1, chaos: 0, maxCount: 14 }
const beat = { ...calm, onBeat: true, strength: 0.9 }
const mkEv = (overrides: Partial<LaserInputs> = {}): LaserInputs => ({ ...calm, ...overrides })
const spreadOf = (s: LaserSweep) => Math.max(...s.angles) - Math.min(...s.angles)

describe('LaserSweep(图形三连:激光束角状态机)', () => {
  it('束池=16,初始角有限', () => {
    const s = new LaserSweep()
    expect(s.angles.length).toBe(LASER_POOL)
    for (const a of s.angles) expect(Number.isFinite(a)).toBe(true)
  })
  it('能量→扇开角单调:高能稳态张角 > 低能稳态张角', () => {
    const lo = new LaserSweep(); const hi = new LaserSweep()
    for (let i = 0; i < 120; i++) {
      lo.update(1 / 60, { ...calm, energy: 0.1 })
      hi.update(1 / 60, { ...calm, energy: 1.0 })
    }
    expect(spreadOf(hi)).toBeGreaterThan(spreadOf(lo))
    expect(spreadOf(hi)).toBeLessThanOrEqual(2 * LASER_SPREAD_MAX * 1.2)
    expect(spreadOf(lo)).toBeGreaterThan(LASER_SPREAD_MIN * 0.5)
  })
  it('beat 跳位:跳后角度轨迹偏离无跳对照', () => {
    const a = new LaserSweep(); const b = new LaserSweep()
    for (let i = 0; i < 60; i++) { a.update(1 / 60, calm); b.update(1 / 60, calm) }
    a.update(1 / 60, beat); b.update(1 / 60, calm)
    for (let i = 0; i < 30; i++) { a.update(1 / 60, calm); b.update(1 / 60, calm) }
    expect(Math.abs(a.angles[0] - b.angles[0])).toBeGreaterThan(0.01)
  })
  it('阻尼连续:beat 跳位单帧角度变化有界(不瞬移)', () => {
    const s = new LaserSweep()
    for (let i = 0; i < 60; i++) s.update(1 / 60, calm)
    const before = [...s.angles]
    s.update(1 / 60, beat)
    for (let i = 0; i < LASER_POOL; i++) {
      expect(Math.abs(s.angles[i] - before[i])).toBeLessThan(0.06)
    }
  })
  it('冷却期第二拍不再跳:两次连续 beat 与一次 beat 的轨迹一致', () => {
    const a = new LaserSweep(); const b = new LaserSweep()
    for (let i = 0; i < 60; i++) { a.update(1 / 60, calm); b.update(1 / 60, calm) }
    a.update(1 / 60, beat); b.update(1 / 60, beat)
    a.update(1 / 60, beat); b.update(1 / 60, calm) // a 第二拍落在冷却内
    for (let i = 0; i < 30; i++) { a.update(1 / 60, calm); b.update(1 / 60, calm) }
    expect(a.angles[0]).toBeCloseTo(b.angles[0], 5)
  })
  it('silence 收拢:稳态张角回落到 SPREAD_MIN 档', () => {
    const s = new LaserSweep()
    for (let i = 0; i < 120; i++) s.update(1 / 60, { ...calm, energy: 1 })
    for (let i = 0; i < 240; i++) s.update(1 / 60, { ...calm, silence: true, energy: 1 })
    expect(spreadOf(s)).toBeLessThanOrEqual(2 * LASER_SPREAD_MIN + 0.05)
  })
  it('乱度确定性:同输入序列两实例逐帧一致(trace 回放契约)', () => {
    const a = new LaserSweep(); const b = new LaserSweep()
    const seq = [calm, beat, calm, { ...beat, chaos: 1 }, { ...calm, chaos: 1 }]
    for (let i = 0; i < 90; i++) {
      const ev = { ...seq[i % seq.length], chaos: 0.8 }
      a.update(1 / 60, ev); b.update(1 / 60, ev)
    }
    for (let i = 0; i < LASER_POOL; i++) expect(a.angles[i]).toBe(b.angles[i])
  })
  it('乱度改变跳位轨迹:chaos=1 与 chaos=0 在同一 beat 序列后角度分道', () => {
    const reg = new LaserSweep(); const wild = new LaserSweep()
    for (let i = 0; i < 60; i++) { reg.update(1 / 60, calm); wild.update(1 / 60, { ...calm, chaos: 1 }) }
    reg.update(1 / 60, beat); wild.update(1 / 60, { ...beat, chaos: 1 })
    for (let i = 0; i < 60; i++) { reg.update(1 / 60, calm); wild.update(1 / 60, { ...calm, chaos: 1 }) }
    // 注:比较 angles[1] 而非 angles[0]——beam 0 的相位偏移量(i*0.7=0)使该场景下
    // chaos=0/1 两路相位差恰巧接近 2π 整数倍,wobble 正弦值近乎重合(数值巧合,非逻辑缺陷)
    expect(Math.abs(reg.angles[1] - wild.angles[1])).toBeGreaterThan(0.02)
  })
  it('speedMul 加速相位推进:speedMul=2 的稳态摆动相位领先', () => {
    const s1 = new LaserSweep(); const s2 = new LaserSweep()
    for (let i = 0; i < 120; i++) {
      s1.update(1 / 60, calm)
      s2.update(1 / 60, { ...calm, speedMul: 2 })
    }
    expect(s1.angles[0]).not.toBeCloseTo(s2.angles[0], 3)
  })
  it('spreadMul 缩放扇开角:1.5 稳态张角 > 1.0', () => {
    const s1 = new LaserSweep(); const s15 = new LaserSweep()
    for (let i = 0; i < 120; i++) {
      s1.update(1 / 60, { ...calm, energy: 1 })
      s15.update(1 / 60, { ...calm, energy: 1, spreadMul: 1.5 })
    }
    expect(spreadOf(s15)).toBeGreaterThan(spreadOf(s1))
  })
  const settle = (s: LaserSweep, ev: LaserInputs, frames = 240): void => {
    for (let i = 0; i < frames; i++) s.update(DT, { ...ev, onBeat: false, dropEdge: false })
  }
  const activeOf = (s: LaserSweep, from = 0, to = LASER_POOL): number =>
    Array.from(s.gains.slice(from, to)).filter((g) => g > 0.5).length

  it('束数随能量:低能稀疏≈下限、高能逼近上限;上限旋钮钳制(#激光动态束)', () => {
    const low = new LaserSweep()
    settle(low, mkEv({ energy: 0.1, maxCount: 14 }))
    expect(activeOf(low)).toBeLessThanOrEqual(LASER_BEAMS_MIN + 1)
    const high = new LaserSweep()
    settle(high, mkEv({ energy: 1, maxCount: 14 }))
    expect(activeOf(high)).toBe(14)
    const capped = new LaserSweep()
    settle(capped, mkEv({ energy: 1, maxCount: 4 }))
    expect(activeOf(capped)).toBe(4)
  })
  it('上主下辅:能量≤0.5 无底部束;高能底部加入且不超过顶部', () => {
    const mid = new LaserSweep()
    settle(mid, mkEv({ energy: 0.45, maxCount: 14 }))
    expect(activeOf(mid, LASER_TOP_POOL)).toBe(0)
    const high = new LaserSweep()
    settle(high, mkEv({ energy: 1, maxCount: 14 }))
    const bottom = activeOf(high, LASER_TOP_POOL)
    const top = activeOf(high, 0, LASER_TOP_POOL)
    expect(bottom).toBeGreaterThan(0)
    expect(bottom).toBeLessThanOrEqual(top)
    // 奇数 live 判别力(终审补强):live=11 时 round(over×5.5)=6 会越过 ⌊11/2⌋=5,
    // 唯 floor 上限项拦住 底6>顶5——删掉该项本断言必红
    const odd = new LaserSweep()
    settle(odd, mkEv({ energy: 1, maxCount: 11 }))
    const oddBottom = activeOf(odd, LASER_TOP_POOL)
    const oddTop = activeOf(odd, 0, LASER_TOP_POOL)
    expect(oddBottom + oddTop).toBe(11)
    expect(oddBottom).toBeLessThanOrEqual(oddTop)
  })
  it('鼓点瞬增:强拍后束数瞬时超出常驻基线,~1s 衰减回落', () => {
    const s = new LaserSweep()
    const ev = mkEv({ energy: 0.3, maxCount: 14 })
    settle(s, ev)
    const base = activeOf(s)
    s.update(DT, { ...ev, onBeat: true, strength: 0.9 })
    settle(s, ev, 12) // 0.2s:burst≈1.26 仍撑着增束,新束 gain≈0.63 已过 0.5 判线(半衰 0.3s,检查点必须赶早)
    expect(activeOf(s)).toBeGreaterThan(base)
    settle(s, ev, 240) // 再 4s:衰减归零回基线
    expect(activeOf(s)).toBe(base)
  })
  it('亮度门平滑:束数跃变后单帧 gain 变化有界(不蹦出)', () => {
    const s = new LaserSweep()
    settle(s, mkEv({ energy: 0.1, maxCount: 14 }))
    const before = Array.from(s.gains)
    s.update(DT, mkEv({ energy: 1, maxCount: 14 }))
    const maxDelta = Math.max(...s.gains.map((g, i) => Math.abs(g - before[i])))
    expect(maxDelta).toBeLessThan(0.12) // GAIN_TAU=0.2 下单帧上限 1-e^(-dt/τ)≈0.08
  })
})
