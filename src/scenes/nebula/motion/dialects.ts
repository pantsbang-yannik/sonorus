// 方言指挥（方言期批1，spec 2026-07-12 §3.4）：家族权重翻转 + 逐家族驱动器（心跳等逐家族驱动器）。
// 分工纪律：方言家族 uniform（3 家族权重+uPointBeat+驱动值，SSOT=DialectUniforms 接口）只由本类覆写；
// setFamily 由编排层在 applyResolved 调用——
// 家族翻转发生在形状切换 morph≈0 窗口（spec §3.2），离散翻转无可见跳变，不需要交叉淡化。
import { Pulse } from '../../shared/motion'
import type { MotionInputs } from './nebula-program'
import type { MotionSettings } from './types'
import type { DialectFamily } from '../shapes/types'

export interface DialectUniforms {
  uDialContour: { value: number }; uDialHeart: { value: number }
  uDialCrystal: { value: number }
  uHeartPulse: { value: number }
  uPointBeat: { value: number }
}

// —— 心脏（用户 2026-07-12 拍板「音乐为主+静态微搏」）——
const HEART_REST_BPM = 60 // 自主心跳节律（生命体休息态）
const HEART_REST_AMP = 0.22 // 自主微搏幅度（相对满搏 1）：可感但不抢戏
const HEART_IDLE_AFTER_SEC = 1.5 // 无鼓点这么久后自主心跳接管；鼓点回来即让位
const HEART_PULSE_HALF_LIFE = 0.14 // 收缩包络半衰：短促收缩、回弹交给吸附弹簧

export class DialectConductor {
  private family: DialectFamily = 'none'
  private heartPulse = new Pulse(HEART_PULSE_HALF_LIFE)
  private sinceKick = Infinity // 初始∞：无乐启动时自主心跳立即可接管
  private heartClock = 0

  constructor(private u: DialectUniforms) {}

  /** 家族权重翻转（编排层 applyResolved 时调用）。heart 家族包含 contour 约束：法线浮雕+泵动 */
  setFamily(f: DialectFamily): void {
    this.family = f
    this.u.uDialContour.value = f === 'contour' || f === 'heart' ? 1 : 0
    this.u.uDialHeart.value = f === 'heart' ? 1 : 0
    this.u.uDialCrystal.value = f === 'crystal' ? 1 : 0
    this.u.uPointBeat.value = f === 'none' ? 1 : 0 // 点源打击语法只留给星云/星球/封面
  }

  update(dt: number, inp: MotionInputs, s: MotionSettings): void {
    // 心跳：鼓点即心跳（kickStrength 是单帧冲量，鼓点帧非零）；静默超时后 60bpm 自主微搏接管
    if (inp.kickStrength > 0.05) {
      this.sinceKick = 0
      this.heartClock = 0
      this.heartPulse.trigger(Math.min(1, 0.5 + inp.kickStrength * 0.5))
    } else {
      this.sinceKick += dt
    }
    if (this.family === 'heart' && this.sinceKick > HEART_IDLE_AFTER_SEC) {
      this.heartClock += dt
      const period = 60 / HEART_REST_BPM
      if (this.heartClock >= period) {
        this.heartClock -= period
        this.heartPulse.trigger(HEART_REST_AMP)
      }
    }
    this.u.uHeartPulse.value = Math.min(1.2, this.heartPulse.update(dt) * s.bombIntensity)
  }
}
