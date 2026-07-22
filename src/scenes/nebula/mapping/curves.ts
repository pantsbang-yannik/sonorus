import type { MappingCurve } from './types'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** 把归一输入 t∈[0,1] 经曲线整形，返回 [0,1]。 */
export function applyCurve(curve: MappingCurve, t: number): number {
  const x = clamp01(t)
  switch (curve) {
    case 'linear':
      return x
    case 'ease': // smoothstep：平滑起步/收尾
      return x * x * (3 - 2 * x)
    case 'punch': // 幂次压中段，拉开强弱（与 signal-rig KICK_GAMMA=1.5 同族）
      return Math.pow(x, 1.5)
    case 'softClip': // 快起、软收顶，避免爆表硬切
      return clamp01(1 - Math.pow(1 - x, 2))
    default:
      return x
  }
}
