import { describe, it, expect } from 'vitest'
import { BeatDetector } from '../../src/engine/beat'
import { EnergyTracker } from '../../src/engine/energy'
import { hybridBeatStrength } from '../../src/engine/engine'
import { computeTraceMetrics } from '../../src/engine/calibration'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'
import type { Signals } from '../../src/engine/types'

const SR = 48000
const HOP = 1024

describe('BeatDetector v2 校准门槛（三首真歌回放，硬线不许因过不了而放宽）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name}：节拍密度/规整度/力度对比度过线（力度=hybrid 合成，fb5 测点迁移）`, () => {
      const rows = loadTrace(fixture.path)
      expect(rows.length).toBeGreaterThan(0)

      // trace 频谱是发布前 0.25 EMA 平滑过的（已记录的不对称性：真机吃原始谱只会更锐）
      const det = new BeatDetector(SR, HOP)
      const tracker = new EnergyTracker(SR, HOP)
      const newRows: Signals[] = rows.map((r) => {
        const b = det.push(r.spectrum, r.t)
        const specLoud = specLoudOf(r.bands)
        const { energy } = tracker.push(specLoud, specLoud, r.t)
        const beat = b.onBeat ? { onBeat: true, strength: hybridBeatStrength(b.strength, energy) } : b
        return { ...r, beat }
      })

      const metrics = computeTraceMetrics(newRows)
      console.log(`\n[节拍校准] ${fixture.name}`, JSON.stringify({
        beatsPerMin: metrics.beatsPerMin, ibiMedianSec: metrics.ibiMedianSec,
        ibiRegularity: metrics.ibiRegularity,
        strengthP50: metrics.strengthP50, strengthP90: metrics.strengthP90,
        bpm: det.bpm
      }, null, 2))

      expect(metrics.beatsPerMin).toBeGreaterThanOrEqual(80)
      expect(metrics.beatsPerMin).toBeLessThanOrEqual(280)
      expect(metrics.ibiRegularity).toBeGreaterThanOrEqual(0.5)
      expect(metrics.strengthP90 - metrics.strengthP50).toBeGreaterThanOrEqual(0.25)
      expect(metrics.strengthP90).toBeGreaterThanOrEqual(0.75)
    })
  }
})
