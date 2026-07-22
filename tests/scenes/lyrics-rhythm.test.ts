import { describe, it, expect } from 'vitest'
import { LyricsRhythm, type LyricsRhythmInputs } from '../../src/scenes/nebula/lyrics/lyrics-rhythm'

const QUIET: LyricsRhythmInputs = {
  energy: 0.5, mid: 0, onBeat: false, beatStrength: 0, bpm: null, burstEdge: false, dropEdge: false
}

/** 以 0.05s 粒度推进 sec 秒，返回最后一帧（步长与 lyrics-fx 测试同风格） */
function run(r: LyricsRhythm, sec: number, inp: LyricsRhythmInputs, dynamics = true) {
  let f = r.update(0, inp, dynamics)
  for (let i = 0; i < Math.round(sec / 0.05); i++) f = r.update(0.05, inp, dynamics)
  return f
}

describe('LyricsRhythm', () => {
  it('中性起点：energy=0.5 静场 → scaleMul≈1、spreadAdd=0、brightAdd=0', () => {
    const f = run(new LyricsRhythm(), 1, QUIET)
    expect(f.scaleMul).toBeCloseTo(1, 3)
    expect(f.spreadAdd).toBeCloseTo(0, 3)
    expect(f.brightAdd).toBeCloseTo(0, 3)
  })

  it('呼吸层：energy=1 持续 → scaleMul 逼近 1.04 不越界；energy=0 → 逼近 0.96', () => {
    const r = new LyricsRhythm()
    const hi = run(r, 3, { ...QUIET, energy: 1 })
    expect(hi.scaleMul).toBeGreaterThan(1.03)
    expect(hi.scaleMul).toBeLessThanOrEqual(1.04 + 1e-6)
    const lo = run(r, 3, { ...QUIET, energy: 0 })
    expect(lo.scaleMul).toBeLessThan(0.97)
    expect(lo.scaleMul).toBeGreaterThanOrEqual(0.96 - 1e-6)
  })

  it('呼吸是平滑的：energy 0.5→1 突变的单帧 scaleMul 变化远小于满幅', () => {
    const r = new LyricsRhythm()
    run(r, 1, QUIET)
    const f = r.update(0.016, { ...QUIET, energy: 1 }, true)
    expect(f.scaleMul - 1).toBeLessThan(0.01)
  })

  it('沸腾基线：mid=1 → spreadAdd 含 0.05；mid=0.5 → 0.025', () => {
    expect(run(new LyricsRhythm(), 0.5, { ...QUIET, mid: 1 }).spreadAdd).toBeCloseTo(0.05, 3)
    expect(run(new LyricsRhythm(), 0.5, { ...QUIET, mid: 0.5 }).spreadAdd).toBeCloseTo(0.025, 3)
  })

  it('鼓点脉冲：onBeat strength=1 → brightAdd 冲到 >0.4（trigger 后本帧已开始半衰），0.3s 后衰减到 <0.15', () => {
    const r = new LyricsRhythm()
    const hit = r.update(0.016, { ...QUIET, onBeat: true, beatStrength: 1 }, true)
    expect(hit.brightAdd).toBeGreaterThan(0.4)
    expect(hit.brightAdd).toBeLessThanOrEqual(0.5)
    const later = run(r, 0.3, QUIET)
    expect(later.brightAdd).toBeLessThan(0.15)
  })

  it('burst 冲击：burstEdge → spreadAdd 冲 0.25 且 0.5s 内回收到 <0.05；brightAdd 同帧高光', () => {
    const r = new LyricsRhythm()
    const hit = r.update(0.016, { ...QUIET, burstEdge: true }, true)
    expect(hit.spreadAdd).toBeGreaterThan(0.2)
    expect(hit.brightAdd).toBeGreaterThan(0.2)
    const later = run(r, 0.5, QUIET)
    expect(later.spreadAdd).toBeLessThan(0.05)
  })

  it('nextBeatIn：无 bpm/从未见拍 → null；bpm=120 见拍后推进 0.3s → ≈0.2（模周期回绕）', () => {
    const r = new LyricsRhythm()
    expect(r.nextBeatIn()).toBeNull()
    r.update(0.016, { ...QUIET, onBeat: true, beatStrength: 0.5, bpm: 120 }, true) // onBeat 帧 sinceBeat 归零
    run(r, 0.3, { ...QUIET, bpm: 120 }) // 此后累计 0.3s
    expect(r.nextBeatIn()).toBeCloseTo(0.2, 2) // period 0.5 − (0.3 % 0.5)
    run(r, 0.3, { ...QUIET, bpm: 120 }) // 累计 0.6s：模周期回绕 → 0.5 − 0.1 = 0.4
    expect(r.nextBeatIn()!).toBeCloseTo(0.4, 2)
  })

  it('总闸：dynamics=false 恒中性（即使 onBeat/burstEdge），且复位——重开不带旧残留', () => {
    const r = new LyricsRhythm()
    r.update(0.016, { ...QUIET, onBeat: true, beatStrength: 1, burstEdge: true, bpm: 120 }, true)
    const off = r.update(0.016, { ...QUIET, onBeat: true, beatStrength: 1, burstEdge: true }, false)
    expect(off).toEqual({ scaleMul: 1, spreadAdd: 0, brightAdd: 0 })
    expect(r.nextBeatIn()).toBeNull()
    const back = r.update(0.016, QUIET, true)
    expect(back.brightAdd).toBeCloseTo(0, 3)
    expect(back.spreadAdd).toBeCloseTo(0, 3)
  })

  describe('applyGain（亲验 fb1-D：动态强度滑杆消费端缩放）', () => {
    const FRAME = { scaleMul: 1.04, spreadAdd: 0.2, brightAdd: 0.4 }

    it('gain=0 → 退化为 NEUTRAL，与 dynamics=false 的输出完全等价', () => {
      expect(LyricsRhythm.applyGain(FRAME, 0)).toEqual({ scaleMul: 1, spreadAdd: 0, brightAdd: 0 })
    })

    it('gain=1 → 原样透传（默认档=现状不变）', () => {
      expect(LyricsRhythm.applyGain(FRAME, 1)).toEqual(FRAME)
    })

    it('gain=2 → 偏离量/加量各自加倍（scaleMul 是偏离 1 的量，不是整体相乘）', () => {
      const g = LyricsRhythm.applyGain(FRAME, 2)
      expect(g.scaleMul).toBeCloseTo(1.08, 6) // 1 + (1.04-1)*2
      expect(g.spreadAdd).toBeCloseTo(0.4, 6)
      expect(g.brightAdd).toBeCloseTo(0.8, 6)
    })

    it('中性帧任意 gain 恒中性（scaleMul-1=0 时缩放不产生偏差）', () => {
      expect(LyricsRhythm.applyGain({ scaleMul: 1, spreadAdd: 0, brightAdd: 0 }, 1.7))
        .toEqual({ scaleMul: 1, spreadAdd: 0, brightAdd: 0 })
    })
  })

  describe('LyricsRhythm 碎散聚（fb4：drop 炸开-重聚 + 强拍冲散防常散）', () => {
    it('dropEdge → spreadAdd 冲高接近 DROP_SCATTER(0.85)，~0.5s 内回落到基本可读', () => {
      const r = new LyricsRhythm()
      const hit = r.update(0.016, { ...QUIET, bpm: 120, dropEdge: true }, true)
      expect(hit.spreadAdd).toBeGreaterThan(0.7)
      const later = run(r, 0.5, { ...QUIET, bpm: 120 })
      expect(later.spreadAdd).toBeLessThan(0.1)
    })

    it('强拍门槛 0.75：strength=0.74 只亮度不冲散；0.76 触发中冲散(0.35)', () => {
      const weak = new LyricsRhythm().update(0.016, { ...QUIET, onBeat: true, beatStrength: 0.74 }, true)
      expect(weak.spreadAdd).toBeLessThan(0.01)
      expect(weak.brightAdd).toBeGreaterThan(0.3) // 弱拍维持亮度脉冲（护栏不变）
      const strong = new LyricsRhythm().update(0.016, { ...QUIET, onBeat: true, beatStrength: 0.76 }, true)
      expect(strong.spreadAdd).toBeGreaterThan(0.3)
    })

    it('不应期：bpm=120 强拍触发后 0.3s 内二次强拍不再顶高（继续衰减）；drop 无视不应期', () => {
      const r = new LyricsRhythm()
      r.update(0.016, { ...QUIET, bpm: 120, onBeat: true, beatStrength: 1 }, true)
      const decayed = run(r, 0.3, { ...QUIET, bpm: 120 })
      const second = r.update(0.016, { ...QUIET, bpm: 120, onBeat: true, beatStrength: 1 }, true)
      expect(second.spreadAdd).toBeLessThanOrEqual(decayed.spreadAdd + 1e-6)
      const dropHit = r.update(0.016, { ...QUIET, bpm: 120, dropEdge: true }, true)
      expect(dropHit.spreadAdd).toBeGreaterThan(0.7)
    })

    it('重聚半衰期挂 BPM 钳 [0.09,0.18]：同 0.3s 后慢歌(60bpm)残留 > 快歌(180bpm)', () => {
      const slow = new LyricsRhythm()
      slow.update(0.016, { ...QUIET, bpm: 60, dropEdge: true }, true)
      const fast = new LyricsRhythm()
      fast.update(0.016, { ...QUIET, bpm: 180, dropEdge: true }, true)
      const s = run(slow, 0.3, { ...QUIET, bpm: 60 })
      const f = run(fast, 0.3, { ...QUIET, bpm: 180 })
      expect(s.spreadAdd).toBeGreaterThan(f.spreadAdd * 2)
    })

    it('applyGain 覆盖冲散（gain=0 归零）；dynamics=false 复位 scatter 与不应期', () => {
      const r = new LyricsRhythm()
      const hit = r.update(0.016, { ...QUIET, dropEdge: true }, true)
      expect(LyricsRhythm.applyGain(hit, 0).spreadAdd).toBe(0)
      r.update(0.016, QUIET, false)
      const after = r.update(0.016, QUIET, true)
      expect(after.spreadAdd).toBeCloseTo(0, 5)
    })
  })
})
