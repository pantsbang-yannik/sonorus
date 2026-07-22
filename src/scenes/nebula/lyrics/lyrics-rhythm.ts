// 歌词节奏三层（批2 spec §3）：呼吸/沸腾/脉冲/burst 的时域状态——纯逻辑零 DOM。
// 输出乘进 LyricsParticles 的 uScale/uSpread/uBrightness 通路（mapper→uniform 分工先例，
// 渲染类不长逻辑）。沿（burst 进入沿）由场景侧计算，本类只消费布尔沿+连续量。
// 可读性护栏（spec §3.1）：呼吸 ±4% 锁死、脉冲只动亮度、burst 冲击快速回收——字形恒可辨；
// 碎散聚（fb4）：冲散只认强拍/drop 且带不应期，字形在碎片节奏下恒可辨。
// 沸腾源=中频（人声区，形状改造④分工：低频管形状/中频管歌词/高频管尘埃）
import { EnvelopeFollower, Pulse } from '../../shared/motion'

export interface LyricsRhythmInputs {
  energy: number        // rig 平滑后能量（u.uEnergy）
  mid: number            // 中频包络（u.uMid，人声区）——形状改造④：人声起伏驱动歌词沸腾，高频让位给背景尘埃
  onBeat: boolean       // 本 hop 鼓点（signals.beat.onBeat；无信号=false）
  beatStrength: number  // 鼓点强度
  bpm: number | null
  burstEdge: boolean    // narrative 进入 burst 的沿
  dropEdge: boolean     // drop 沿（fb4 碎散聚：歌词炸开-重聚，语义从调度层杀句改道而来）
}

export interface LyricsRhythmFrame {
  scaleMul: number   // 呼吸：乘 uScale，1±BREATH_AMP
  spreadAdd: number  // 沸腾基线 + burst 冲击（加到 LyricsFrame.spread 上，消费端钳 ≤1）
  brightAdd: number  // 脉冲+burst 高光：亮度乘法侧用 (1 + brightAdd)
}

export const BREATH_AMP = 0.04
export const BOIL_MAX = 0.05
export const PULSE_GAIN = 0.5
export const PULSE_HALF_LIFE = 0.1   // 3 个半衰期 ≈ 0.3s 衰减回落（spec §3.1）
export const BURST_SPREAD = 0.25
export const BURST_HALF_LIFE = 0.12  // 冲 0.25 快速回收
export const BURST_GLOW = 0.4
/** fb4 碎散聚（借主粒子云崩解重聚语法）：drop=大炸开、强拍=中冲散，重聚半衰期挂 BPM——
 * 快歌收得快跟得上节奏、慢歌稍缓不一惊一乍；不应期保证「散」是重音的标点不是常态。
 * 全部为亲验起点值，收敛改这里（先例同涟漪门槛/WIND_*）。 */
export const DROP_SCATTER = 0.85           // drop 炸开幅度：接近全散，字化星尘再回来
export const KICK_SCATTER = 0.35           // 强拍中冲散：散而不失轮廓
export const KICK_SCATTER_THRESHOLD = 0.75 // 强拍门槛（beat.strength=hybrid 合成语义，fb5：能量语境为主——高能段全过线由不应期限流成规律，安静段一致克制，借涟漪先例）
const SCATTER_HALF_LIFE_FRAC = 0.22        // 半衰期 = beatPeriod×本值，钳 [MIN,MAX]
const SCATTER_HALF_LIFE_MIN = 0.09
const SCATTER_HALF_LIFE_MAX = 0.18
const SCATTER_HALF_LIFE_FALLBACK = 0.12    // 无 bpm 兜底
const SCATTER_REFRACTORY_FRAC = 0.9        // 不应期 = max(beatPeriod×本值, MIN)；drop 无视并重置
const SCATTER_REFRACTORY_MIN = 0.35

const NEUTRAL: LyricsRhythmFrame = { scaleMul: 1, spreadAdd: 0, brightAdd: 0 }
const BREATH_BASELINE = 0.5 // energy 中点=呼吸静息位（scaleMul=1）

export class LyricsRhythm {
  private breath = new EnvelopeFollower(0.25, 0.35) // 微缩放不追瞬时，缓起缓落
  private pulse = new Pulse(PULSE_HALF_LIFE)
  private burstSpread = new Pulse(BURST_HALF_LIFE)
  private burstGlow = new Pulse(PULSE_HALF_LIFE)
  private sinceBeat = Infinity
  private lastBpm: number | null = null
  /** 碎散聚脉冲（fb4）：半衰期挂 BPM 动态算，故不用固定半衰的 Pulse，手写指数衰减 */
  private scatter = 0
  private scatterCooldown = 0 // 强拍冲散不应期剩余秒

