// tests/engine/calibration-kick.test.ts
import { describe, it, expect } from 'vitest'
import { KICK_FLOOR, KICK_GAMMA } from '../../src/scenes/nebula/signal-rig'
import { BeatDetector } from '../../src/engine/beat'
import { EnergyTracker } from '../../src/engine/energy'
import { hybridBeatStrength } from '../../src/engine/engine'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'

const SR = 48000
const HOP = 1024

/** trace 回放一律重算（fb5 测点迁移，同 calibration-beat.test.ts 手法）：
 * BeatDetector+EnergyTracker 重放出 hybrid 合成力度，再进打击锐化公式——
 * 不直接消费 trace 里录制的旧 beat.strength（那是 pre-fb5 纯排名语义，已过期）。 */
function pooledHybridOnBeat(): number[] {
  const out: number[] = []
  for (const fixture of TRACE_FIXTURES) {
    const det = new BeatDetector(SR, HOP)
    const tracker = new EnergyTracker(SR, HOP)
    for (const r of loadTrace(fixture.path)) {
      const b = det.push(r.spectrum, r.t)
      const specLoud = specLoudOf(r.bands)
      const { energy } = tracker.push(specLoud, specLoud, r.t)
      if (b.onBeat) out.push(hybridBeatStrength(b.strength, energy))
    }
  }
  return out.sort((a, b) => a - b)
}

/** 三首真歌全部 onBeat 帧经打击锐化后的最终冲量分布（与 SignalRig.update 同公式） */
function pooledKickStrengths(hybrids: number[]): number[] {
  return hybrids.map((h) => Math.max(KICK_FLOOR, Math.pow(h, KICK_GAMMA))).sort((a, b) => a - b)
}
const q = (arr: number[], p: number): number => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]

describe('打击标定复位校准（T10d：单触发时代的力度分布门槛，硬线不许放宽）', () => {
  it('三首真歌合并：p50 沉、p90 狠、强弱对比不塌（力度=hybrid 合成，fb5 测点迁移）', () => {
    const hybrids = pooledHybridOnBeat()
    const kicks = pooledKickStrengths(hybrids)
    expect(kicks.length).toBeGreaterThan(300) // 三首歌合计拍数下限（139-163/min 标定区间的松弛底线）
    const p50 = q(kicks, 0.5), p90 = q(kicks, 0.9)
    console.log(`\n[打击校准] n=${kicks.length} p50=${p50.toFixed(3)} p90=${p90.toFixed(3)} 对比=${(p90 / p50).toFixed(2)}×`)
    expect(p50).toBeGreaterThanOrEqual(0.3)
    expect(p50).toBeLessThanOrEqual(0.55)
    expect(p90).toBeGreaterThanOrEqual(0.7)
    // 强弱对比守卫（2026-07-11 用户拍板修订；2026-07-14 fb5 测点迁移随力度语义换算基准)：
    // 幂次锐化必须放大对比、不许倒退（gamma 被调没/floor 抬平时立刻翻红）——
    // 现在对比基准是回放出的 hybrid 合成分布（而非 trace 里过期的排名分位）
    const rawContrast = q(hybrids, 0.9) / q(hybrids, 0.5)
    expect(p90 / p50).toBeGreaterThanOrEqual(rawContrast * 1.05)
  })
})
