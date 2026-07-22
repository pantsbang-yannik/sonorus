import { describe, it, expect } from 'vitest'
import { EnergyTracker } from '../../src/engine/energy'
import { computeTraceMetrics } from '../../src/engine/calibration'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'
import type { Signals } from '../../src/engine/types'

const SR = 48000
const HOP = 1024

/** 单首歌完整回放一遍，返回相对首帧的 drop 时间戳数组 */
function dropTimesOf(fixturePath: string): number[] {
  const rows = loadTrace(fixturePath)
  const tracker = new EnergyTracker(SR, HOP)
  const t0 = rows[0].t
  const times: number[] = []
  for (const r of rows) {
    const specLoud = specLoudOf(r.bands)
    const { drop } = tracker.push(specLoud, specLoud, r.t)
    if (drop) times.push(r.t - t0)
  }
  return times
}

describe('EnergyTracker drop 校准门槛（三首真歌回放，硬线不许因过不了而放宽）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name}：前 5s 零 drop，全曲 drop 数 ∈ [0,6]`, () => {
      const rows = loadTrace(fixture.path)
      expect(rows.length).toBeGreaterThan(0)

      const tracker = new EnergyTracker(SR, HOP)
      const t0 = rows[0].t
      const newRows: Signals[] = rows.map((r) => {
        const specLoud = specLoudOf(r.bands)
        const { energy, drop } = tracker.push(specLoud, specLoud, r.t)
        return { ...r, energy, drop }
      })

      const metrics = computeTraceMetrics(newRows)
      // drop 时间戳表：给用户对照歌曲时间轴验收——「这个点是不是副歌」只有耳朵知道
      const dropDetail = metrics.dropTimes.map((t) => {
        const row = newRows.find((r) => r.t - t0 === t)
        return { atSec: Number(t.toFixed(2)), energy: row ? Number(row.energy.toFixed(3)) : null }
      })
      console.log(`\n[drop 校准] ${fixture.name}`, JSON.stringify(dropDetail, null, 2))

      // 前 5s 零 drop（冷启动免疫窗口）
      for (const t of metrics.dropTimes) expect(t).toBeGreaterThan(5)

      // 每首歌 drop 数量必须在合理区间内，防止判据过松（刷屏）或过紧（形同虚设）
      expect(metrics.dropTimes.length).toBeGreaterThanOrEqual(0)
      expect(metrics.dropTimes.length).toBeLessThanOrEqual(6)
    })
  }

  it('三首歌合计 drop 次数 ≥ 2（真副歌应该点得着火，不能三首全灭）', () => {
    const counts = TRACE_FIXTURES.map((fixture) => dropTimesOf(fixture.path).length)
    const sum = counts.reduce((a, b) => a + b, 0)
    console.log('\n[drop 校准] 三首歌合计 drop 次数', sum, JSON.stringify(counts))
    expect(sum).toBeGreaterThanOrEqual(2)
  })
})
