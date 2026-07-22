// 星尘烘焙（视觉重做 spec §3.2）：粒子池全量铺沿旋臂的暗色星尘雾气，星本体改由 star-sprites 实例化渲染。
// 旧「每星粒子配额/密度补偿」体系退役。全确定性（hash01），同输入同输出。
import { hash01 } from '../cover-points'
import type { ShapePointCloud } from '../cover-points'
import type { GalaxyStar } from './types'
import type { StarPlacement } from './layout'
import { ARM_COUNT, LAYOUT_R0, LAYOUT_TWIST, DISK_THICKNESS, galaxyRadius } from './layout'

// ===== 亲验旋钮 =====
export const DUST_TINT: [number, number, number] = [0.10, 0.12, 0.22]
export const DUST_BRIGHT = 0.045        // 尘埃亮度基数（恒暗于星本体；亲验调参一轮收暗，衬星光点对比）
export const DUST_ARM_SPREAD = 0.16     // 臂横截面高斯 σ（世界单位）
export const DUST_R_POW = 0.75          // 半径分布幂：<1 外圈铺得更开，>1 向核心聚
export const DUST_NEAR_STAR_SHARE = 0.3 // 星旁加密份额（星嵌在雾里的归属感）
export const DUST_NEAR_SIGMA = 0.10     // 星旁加密散布 σ
export const DUST_NEAR_TINT_MIX = 0.2   // 星旁尘埃向星色混色比（0=纯尘色，极弱即可）

export function starWeight(playCount: number): number {
  return 1 + Math.log2(Math.max(1, playCount))
}

export interface BakedGalaxy { cloud: ShapePointCloud; centers: Float32Array }

/** 确定性高斯（Box-Muller on hash01） */
function gauss(seed: number): number {
  const u1 = Math.max(hash01(seed), 1e-6)
  const u2 = hash01(seed * 1.618 + 7)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function bakeGalaxyCloud(
  stars: GalaxyStar[], placements: StarPlacement[], count: number
): BakedGalaxy {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const centers = new Float32Array(stars.length * 3)
  for (let s = 0; s < stars.length; s++) {
    centers[s * 3] = placements[s].x
    centers[s * 3 + 1] = placements[s].y
    centers[s * 3 + 2] = placements[s].z
  }
  const rMax = galaxyRadius(stars.length)
  const rMin = LAYOUT_R0 * 0.35
  for (let p = 0; p < count; p++) {
    const seed = 10_000_000 + p * 11 // 沿用旧星尘种子命名空间，确定性口径不变
    // 每粒亮度微差（0.6~1.4×）：雾有深浅层次，避免整片死平
    const b = DUST_BRIGHT * (0.6 + 0.8 * hash01(seed + 6))
    let tint: [number, number, number] = DUST_TINT
    if (stars.length === 0) {
      // 空态默认小盘（沿用 V1 空态散布口径）
      positions[p * 3] = gauss(seed + 1) * 0.8
      positions[p * 3 + 1] = gauss(seed + 2) * 0.15
      positions[p * 3 + 2] = gauss(seed + 3) * 0.8
    } else if (hash01(seed + 7) < DUST_NEAR_STAR_SHARE) {
      // 星旁加密：随机星心近旁高斯团，颜色向星色极轻混
      const s = Math.floor(hash01(seed) * stars.length)
      positions[p * 3] = centers[s * 3] + gauss(seed + 1) * DUST_NEAR_SIGMA
      positions[p * 3 + 1] = centers[s * 3 + 1] + gauss(seed + 2) * DUST_NEAR_SIGMA * 0.5
      positions[p * 3 + 2] = centers[s * 3 + 2] + gauss(seed + 3) * DUST_NEAR_SIGMA
      const st = stars[s].tint
      if (st) {
        tint = [
          DUST_TINT[0] + (st[0] - DUST_TINT[0]) * DUST_NEAR_TINT_MIX,
          DUST_TINT[1] + (st[1] - DUST_TINT[1]) * DUST_NEAR_TINT_MIX,
          DUST_TINT[2] + (st[2] - DUST_TINT[2]) * DUST_NEAR_TINT_MIX,
        ]
      }
    } else {
      // 旋臂雾气：沿 layout 同一套螺线常量走臂形，旋臂形态由星尘显形（spec §3.2）
      const u = hash01(seed + 1)
      const r = rMin + (rMax - rMin) * Math.pow(u, DUST_R_POW)
      const arm = Math.floor(hash01(seed + 2) * ARM_COUNT)
      const theta = arm * ((Math.PI * 2) / ARM_COUNT) + r * LAYOUT_TWIST
      positions[p * 3] = Math.cos(theta) * r + gauss(seed + 3) * DUST_ARM_SPREAD
      positions[p * 3 + 1] = gauss(seed + 4) * DISK_THICKNESS * 0.6
      positions[p * 3 + 2] = Math.sin(theta) * r + gauss(seed + 5) * DUST_ARM_SPREAD
    }
    colors[p * 3] = tint[0] * b
    colors[p * 3 + 1] = tint[1] * b
    colors[p * 3 + 2] = tint[2] * b
  }
  return { cloud: { positions, colors }, centers }
}
