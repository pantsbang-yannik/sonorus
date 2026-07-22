// 性能档位表 + FPS 降级决策（纯逻辑，无 three/DOM 依赖，见设计第 6 节）。
// 降级顺序（亲验 fb1 修订①：倒影整体退役，降级序列缩至 5 级）：背景先于主粒子被牺牲（粒子密度是核心资产）：
// DPR → 后期 → 涟漪 → 粒子 → floor。
import type { QualityTier } from '../types'

const BG_FULL = { auroraDetail: 'full', ripple: true, nearDust: true } as const
export const TIERS: Record<'ultra' | 'high' | 'mid' | 'low', QualityTier> = {
  ultra: { name: 'ultra', particles: 450_000, dprCap: 1.5, bloom: true, background: BG_FULL },
  high: { name: 'high', particles: 350_000, dprCap: 1.5, bloom: true, background: BG_FULL },
  mid: { name: 'mid', particles: 180_000, dprCap: 1.0, bloom: true, background: { auroraDetail: 'full', ripple: true, nearDust: false } },
  low: { name: 'low', particles: 100_000, dprCap: 1.0, bloom: false, background: { auroraDetail: 'simple', ripple: false, nearDust: false } }
}

/** webgpu → high（M 系默认档；设计第 6 节：默认值不许拿最高档 ultra）；webgl → mid */
export function pickInitialTier(backend: 'webgpu' | 'webgl'): QualityTier {
  return backend === 'webgpu' ? TIERS.high : TIERS.mid
}

export type DowngradeAction = 'keep' | 'lowerDpr' | 'disablePost' | 'dropBgRipple' | 'lowerParticles' | 'floor'
// 背景先于主粒子被牺牲（粒子是核心资产）：dropBgRipple 一档吃掉涟漪+极光简化+近尘全部背景职责
// （亲验 fb1 修订①：倒影退役后原 dropBgReflection 的近尘职责并入本档）
const SEQUENCE: DowngradeAction[] = ['lowerDpr', 'disablePost', 'dropBgRipple', 'lowerParticles', 'floor']

/**
 * 滑窗均值持续低于目标的 85% 时按序返回下一步降级动作。
 * 均值用 frames/acc（总帧数/总时长=标准平均帧率，时间加权，天然抗异常帧：
 * 单帧 dt 极小只贡献可忽略的时长，不会像逐帧 1/dt 求算术平均那样把整窗读数成倍放大）。
 * 每次触发动作后进入半窗「稳定期」：既丢弃跨窗残留的旧慢帧（防止帧率已恢复
 * 却因残窗混合误判再降一级），也给降级动作生效留观察时间。
 * 稳定期取 windowSec/2 而非整窗：规格要求持续低帧时每 1.5×windowSec 推进一级
 * （settle+新窗 ≤ 1.5×windowSec ⇒ settle ≤ windowSec/2），整窗稳定期会让动作节奏漂移。
 */
export class FpsGovernor {
  private readonly targetFps: number
  private readonly windowSec: number
  private acc = 0
  private frames = 0
  private stage = 0
  private settleRemaining = 0

  constructor(opts: { targetFps?: number; windowSec?: number } = {}) {
    this.targetFps = opts.targetFps ?? 55
    this.windowSec = opts.windowSec ?? 5
  }

  push(dt: number): DowngradeAction {
    if (dt <= 0) return 'keep' // dt 防护：host 的 dt 只有上界钳制没有下界，dt≈0/负值不计数
    if (this.settleRemaining > 0) {
      this.settleRemaining -= dt
      return 'keep'
    }
    this.acc += dt
    this.frames++
    if (this.acc < this.windowSec) return 'keep'
    const avgFps = this.frames / this.acc
    this.acc = 0
    this.frames = 0
    if (avgFps >= this.targetFps * 0.85) return 'keep'
    this.settleRemaining = this.windowSec / 2
    if (this.stage >= SEQUENCE.length) return 'floor'
    return SEQUENCE[this.stage++]
  }
}
