// 封面主色提取（spec §六）：4×4 均值级别的便宜做法，不引依赖。输出线性空间 rgb 0..1。
import type { PixelSource } from '../cover-points'

const srgbToLinear = (v: number): number => Math.pow(v / 255, 2.2)

export function dominantTint(img: PixelSource): [number, number, number] {
  let r = 0, g = 0, b = 0
  const n = img.width * img.height
  if (n === 0) return [0.55, 0.65, 1.0] // 空图守卫（评审 P2）：回默认星色，不除零
  for (let i = 0; i < n; i++) {
    r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2]
  }
  let lr = srgbToLinear(r / n), lg = srgbToLinear(g / n), lb = srgbToLinear(b / n)
  // 亮度归一：暗封面的星不该发灰——最大分量抬到 ≥0.55（保持色相比例）
  const m = Math.max(lr, lg, lb, 1e-4)
  if (m < 0.55) { const k = 0.55 / m; lr *= k; lg *= k; lb *= k }
  return [Math.min(1, lr), Math.min(1, lg), Math.min(1, lb)]
}