  constructor() {
    this.breath.value = BREATH_BASELINE
  }

  /** dynamics=false：输出中性并复位内部状态（重开不带旧残留） */
  update(dt: number, inp: LyricsRhythmInputs, dynamics: boolean): LyricsRhythmFrame {
    if (!dynamics) {
      this.reset()
      return NEUTRAL
    }
    if (inp.onBeat) {
      this.sinceBeat = 0
      this.pulse.trigger(PULSE_GAIN * inp.beatStrength)
    } else {
      this.sinceBeat += dt
    }
    this.lastBpm = inp.bpm
    if (inp.burstEdge) {
      this.burstSpread.trigger(BURST_SPREAD)
      this.burstGlow.trigger(BURST_GLOW)
    }
    // fb4 碎散聚：drop=大炸开（无视不应期并重置它），强拍=中冲散（不应期内忽略——密集鼓点
    // 下只有第一拍炸开，后续拍只打亮度，「散」是重音标点不是常态）
    const period = inp.bpm !== null && inp.bpm > 0 ? 60 / inp.bpm : null
    const refractory = period !== null
      ? Math.max(period * SCATTER_REFRACTORY_FRAC, SCATTER_REFRACTORY_MIN)
      : SCATTER_REFRACTORY_MIN
    this.scatterCooldown = Math.max(0, this.scatterCooldown - dt)
    if (inp.dropEdge) {
      this.scatter = Math.max(this.scatter, DROP_SCATTER)
      this.scatterCooldown = refractory
    } else if (inp.onBeat && inp.beatStrength >= KICK_SCATTER_THRESHOLD && this.scatterCooldown <= 0) {
      this.scatter = Math.max(this.scatter, KICK_SCATTER)
      this.scatterCooldown = refractory
    }
    // 重聚半衰期挂 BPM：3 个半衰期 ≈ 炸开后基本可读（~0.4-0.6s）
    const scatterHalfLife = period !== null
      ? Math.min(SCATTER_HALF_LIFE_MAX, Math.max(SCATTER_HALF_LIFE_MIN, period * SCATTER_HALF_LIFE_FRAC))
      : SCATTER_HALF_LIFE_FALLBACK
    this.scatter *= Math.pow(0.5, dt / scatterHalfLife)
    const breath = this.breath.update(inp.energy, dt)
    return {
      scaleMul: 1 + (breath * 2 - 1) * BREATH_AMP,
      spreadAdd: inp.mid * BOIL_MAX + this.burstSpread.update(dt) + this.scatter,
      brightAdd: this.pulse.update(dt) + this.burstGlow.update(dt),
    }
  }

  /** 预测下一拍距今秒（morph 对拍用）：以最近一次 onBeat 为锚按 bpm 周期外推 */
  nextBeatIn(): number | null {
    if (this.lastBpm === null || this.lastBpm <= 0 || !Number.isFinite(this.sinceBeat)) return null
    const period = 60 / this.lastBpm
    return period - (this.sinceBeat % period)
  }

  /** 亲验 fb1-D：dynamicsGain 整体缩放本类输出（消费端/接线处调用，本类不感知设置——保持纯逻辑）。
   * scaleMul 是"偏离 1 的量"，按 gain 缩放偏离量而非整体相乘（scale=1+(breath-1)×gain 语义）；
   * spreadAdd/brightAdd 是加量，直接乘 gain。gain=0 时退化为 NEUTRAL，与 dynamics=false 视觉等价。 */
  static applyGain(frame: LyricsRhythmFrame, gain: number): LyricsRhythmFrame {
    return {
      scaleMul: 1 + (frame.scaleMul - 1) * gain,
      spreadAdd: frame.spreadAdd * gain,
      brightAdd: frame.brightAdd * gain,
    }
  }

  private reset(): void {
    this.breath.value = BREATH_BASELINE
    this.pulse.value = 0
    this.burstSpread.value = 0
    this.burstGlow.value = 0
    this.sinceBeat = Infinity
    this.lastBpm = null
    this.scatter = 0
    this.scatterCooldown = 0
  }
}
