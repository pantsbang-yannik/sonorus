import type { UiFocusProfile } from '../types'

export interface UiFocusOutput { dim: number; defocus: number; camera: number }

/** UI 前置度 → 场景退台参数（M4 设计 2.3 路线 C；A2 退台分级）。
 * 'full'：调暗 + 退焦 + 镜头后拉三联动（原状，逐帧不变）。
 * 'camera'：只后拉，不调暗不退焦（调试台专用，便于边调边看）。
 */
export function uiFocusOutput(v: number, profile: UiFocusProfile): UiFocusOutput {
  const camera = v * 0.8
  if (profile === 'camera') return { dim: 1, defocus: 0, camera }
  return { dim: 1 - v * 0.45, defocus: v, camera } // 'full'
}
