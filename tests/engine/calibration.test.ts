import { describe, it, expect } from 'vitest'
import { computeTraceMetrics } from '../../src/engine/calibration'
import { loadTrace, TRACE_FIXTURES } from './helpers/load-trace'
import type { Signals } from '../../src/engine/types'

// 合成 20 帧手工 Signals：
// - energy/strength 按 i/19 递增（i=0..19），可精确推导百分位数
// - 前 5 帧为 onBeat，t = [0, 1, 2.5, 4.5, 8.7]（间隔 1, 1.5, 2, 4.2；末间隔 >3s 应被丢弃）
// - 其余 15 帧 t 从 9.0 步进 0.1 到 10.4，其中 t=9.5 一帧标记 drop
function mkSignal(t: number, i: number, over: Partial<Signals> = {}): Signals {
  return {
    t,
    loudness: { instant: 0, smooth: 0 },
    bands: { low: 0, mid: 0, high: 0 },
    spectrum: new Float32Array(512),
    beat: { onBeat: false, strength: i / 19 },
    bpm: null,
    energy: i / 19,
    drop: false,
    silence: false,
    ...over
  }
}

function buildSyntheticRows(): Signals[] {
  const onBeatTimes = [0, 1, 2.5, 4.5, 8.7]
  const restTimes = Array.from({ length: 15 }, (_, k) => 9.0 + k * 0.1)
  const rows: Signals[] = []
  onBeatTimes.forEach((t, i) => rows.push(mkSignal(t, i, { beat: { onBeat: true, strength: i / 19 } })))
  restTimes.forEach((t, k) => {
    const i = 5 + k
    const isDropFrame = t === 9.5
    rows.push(mkSignal(t, i, isDropFrame ? { drop: true } : {}))
  })
  return rows
}

describe('computeTraceMetrics（合成数据）', () => {
  const rows = buildSyntheticRows()
  const m = computeTraceMetrics(rows)

  it('frames/durationSec', () => {
    expect(m.frames).toBe(20)
    expect(m.durationSec).toBeCloseTo(10.4, 10)
  })

  it('energy 百分位数与饱和占比', () => {
    expect(m.energyP5).toBeCloseTo(0.05, 10)
    expect(m.energyP50).toBeCloseTo(0.5, 10)
    expect(m.energyP95).toBeCloseTo(0.95, 10)
    expect(m.energySatFrac).toBeCloseTo(1 / 20, 10) // 仅 i=19（energy=1.0）> 0.95
  })

  it('strength 百分位数（仅 onBeat 帧，5 帧 strength = [0, 1/19, 2/19, 3/19, 4/19]）', () => {
    expect(m.strengthP50).toBeCloseTo(2 / 19, 10) // 中间值
    expect(m.strengthP90).toBeCloseTo(3.6 / 19, 10) // index=3.6，插值于第3/4个之间
  })

  it('节拍间隔：丢弃 >3s 间隔后取中位数与规律度；beatsPerMin 用 onBeat 帧数/时长折算', () => {
    // 原始间隔 [1, 1.5, 2, 4.2]，丢弃 4.2 → 剩 [1, 1.5, 2]，中位数 1.5
    expect(m.ibiMedianSec).toBeCloseTo(1.5, 10)
    expect(m.beatsPerMin).toBeCloseTo((5 / 10.4) * 60, 10) // 5 个 onBeat 帧 / 10.4s
    // ±20% 带 [1.2, 1.8]：仅 1.5 落入，1 与 2 落在带外 → 1/3
    expect(m.ibiRegularity).toBeCloseTo(1 / 3, 10)
  })

  it('dropTimes 相对首帧秒数', () => {
    expect(m.dropTimes).toHaveLength(1)
    expect(m.dropTimes[0]).toBeCloseTo(9.5, 10)
  })
})

describe('computeTraceMetrics（空输入）', () => {
  it('0 帧不抛错，各字段回落到 0/空', () => {
    const m = computeTraceMetrics([])
    expect(m.frames).toBe(0)
    expect(m.durationSec).toBe(0)
    expect(m.dropTimes).toEqual([])
    expect(m.beatsPerMin).toBe(0)
    expect(m.ibiRegularity).toBe(0)
  })
})

describe('三首真歌基线（不设门槛，仅打印，供人工比对诊断量级）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name} 基线指标`, () => {
      const rows = loadTrace(fixture.path)
      expect(rows.length).toBeGreaterThan(0)
      const metrics = computeTraceMetrics(rows)
      console.log(`\n[基线] ${fixture.name}`, JSON.stringify(metrics, null, 2))
    })
  }
})
