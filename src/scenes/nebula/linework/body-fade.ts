// 主体交接多槽 crossfade(图形三连 spec §编排接线):纯逻辑零 three/DOM。
// 每槽独立向目标(active=1/其余=0)线性推进——粒子也是普通槽位,
// 线条↔线条互切时粒子槽双目标恒 0 不会闪现;速率=dt/fadeSec(与旧二元 bodyFade 等价)。
import type { BodyKind } from '../shapes/types'

export const BODY_SLOTS = ['particles', 'linework', 'eclipse', 'ledmatrix', 'laser'] as const
export type BodySlot = (typeof BODY_SLOTS)[number]

/** spectrum/waveform 共用一块 LineworkBody 画板(setMode 即时换,现状不动)→归并 linework 槽 */
export function slotOfBody(b: BodyKind): BodySlot {
  return b === 'spectrum' || b === 'waveform' ? 'linework' : b
}

export class BodyCrossfade {
  private readonly fades = new Map<BodySlot, number>(BODY_SLOTS.map((s) => [s, s === 'particles' ? 1 : 0]))

  update(dt: number, active: BodySlot, fadeSec: number): void {
    const step = dt / Math.max(fadeSec, 1e-3)
    for (const s of BODY_SLOTS) {
      const cur = this.fades.get(s)!
      const target = s === active ? 1 : 0
      this.fades.set(s, target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step))
    }
  }

  fadeOf(slot: BodySlot): number { return this.fades.get(slot)! }
}
