import { easeDrift } from '../shared/motion'

export interface AwakeningParams {
  durationSec: number
  kickStrength: number
}

/** 苏醒仪式受首歌能量调制（4.6 第 9 条）：安静的歌缓慢苏醒，炸歌直接撕开。
 *  纯映射：能量快照 → 时长/冲量。定稿时用观察窗口内的 max(energy) 喂进来。 */
export function awakeningParams(energySnapshot: number): AwakeningParams {
  const t = easeDrift(Math.max(0, Math.min(1, energySnapshot)))
  return {
    durationSec: 3.5 + (1.2 - 3.5) * t,
    kickStrength: 0.35 + (0.9 - 0.35) * t
  }
}

/** M2 基线苏醒参数（2.5s / 0.6）——边沿帧能量包络尚未爬升时的保底起步值，永不回归。 */
const M2_BASELINE: AwakeningParams = { durationSec: 2.5, kickStrength: 0.6 }

/**
 * 苏醒参数「延迟决策」：sleep→awakening 边沿的那一帧，能量包络（EnvelopeFollower attack 0.08s，T10a 后现值）
 * 积累不再是 ~3% 量级（旧 attack 0.5s 时代的数字），但单帧仍未收敛，此刻读 uEnergy 判「安静/炸歌」仍可能失真——
 * 对策：边沿先用 M2 基线（2.5s/0.6）起步；开一个观察窗口（默认 0.35s，窗内可达位 ~99%）取窗口内 max(energy)，
 * 窗口结束的那一帧一次性定稿真正的时长/冲量，无跳变地重排剩余苏醒过渡。
 */
export class AwakeningDirector {
  private readonly observeSec: number
  private observing = false
  private elapsed = 0
  private maxEnergy = 0

  constructor(observeSec = 0.35) {
    this.observeSec = observeSec
  }

  /** 苏醒边沿调用：开启观察窗口，返回 M2 基线临时参数（保底不回归）。 */
  onEdge(): AwakeningParams {
    this.observing = true
    this.elapsed = 0
    this.maxEnergy = 0
    return { ...M2_BASELINE }
  }

  /**
   * 每帧调用（仅 awakening 态）：喂当前能量，累积窗口时长。
   * 观察窗口结束的那一帧返回定稿参数（用窗口内 max(energy)），其余帧返回 null；只定稿一次。
   */
  update(dt: number, energy: number): AwakeningParams | null {
    if (!this.observing) return null
    if (energy > this.maxEnergy) this.maxEnergy = energy
    this.elapsed += dt
    if (this.elapsed >= this.observeSec) {
      this.observing = false
      return awakeningParams(this.maxEnergy)
    }
    return null
  }
}
