/** 节拍检测 v2：双通道谱通量 + 中位数/MAD 自适应阈值 + 分位力度
 *
 * kick 通道（30-280Hz）抓正拍底鼓，snare 通道（1k-5kHz）抓军鼓/踩镲；
 * 任一通道过线即 onBeat；bpm 只吃 kick onset（军鼓反拍会污染 IOI）
 */

export interface BeatOpts {
  threshWinSec: number // 自适应阈值滑窗长度
  madK: number // kick 阈值 = 中位数 + madK × MAD
  snareMadK: number // snare 通道独立阈值系数（高频有人声/镲污染，只放行强反拍）
  refractorySec: number // 每通道独立不应期
  mergeGuardSec: number // 合并守卫：两通道对同一鼓点前后脚触发只算一次
  strengthWinSec: number // 力度分位窗（同通道最近 onset flux 分布）
}

/** fb5 tie 排名：flux 相差 ±15% 视为听感等响并列，取中位名次——均匀段落所有拍同命(≈0.5)，
 * 起伏段落并列极少行为同旧排名。治「毫厘定名次→同拍不同命」（诊断审计 2026-07-14） */
export const TIE_EPS = 0.15

// 三首真歌校准过线的参数（tests/engine/calibration-beat.test.ts 是硬线）
const DEFAULT_OPTS: BeatOpts = {
  threshWinSec: 2.5,
  madK: 2.0,
  snareMadK: 8.0,
  refractorySec: 0.28,
  mergeGuardSec: 0.15,
  strengthWinSec: 6
}

/** 单通道谱通量 onset 检测：正向差分和 → 滑窗中位数+MAD 过线 → 不应期 → 分位力度 */
class FluxChannel {
  private prev: Float32Array | null = null
  private hist: number[] = []
  private wasAbove = false // 上升沿触发：持续高于阈值只算一次 onset
  private lastOnsetT = -Infinity
  private onsetFluxes: { t: number; flux: number }[] = []
  onsetTimes: number[] = []

  constructor(
    private readonly loBin: number,
    private readonly hiBin: number,
    private readonly winLen: number,
    private readonly madK: number,
    private readonly opts: BeatOpts
  ) {}

  push(spectrum: Float32Array, tSec: number): { onset: boolean; strength: number } {
    const cur = spectrum.slice(this.loBin, this.hiBin)
    let flux = 0
    if (this.prev) {
      for (let i = 0; i < cur.length; i++) {
        const d = cur[i] - this.prev[i]
        if (d > 0) flux += d
      }
    }
    this.prev = cur

    this.hist.push(flux)
    if (this.hist.length > this.winLen) this.hist.shift()
    if (this.hist.length < this.winLen) return { onset: false, strength: 0 } // 阈值热身期

    // 中位数 + MAD：对爆点离群鲁棒（μ+3σ 会被自己的峰抬高而漏拍）
    const sorted = [...this.hist].sort((a, b) => a - b)
    const med = sorted[this.winLen >> 1]
    const devs = this.hist.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[this.winLen >> 1]
    const threshold = med + this.madK * mad

    const above = flux > threshold && flux > 0
    const rising = above && !this.wasAbove // 平滑谱下 flux 会高位驻留多帧，只认从阈下上穿的那一帧
    this.wasAbove = above
    const refractoryOk = tSec - this.lastOnsetT > this.opts.refractorySec
    if (!rising || !refractoryOk) return { onset: false, strength: 0 }

    this.lastOnsetT = tSec
    this.onsetTimes.push(tSec)
    this.onsetTimes = this.onsetTimes.filter((t) => tSec - t < 8)

    // 力度 = 本次 flux 在最近 strengthWinSec 内同通道 onset flux 分布中的 tie-aware 中位排名
    // （p50 命中 ≈0.5、爆点 ≈0.95——恢复「狠」的对比度；±TIE_EPS 内并列取中位名次）
    this.onsetFluxes.push({ t: tSec, flux })
    while (this.onsetFluxes.length && tSec - this.onsetFluxes[0].t > this.opts.strengthWinSec) {
      this.onsetFluxes.shift()
    }
    // tie-aware 中位排名（fb5）：并列取中位名次；ties 含自己（≥1），无并列时与旧公式
    // (below+0.5)/n 逐值等价——对比度语义无缝继承
    let below = 0
    let ties = 0
    for (const o of this.onsetFluxes) {
      if (o.flux < flux * (1 - TIE_EPS)) below++
      else if (o.flux <= flux * (1 + TIE_EPS)) ties++
    }
    const strength = (below + ties / 2) / this.onsetFluxes.length
    return { onset: true, strength }
  }
}

export class BeatDetector {
  private readonly kick: FluxChannel
  private readonly snare: FluxChannel
  private readonly mergeGuardSec: number
  private lastBeatT = -Infinity

  constructor(sampleRate: number, hopSize: number, opts: Partial<BeatOpts> = {}) {
    const o = { ...DEFAULT_OPTS, ...opts }
    const hopSec = hopSize / sampleRate
    const winLen = Math.round(o.threshWinSec / hopSec)
    const binHz = sampleRate / hopSize // FFT 长度 = hopSize，谱为其一半
    const bin = (hz: number): number => Math.round(hz / binHz)
    // kick 上限 200Hz（校准实测：280Hz 混入低中频泄漏，三首歌规整度掉线）；bin 0 是 DC，跳过
    this.kick = new FluxChannel(Math.max(1, bin(30)), bin(200), winLen, o.madK, o)
    this.snare = new FluxChannel(bin(1000), bin(5000), winLen, o.snareMadK, o)
    this.mergeGuardSec = o.mergeGuardSec
  }

  push(spectrum: Float32Array, tSec: number): { onBeat: boolean; strength: number } {
    const k = this.kick.push(spectrum, tSec)
    const s = this.snare.push(spectrum, tSec)
    // 合并守卫：kick/snare 对同一鼓点常前后脚触发（EMA 滞后不同），只对外报一次
    const onBeat = (k.onset || s.onset) && tSec - this.lastBeatT > this.mergeGuardSec
    if (onBeat) this.lastBeatT = tSec
    return { onBeat, strength: onBeat ? Math.max(k.strength, s.strength) : 0 }
  }

  get bpm(): number | null {
    const times = this.kick.onsetTimes
    if (times.length < 4) return null
    const iois: number[] = []
    for (let i = 1; i < times.length; i++) {
      let ioi = times[i] - times[i - 1]
      // 倍/半折叠进 70–180 BPM 对应的间隔 [0.333, 0.857]
      while (ioi < 0.333) ioi *= 2
      while (ioi > 0.857) ioi /= 2
      iois.push(ioi)
    }
    iois.sort((a, b) => a - b)
    const median = iois[Math.floor(iois.length / 2)]
    return Math.round(60 / median)
  }
}
