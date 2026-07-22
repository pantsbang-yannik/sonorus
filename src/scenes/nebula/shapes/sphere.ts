// 星球：均匀薄壳球面（半径 1.15±0.04）。区别于星云默认目标的厚壳体 [1,1.5]——薄壳读起来才是"一颗星球"，
// 弹性脉冲下整体呼吸（spec：体积感最强，像心跳）。
import type { ShapePointCloud } from '../cover-points'
import { makeXorshift } from './rand'

const RADIUS = 1.15
const THICKNESS = 0.04

export function generateSphere(count: number): ShapePointCloud {
  const positions = new Float32Array(count * 3)
  const rand = makeXorshift(0x51ab3e77)
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const z = rand() * 2 - 1
    const s = Math.sqrt(Math.max(0, 1 - z * z))
    const r = RADIUS + (rand() * 2 - 1) * THICKNESS
    positions[i * 3] = s * Math.cos(a) * r
    positions[i * 3 + 1] = s * Math.sin(a) * r
    positions[i * 3 + 2] = z * r
  }
  return { positions }
}
