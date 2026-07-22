import { RollingPeak } from './rolling-peak'

/** 滚动谷值：向当前值缓慢上浮（半衰期），遇更低值立即下探——与 RollingPeak 对偶 */
export class RollingValley {
  private _valley = Infinity
  constructor(private halfLifeSec = 45) {}
  seed(v: number): void {
    this._valley = Math.min(this._valley, v)
  }
  update(v: number, dt: number): number {
    if (v < this._valley) this._valley = v
    else this._valley += (v - this._valley) * (1 - Math.pow(0.5, dt / this.halfLifeSec))
    return this._valley
  }
}

const SLOW_TAU_SEC = 2.0 // specLoud 的 EMA 时间常数
const PEAK_VALLEY_HALFLIFE_SEC = 45 // 滚动峰/谷半衰期——段落尺度，不追单拍瞬态
const RANGE_FLOOR_FRAC = 0.5 // range 下限：峰谷贴近时（持续平响）也留出可感知的区间
// 冷启动渐升时长：0 线性升到 1，只覆盖峰谷窗口建立前的数值稳定期（门槛：前 1.5s ≤ 0.5）；
// 开场后的真实能量爆发（如 tiaowu ~2.5s）应合法穿越——快速上冲是诚实响应，不用渐升遮罩压制
const RAMP_FULL_SEC = 3
const SILENCE_TAU_SEC = 0.3 // 静音判据的 rms 平滑时间常数（旧版 fast 路径语义，防迟滞带内毛刺误触）

// drop（爆发）判据：fast/slow 比值判据已废除（诊断实锤：三首歌全部只在开头误触，真副歌零命中）。
// 改用「energy 爬升率」——环形缓冲记 1.5s 前的 energy，与当前值做差
const DROP_HISTORY_SEC = 1.5 // 爬升窗口：环形缓冲记 1.5s energy 历史
const DROP_RISE_THRESHOLD = 0.22 // 过去 1.5s 内爬升 ≥ 此值才算「冲上去」
const DROP_ENERGY_FLOOR = 0.65 // 当前 energy 必须本身就在高位，纯爬升不够（防止低位小抖动累计误触）
// 冷启动免疫窗口比 RAMP_FULL_SEC（3s 数值稳定期）更长：渐升乘子本身在 0→1 爬坡时会制造
// 「energy 从低到高」的假爬升（乘子在变，不是音乐真的冲了），5s 给足安全边际让乘子早已到 1
// 之后再开始判定爬升率，真实的段落起爆才不会被渐升尾巴污染或误伤
const DROP_COLDSTART_SEC = 5
const DROP_COOLDOWN_SEC = 12 // 距上次 drop 的最短间隔（沿用旧实现）

export class EnergyTracker {
  private readonly hopSec: number
  private slow = 0
  private peak = new RollingPeak(PEAK_VALLEY_HALFLIFE_SEC, 1e-6)
  private valley = new RollingValley(PEAK_VALLEY_HALFLIFE_SEC)
  private silenceRms = 0
  private silenceSince: number | null = null
  private silent = false
  private seeded = false
  private startT: number | null = null
  private readonly dropHistory: Float64Array // 环形缓冲：固定容量存 1.5s 内的 energy 历史
  private dropHistoryIdx = 0
  private lastDropT = -Infinity

  constructor(sampleRate: number, hopSize: number) {
    this.hopSec = hopSize / sampleRate
    this.dropHistory = new Float64Array(Math.max(1, Math.round(DROP_HISTORY_SEC / this.hopSec)))
  }

  private ema(prev: number, x: number, tau: number): number {
    const a = 1 - Math.exp(-this.hopSec / tau)
    return prev + a * (x - prev)
  }

  push(specLoud: number, rms: number, tSec: number): { energy: number; drop: boolean; silence: boolean } {
    if (this.startT === null) this.startT = tSec
    const elapsed = tSec - this.startT

    if (!this.seeded) {
      this.seeded = true
      this.slow = specLoud
      this.silenceRms = rms
      this.peak.seed(specLoud)
      this.valley.seed(specLoud)
    } else {
      this.slow = this.ema(this.slow, specLoud, SLOW_TAU_SEC)
      this.silenceRms = this.ema(this.silenceRms, rms, SILENCE_TAU_SEC)
    }

    // 滚动峰值/谷值：只用 .peak getter 取原始滚动峰值，update() 的归一化返回值本任务不用
    this.peak.update(this.slow, this.hopSec)
    const peakV = this.peak.peak
    const valleyV = this.valley.update(this.slow, this.hopSec)

    const range = Math.max(peakV - valleyV, RANGE_FLOOR_FRAC * peakV, 1e-6)
    let energy = Math.min(1, Math.max(0, (this.slow - valleyV) / range))

    // 冷启动：0 线性渐升到 1，避免峰谷窗口尚未建立时瞎跳
    energy *= Math.min(1, elapsed / RAMP_FULL_SEC)

    // 爬升率判据：与环形缓冲里 1.5s 前的 energy（缓冲区当前写入位置的旧值，未写满时默认 0）比较
    const risePast = energy - this.dropHistory[this.dropHistoryIdx]
    this.dropHistory[this.dropHistoryIdx] = energy
    this.dropHistoryIdx = (this.dropHistoryIdx + 1) % this.dropHistory.length

    const drop = risePast >= DROP_RISE_THRESHOLD &&
      energy >= DROP_ENERGY_FLOOR &&
      elapsed > DROP_COLDSTART_SEC &&
      tSec - this.lastDropT > DROP_COOLDOWN_SEC
    if (drop) this.lastDropT = tSec

    // 静音判定吃 0.3s 平滑 rms 而非裸 rms：迟滞带（0.001~0.003）内的毛刺抖动不会累计误触
    if (this.silenceRms < 0.001) {
      if (this.silenceSince === null) this.silenceSince = tSec
      if (tSec - this.silenceSince > 2) this.silent = true
    } else if (this.silenceRms > 0.003) {
      this.silenceSince = null
      this.silent = false
    }

    return { energy, drop, silence: this.silent }
  }
}
