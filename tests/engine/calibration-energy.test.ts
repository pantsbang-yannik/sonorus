import { describe, it, expect } from 'vitest'
import { EnergyTracker } from '../../src/engine/energy'
import { computeTraceMetrics } from '../../src/engine/calibration'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'
import type { Signals } from '../../src/engine/types'

const SR = 48000
const HOP = 1024

describe('EnergyTracker v2 校准门槛（三首真歌回放，硬线不许因过不了而放宽）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name}：energy 分布与冷启动过线`, () => {
      const rows = loadTrace(fixture.path)
      expect(rows.length).toBeGreaterThan(0)

      const tracker = new EnergyTracker(SR, HOP)
      const t0 = rows[0].t
      // rms 只驱动 silence（本门槛不断言 silence），拿 specLoud 占位即可
      const newRows: Signals[] = rows.map((r) => {
        const specLoud = specLoudOf(r.bands)
        const { energy } = tracker.push(specLoud, specLoud, r.t)
        return { ...r, energy }
      })

      const metrics = computeTraceMetrics(newRows)
      console.log(`\n[能量校准] ${fixture.name}`, JSON.stringify({
        energyP5: metrics.energyP5, energyP50: metrics.energyP50, energyP95: metrics.energyP95,
        energySatFrac: metrics.energySatFrac
      }, null, 2))

      expect(metrics.energyP50).toBeGreaterThanOrEqual(0.30)
      expect(metrics.energyP50).toBeLessThanOrEqual(0.70)
      expect(metrics.energySatFrac).toBeLessThanOrEqual(0.15)
      expect(metrics.energyP95 - metrics.energyP5).toBeGreaterThanOrEqual(0.35)

      // 门槛修订（控制端裁定，记录在计划 doc）：冷启动只压数值稳定期（前 1.5s），
      // 开场后的真实能量爆发（如 tiaowu ~2.5s）合法穿越——快速上冲是诚实响应
      const first1p5s = newRows.filter((r) => r.t - t0 <= 1.5)
      expect(first1p5s.length).toBeGreaterThan(0)
      for (const r of first1p5s) expect(r.energy).toBeLessThanOrEqual(0.5)
    })
  }
})
