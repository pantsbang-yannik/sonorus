// 叙事层（Phase C 三层信号模型的真状态机，spec 2026-07-11 §3）：常态/蓄力/爆发/消散 4 态。
// 只消费 EnergyTracker 的下游语义（energy/drop/silence），不做任何新音频分析；
// 全场唯一"剧本"——形状运动程序只演绎、不自判（用户拍板：状态机进引擎，方言复制会失去全场共识）。
// 不进 Signals 契约/trace 格式：叙事可由既有信号确定性推导，回放即真机。

export type NarrativePhase = 'steady' | 'build' | 'burst' | 'release'

export interface NarrativeState {
  phase: NarrativePhase
  /** build: 爬升进度 0..1（越逼近 drop 级爬升越高）；burst: 剩余强度 1→0；
   *  release: 回落深度 0..1；steady: 恒 0 */
  progress: number
}

export interface NarrativeInput {
  energy: number
  drop: boolean
  silence: boolean
}

const WINDOW_SEC = 3 // 爬升/回落对照窗口。比 drop 判据的 1.5s 宽：蓄力是"酝酿"，看得更远
const BUILD_RISE_THRESHOLD = 0.12 // 3s 内爬升 ≥ 此值进蓄力（drop 要 0.22/1.5s，半路就该有预期感）
const BUILD_ENERGY_FLOOR = 0.3 // 低位小抖动不算蓄力（同 drop 的 ENERGY_FLOOR 思路，阈值按蓄力语义放低）
const BUILD_PROGRESS_SPAN = 0.25 // progress = rise/span：爬到 drop 级幅度时逼近 1
const RELEASE_FALL_THRESHOLD = 0.15 // 3s 内回落 ≥ 此值进消散（比进蓄力略钝：离场从容些）
const RELEASE_PROGRESS_SPAN = 0.3
const BURST_HOLD_SEC = 2.5 // 爆发演出窗口；结束后按当下能量归位（高能平原=常态，不是永恒爆发）
const MIN_DWELL_SEC = 0.5 // 防抖驻留：非 burst 切换的最短驻留（8 态状态机否决理由①的机制化）
const COLDSTART_SEC = 5 // 冷启动免疫，与 EnergyTracker drop 同宽：峰谷窗口未建立时不讲叙事

export class NarrativeTracker {
  private t = 0
  private history: { t: number; e: number }[] = []
  private phase: NarrativePhase = 'steady'
  private progress = 0
  private phaseSince = 0
  private burstUntil = -Infinity

  get state(): NarrativeState {
    return { phase: this.phase, progress: this.progress }
  }

  update(dt: number, inp: NarrativeInput): NarrativeState {
    this.t += dt
    this.history.push({ t: this.t, e: inp.energy })
    while (this.history.length > 1 && this.history[0].t < this.t - WINDOW_SEC) this.history.shift()
    const past = this.history[0].e
    const rise = inp.energy - past
    const fall = past - inp.energy

    if (inp.drop && this.t >= COLDSTART_SEC) this.burstUntil = this.t + BURST_HOLD_SEC

    // 候选裁决。优先级：burst > silence 归常态 > build > release > steady
    let candidate: NarrativePhase
    if (this.t < COLDSTART_SEC) candidate = 'steady'
    else if (this.t < this.burstUntil) candidate = 'burst'
    else if (inp.silence) candidate = 'steady'
    else if (rise >= BUILD_RISE_THRESHOLD && inp.energy >= BUILD_ENERGY_FLOOR) candidate = 'build'
    else if (fall >= RELEASE_FALL_THRESHOLD) candidate = 'release'
    else candidate = 'steady'

    // 防抖驻留：进 burst 不等（鼓不等人），其余切换须已驻留 MIN_DWELL_SEC
    if (candidate !== this.phase) {
      if (candidate === 'burst' || this.t - this.phaseSince >= MIN_DWELL_SEC) {
        this.phase = candidate
        this.phaseSince = this.t
      }
    }

    const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
    switch (this.phase) {
      case 'build': this.progress = clamp01(rise / BUILD_PROGRESS_SPAN); break
      case 'burst': this.progress = clamp01((this.burstUntil - this.t) / BURST_HOLD_SEC); break
      case 'release': this.progress = clamp01(fall / RELEASE_PROGRESS_SPAN); break
      default: this.progress = 0
    }
    return this.state
  }
}
