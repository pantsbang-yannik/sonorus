import { describe, it, expect } from 'vitest'
import { AudioVisualMapper } from './mapper'
import { defaultRhythmPreset } from './spec'
import type { Signals } from '../../../engine/types'

const DT = 1 / 60
function sig(over: Partial<Signals> = {}): Signals {
  return {
    t: 0,
    loudness: { instant: 0.5, smooth: 0.5 },
    bands: { low: 0, mid: 0, high: 0 },
    spectrum: new Float32Array(0),
    beat: { onBeat: false, strength: 0 },
    bpm: 120, energy: 0, drop: false, silence: false,
    ...over,
  }
}
/** 喂 n 帧，返回最后一帧的 controls。 */
function run(m: AudioVisualMapper, frames: Signals[]): ReturnType<AudioVisualMapper['update']> {
  const v = defaultRhythmPreset()
  let out = m.update(null, v, DT)
  for (const s of frames) out = m.update(s, v, DT)
  return out
}

describe('AudioVisualMapper', () => {
  it('beat 触发 space 脉冲（弹起）', () => {
    const m = new AudioVisualMapper()
    const before = run(m, [sig()])
    const after = run(m, [sig({ beat: { onBeat: true, strength: 1 } }), sig(), sig()])
    expect(after.space).toBeGreaterThan(before.space)
  })
  it('low 提高 thickness', () => {
    const m = new AudioVisualMapper()
    const low = run(m, Array(30).fill(sig({ bands: { low: 0.9, mid: 0, high: 0 } })))
    expect(low.thickness).toBeGreaterThan(0.3)
  })
  it('high 提高 brightness', () => {
    const m = new AudioVisualMapper()
    const hi = run(m, Array(30).fill(sig({ bands: { low: 0, mid: 0, high: 0.9 } })))
    expect(hi.brightness).toBeGreaterThan(0.3)
  })
  it('energy 提高 density 与 space', () => {
    const m = new AudioVisualMapper()
    const hi = run(m, Array(60).fill(sig({ energy: 1 })))
    const lo = run(new AudioVisualMapper(), Array(60).fill(sig({ energy: 0 })))
    expect(hi.density).toBeGreaterThan(lo.density)
    expect(hi.space).toBeGreaterThan(lo.space)
  })
  it('smoothingMs 越大响应越慢：同一冲量首帧涨幅更小', () => {
    const fast = new AudioVisualMapper()
    const vFast = defaultRhythmPreset(); vFast.targets.thickness.primary.smoothingMs = 10
    const vSlow = defaultRhythmPreset(); vSlow.targets.thickness.primary.smoothingMs = 1000
    fast.update(null, vFast, DT)
    const a = fast.update(sig({ bands: { low: 1, mid: 0, high: 0 } }), vFast, DT)
    const slow = new AudioVisualMapper(); slow.update(null, vSlow, DT)
    const b = slow.update(sig({ bands: { low: 1, mid: 0, high: 0 } }), vSlow, DT)
    expect(a.thickness).toBeGreaterThan(b.thickness)
  })
  it('downbeat 源只在每第 4 拍触发（独立于 SignalRig 计数）', () => {
    const m = new AudioVisualMapper()
    const v = defaultRhythmPreset()
    // 把 space 主源改成 downbeat，去掉 secondary 干扰，直接观察脉冲何时跳起
    v.targets.space.primary = {
      enabled: true, source: 'downbeat', gain: 1, curve: 'linear',
      smoothingMs: 0, inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1,
    }
    delete v.targets.space.secondary
    m.update(null, v, DT)
    const beat = () => m.update(sig({ beat: { onBeat: true, strength: 1 } }), v, DT).space
    const s1 = beat() // beatCount=1，非 downbeat
    beat()            // 2
    const s3 = beat() // 3，仍非 downbeat
    const s4 = beat() // 4 → 4%4==0，downbeat 触发，脉冲跳起
    expect(s4).toBeGreaterThan(s1)
    expect(s4).toBeGreaterThan(s3)
  })
  it('非 brightness 目标的 combined 进平滑器前夹到 [0,1]（primary+secondary 叠加不爆出）', () => {
    const v = defaultRhythmPreset() // space.primary=beat, space.secondary=energy
    const m1 = new AudioVisualMapper(); m1.update(null, v, DT)
    const withEnergy = m1.update(sig({ beat: { onBeat: true, strength: 1 }, energy: 1 }), v, DT).space
    const m2 = new AudioVisualMapper(); m2.update(null, v, DT)
    const noEnergy = m2.update(sig({ beat: { onBeat: true, strength: 1 }, energy: 0 }), v, DT).space
    // 夹紧后 combined 都封顶到 1，两者首帧 space 近似相等；若不夹，withEnergy 会约 2×
    expect(withEnergy).toBeCloseTo(noEnergy, 2)
  })
})
