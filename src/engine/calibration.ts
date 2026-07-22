import type { Signals } from './types'

/** trace 校准指标：供 T2-T4 算法重构前后对比基线 */
export interface TraceMetrics {
  frames: number
  durationSec: number
  energyP5: number
  energyP50: number
  energyP95: number
  energySatFrac: number // energy > 0.95 帧占比
  beatsPerMin: number
  ibiMedianSec: number // 相邻 onBeat 间隔中位数（已丢弃 >3s 的间隔）
  ibiRegularity: number // 间隔落在中位数 ±20% 内的比例
  strengthP50: number
  strengthP90: number
  dropTimes: number[] // 相对首帧秒数
}

const EMPTY_METRICS: TraceMetrics = {
  frames: 0, durationSec: 0,
  energyP5: 0, energyP50: 0, energyP95: 0, energySatFrac: 0,
  beatsPerMin: 0, ibiMedianSec: 0, ibiRegularity: 0,
  strengthP50: 0, strengthP90: 0, dropTimes: []
}

/** 已排序数组上的线性插值百分位数（p 属于 [0,1]） */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] + frac * (sorted[hi] - sorted[lo])
}

export function computeTraceMetrics(rows: Signals[]): TraceMetrics {
  if (rows.length === 0) return { ...EMPTY_METRICS, dropTimes: [] }

  const frames = rows.length
  const t0 = rows[0].t
  const durationSec = rows[frames - 1].t - t0

  const energies = rows.map((r) => r.energy).sort((a, b) => a - b)
  const energyP5 = percentile(energies, 0.05)
  const energyP50 = percentile(energies, 0.5)
  const energyP95 = percentile(energies, 0.95)
  const energySatFrac = rows.filter((r) => r.energy > 0.95).length / frames

  // strength 只在 onBeat 帧上有意义：绝大多数非节拍帧 strength 恒为 0，
  // 若纳入全体帧百分位数会被 0 淹没（真实 trace 验证过：P50/P90 退化为 0）
  const beatRows = rows.filter((r) => r.beat.onBeat)
  const onBeatStrengths = beatRows.map((r) => r.beat.strength).sort((a, b) => a - b)
  const strengthP50 = percentile(onBeatStrengths, 0.5)
  const strengthP90 = percentile(onBeatStrengths, 0.9)

  const beatTimes = beatRows.map((r) => r.t)
  const rawIbi: number[] = []
  for (let i = 1; i < beatTimes.length; i++) rawIbi.push(beatTimes[i] - beatTimes[i - 1])
  const filteredIbi = rawIbi.filter((d) => d <= 3).sort((a, b) => a - b)
  const ibiMedianSec = filteredIbi.length ? percentile(filteredIbi, 0.5) : 0
  // 用 onBeat 帧数 / 时长折算的平均节拍速率，而非中位间隔倒数：
  // 后者对少量真实节拍点的位置极为敏感，实测与诊断量级严重不符
  const beatsPerMin = durationSec > 0 ? (beatTimes.length / durationSec) * 60 : 0
  const ibiRegularity = filteredIbi.length
    ? filteredIbi.filter((d) => d >= ibiMedianSec * 0.8 && d <= ibiMedianSec * 1.2).length / filteredIbi.length
    : 0

  const dropTimes = rows.filter((r) => r.drop).map((r) => r.t - t0)

  return {
    frames, durationSec,
    energyP5, energyP50, energyP95, energySatFrac,
    beatsPerMin, ibiMedianSec, ibiRegularity,
    strengthP50, strengthP90, dropTimes
  }
}
