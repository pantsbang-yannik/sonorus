import { describe, it, expect } from 'vitest'
import { sampleTitlePoints } from '../../src/scenes/nebula/title-points'
import type { PixelSource } from '../../src/scenes/nebula/cover-points'

/** 手工构造 PixelSource：给定亮像素坐标集合，其余全透明 */
function makeImg(w: number, h: number, lit: Array<[number, number]>): PixelSource {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of lit) {
    const o = (y * w + x) * 4
    data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = 255
  }
  return { width: w, height: h, data }
}

describe('sampleTitlePoints', () => {
  it('产出 count*3 长度的 positions，无 colors', () => {
    const img = makeImg(16, 8, [[4, 2], [8, 4], [12, 6]])
    const cloud = sampleTitlePoints(img, 100)
    expect(cloud).not.toBeNull()
    expect(cloud!.positions.length).toBe(300)
    expect(cloud!.colors).toBeUndefined()
  })

  it('坐标落在世界范围内：|x| ≤ worldWidth/2 + 亚像素余量，y 按纵横比，|z| ≤ depth/2', () => {
    const img = makeImg(16, 8, [[0, 0], [15, 7], [8, 4]])
    const cloud = sampleTitlePoints(img, 200, { worldWidth: 2.4, depth: 0.06 })!
    for (let i = 0; i < 200; i++) {
      const x = cloud.positions[i * 3], y = cloud.positions[i * 3 + 1], z = cloud.positions[i * 3 + 2]
      expect(Math.abs(x)).toBeLessThanOrEqual(1.2 + 2.4 / 16) // 半宽 + 1 像素抖动余量
      expect(Math.abs(y)).toBeLessThanOrEqual((1.2 + 2.4 / 16) * (8 / 16))
      expect(Math.abs(z)).toBeLessThanOrEqual(0.03)
    }
  })

  it('确定性：同图同 count 两次采样逐位相同', () => {
    const img = makeImg(16, 8, [[4, 2], [8, 4]])
    const a = sampleTitlePoints(img, 50)!
    const b = sampleTitlePoints(img, 50)!
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
  })

  it('点只落在亮像素附近：全部点距某个亮像素中心 ≤ 1.5 像素折算世界距离', () => {
    const img = makeImg(16, 8, [[4, 2]])
    const cloud = sampleTitlePoints(img, 30, { worldWidth: 1.6, depth: 0 })!
    const px = 1.6 / 16 // 1 像素的世界宽度
    // 唯一亮像素 (4,2) 的世界坐标：x=(4.5/16-0.5)*1.6, y=(0.5-2.5/8)*1.6*(8/16)
    const cx = (4.5 / 16 - 0.5) * 1.6
    const cy = (0.5 - 2.5 / 8) * 0.8
    for (let i = 0; i < 30; i++) {
      expect(Math.abs(cloud.positions[i * 3] - cx)).toBeLessThanOrEqual(px * 1.5)
      expect(Math.abs(cloud.positions[i * 3 + 1] - cy)).toBeLessThanOrEqual(px * 1.5)
    }
  })

  it('全透明图返回 null', () => {
    const img = makeImg(8, 8, [])
    expect(sampleTitlePoints(img, 10)).toBeNull()
  })
})
