// 纯逻辑映射层：Signals + MappingValues → VisualControls。对形状无知（spec §5.1）。
import type { Signals } from '../../../engine/types'
import { EnvelopeFollower, Spring } from '../../shared/motion'
import { applyCurve } from './curves'
import { VISUAL_TARGETS, type AudioFeature, type MappingRule, type MappingValues, type VisualControls, type VisualTarget } from './types'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
// space/brightness 用弹性 Spring 产过冲；其余目标用 EnvelopeFollower
const PULSE_TARGETS: VisualTarget[] = ['space', 'brightness']

export class AudioVisualMapper {
  private beatCount = 0
  private envs = new Map<string, EnvelopeFollower>() // key = `${target}.primary`（仅 envelope 目标；pulse 目标走 springs）
  private springs = new Map<VisualTarget, Spring>()

  constructor() {
    for (const t of PULSE_TARGETS) this.springs.set(t, new Spring(6, 0.35)) // 高频弱阻尼=弹起过冲
  }

  private downbeatActive(): boolean {
    return this.beatCount % 4 === 0
  }

  private readFeature(s: Signals | null, f: AudioFeature): number {
    if (!s) return 0
    switch (f) {
      case 'beat': return s.beat.onBeat ? s.beat.strength : 0
      case 'downbeat': return s.beat.onBeat && this.downbeatActive() ? s.beat.strength : 0
      case 'low': return s.bands.low
      case 'mid': return s.bands.mid
      case 'high': return s.bands.high
      case 'energy': return s.energy
      case 'drop': return s.drop ? 1 : 0
      case 'loudness': return s.loudness.smooth
      case 'silence': return s.silence ? 1 : 0
      case 'tempo': return s.bpm ? clamp01((s.bpm - 60) / 120) : 0.5
    }
  }

  /** 单条规则的即时映射值（未平滑）：读特征 → 归一到 input 区间 → 曲线 → 缩到 output 区间 × gain。 */
  private evalRule(s: Signals | null, r: MappingRule): number {
    if (!r.enabled) return 0
    const raw = this.readFeature(s, r.source)
    const span = r.inputMax - r.inputMin
    let t = span <= 0 ? 0 : clamp01((raw - r.inputMin) / span)
    if (r.invert) t = 1 - t
    const shaped = applyCurve(r.curve, t)
    return (r.outputMin + (r.outputMax - r.outputMin) * shaped) * r.gain
  }

  update(signals: Signals | null, values: MappingValues, dt: number): VisualControls {
    if (signals?.beat.onBeat) this.beatCount++

    const out = { speed: 0, density: 0, space: 0, brightness: 0, thickness: 0 } as VisualControls
    for (const target of VISUAL_TARGETS) {
      const tm = values.targets[target]
      const primaryTarget = this.evalRule(signals, tm.primary)
      const secondaryTarget = tm.secondary ? this.evalRule(signals, tm.secondary) : 0
      const raw = primaryTarget + secondaryTarget
      // brightness 允许越过 1（消费端做更亮的闪光）；其余目标进平滑器前先夹到 [0,1]
      const combined = target === 'brightness' ? raw : clamp01(raw)

      if (PULSE_TARGETS.includes(target)) {
        // 弹性过冲：Spring 追 combined（冲量帧高、其余帧 0）→ attack 快、release 带 overshoot
        const spring = this.springs.get(target)!
        out[target] = Math.max(0, spring.update(combined, dt))
      } else {
        const key = `${target}.primary`
        let env = this.envs.get(key)
        const attack = Math.max(0.001, tm.primary.smoothingMs / 1000)
        if (!env) { env = new EnvelopeFollower(attack, attack); this.envs.set(key, env) }
        out[target] = clamp01(env.update(combined, dt))
      }
    }
    return out
  }
}
