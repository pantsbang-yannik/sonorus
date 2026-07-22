import { describe, it, expect } from 'vitest'
import {
  bakeGalaxyCloud, starWeight, DUST_NEAR_STAR_SHARE, DUST_NEAR_SIGMA,
} from '../../src/scenes/nebula/galaxy/star-field'
import { layoutGalaxy, galaxyRadius, DISK_THICKNESS } from '../../src/scenes/nebula/galaxy/layout'
import type { GalaxyStar } from '../../src/scenes/nebula/galaxy/types'

const star = (title: string, playCount: number, tint: [number, number, number] | null = [0.8, 0.3, 0.2]): GalaxyStar => ({
  key: `${title}\0a`, title, artist: 'a', playCount, totalListenedSeconds: playCount * 60,
  firstAt: '2026-07-14T00:00:00.000Z', lastAt: '2026-07-15T00:00:00.000Z',
  days: [{ date: '2026-07-14', count: playCount, seconds: playCount * 60 }], artworkKey: null, tint,
})
const bake = (stars: GalaxyStar[], count = 8000) =>
  bakeGalaxyCloud(stars, layoutGalaxy(stars.map((s) => s.key)), count)

describe('starWeight', () => {
  it('对数刻度：1次=1，8次=4，垃圾输入不炸', () => {
    expect(starWeight(1)).toBe(1)
    expect(starWeight(8)).toBe(4)
    expect(starWeight(0)).toBe(1)
  })
})

describe('bakeGalaxyCloud（星尘旋臂语义）', () => {
  it('点云长度恰=count*3，颜色同长，centers 与星一一对应', () => {
    const { cloud, centers } = bake([star('A', 1), star('B', 5), star('C', 2)])
    expect(cloud.positions.length).toBe(8000 * 3)
    expect(cloud.colors!.length).toBe(8000 * 3)
    expect(centers.length).toBe(9)
  })
  it('确定性：同输入同输出', () => {
    expect(bake([star('A', 3)])).toEqual(bake([star('A', 3)]))
  })
  it('薄盘：至少 90% 粒子 |y| < 0.15，且全部 |y| < 0.8', () => {
    const { cloud } = bake([star('A', 2), star('B', 9)])
    let thin = 0
    let maxAbs = 0
    for (let i = 0; i < 8000; i++) {
      const y = Math.abs(cloud.positions[i * 3 + 1])
      if (y < 0.15) thin++
      maxAbs = Math.max(maxAbs, y)
    }
    expect(thin / 8000).toBeGreaterThan(0.9)
    expect(maxAbs).toBeLessThan(0.8)
  })
  it('星旁加密：每颗星 3σ 邻域内的粒子数显著高于均匀铺（星嵌在雾里）', () => {
    const stars = [star('A', 1), star('B', 1)]
    const { cloud, centers } = bake(stars, 8000)
    const r = 3 * DUST_NEAR_SIGMA
    let near = 0
    for (let i = 0; i < 8000; i++) {
      for (let s = 0; s < 2; s++) {
        const dx = cloud.positions[i * 3] - centers[s * 3]
        const dy = cloud.positions[i * 3 + 1] - centers[s * 3 + 1]
        const dz = cloud.positions[i * 3 + 2] - centers[s * 3 + 2]
        if (dx * dx + dy * dy + dz * dz < r * r) { near++; break }
      }
    }
    // 加密份额 DUST_NEAR_STAR_SHARE 的粒子落在星旁；至少一半落进 3σ 球即算显著
    expect(near / 8000).toBeGreaterThan(DUST_NEAR_STAR_SHARE * 0.5)
  })
  it('星尘恒暗：所有颜色通道 < 0.35（尘埃永远暗于星本体）', () => {
    const { cloud } = bake([star('A', 40), star('B', 1)])
    expect(Math.max(...cloud.colors!)).toBeLessThan(0.35)
  })
  it('半径界：全部粒子水平半径 ≤ galaxyRadius + 1.0 散布余量', () => {
    const stars = Array.from({ length: 60 }, (_, i) => star(`S${i}`, 1 + (i % 7)))
    const { cloud } = bake(stars, 8000)
    const bound = galaxyRadius(60) + 1.0
    for (let i = 0; i < 8000; i++) {
      const x = cloud.positions[i * 3]
      const z = cloud.positions[i * 3 + 2]
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(bound)
    }
  })
  it('0 星空态：铺默认小盘，位置非全零、颜色非全零', () => {
    const { cloud, centers } = bake([], 2000)
    expect(centers.length).toBe(0)
    expect(cloud.positions.some((v) => v !== 0)).toBe(true)
    expect(cloud.colors!.some((v) => v !== 0)).toBe(true)
  })
  it('薄盘常量引用一致（防 layout 改动后此处失联）', () => {
    expect(DISK_THICKNESS).toBeGreaterThan(0)
  })
})
