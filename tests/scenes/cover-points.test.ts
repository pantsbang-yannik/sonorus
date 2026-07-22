import { describe, it, expect } from 'vitest'
import { sampleCoverPoints, type PixelSource } from '../../src/scenes/nebula/cover-points'

/** 左半纯黑右半纯白的 16x16 测试图 */
function halfImage(): PixelSource {
  const w = 16, h = 16
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < w / 2 ? 0 : 255
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  return { width: w, height: h, data }
}

describe('sampleCoverPoints', () => {
  it('数量精确、坐标在 [-1,1]、明区 z 高于暗区', () => {
    const cloud = sampleCoverPoints(halfImage(), 1000)
    expect(cloud.positions.length).toBe(3000)
    expect(cloud.colors!.length).toBe(3000)
    const zLeft: number[] = [], zRight: number[] = []
    for (let i = 0; i < 1000; i++) {
      const x = cloud.positions[i * 3], z = cloud.positions[i * 3 + 2]
      expect(Math.abs(x)).toBeLessThanOrEqual(1)
      expect(Math.abs(cloud.positions[i * 3 + 1])).toBeLessThanOrEqual(1)
      ;(x < 0 ? zLeft : zRight).push(z)
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    expect(avg(zRight)).toBeGreaterThan(avg(zLeft) + 0.1)
  })
  it('颜色是线性空间：白像素≈1、黑像素≈0', () => {
    const cloud = sampleCoverPoints(halfImage(), 200)
    const rs = Array.from({ length: 200 }, (_, i) => cloud.colors![i * 3])
    expect(Math.max(...rs)).toBeGreaterThan(0.95)
    expect(Math.min(...rs)).toBeLessThan(0.05)
  })
  it('非正方形图保纵横比：窄边坐标范围收缩', () => {
    const wide: PixelSource = { width: 32, height: 16, data: new Uint8ClampedArray(32 * 16 * 4).fill(255) }
    const cloud = sampleCoverPoints(wide, 500)
    const ys = Array.from({ length: 500 }, (_, i) => Math.abs(cloud.positions[i * 3 + 1]))
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.55) // 高是宽的一半 → |y| ≤ ~0.5
  })
  it('抖动是真伪随机而非短周期斜坡（防网格条纹/摩尔纹）', () => {
    const cloud = sampleCoverPoints(halfImage(), 1000)
    const cols = Math.ceil(Math.sqrt(1000))
    const cell = 2 / cols
    const offsets = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const frac = (((cloud.positions[i * 3] + 1) % cell) + cell) % cell / cell
      offsets.add(Math.round(frac * 1000))
    }
    expect(offsets.size).toBeGreaterThan(100) // 斜坡伪抖动只有 ~10 个离散值
  })
})
