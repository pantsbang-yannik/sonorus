import { describe, it, expect } from 'vitest'
import {
  starSize, starBrightness, buildStarInstances, computeDims,
  DIM_FACTOR, DEFAULT_TINT,
} from '../../src/scenes/nebula/galaxy/star-sprites'
import { starWeight } from '../../src/scenes/nebula/galaxy/star-field'
import { layoutGalaxy } from '../../src/scenes/nebula/galaxy/layout'
import type { GalaxyStar } from '../../src/scenes/nebula/galaxy/types'

const star = (title: string, playCount: number, tint: [number, number, number] | null = [0.8, 0.3, 0.2]): GalaxyStar => ({
  key: `${title}\0a`, title, artist: 'a', playCount, totalListenedSeconds: playCount * 60,
  firstAt: '2026-07-14T00:00:00.000Z', lastAt: '2026-07-15T00:00:00.000Z',
  days: [{ date: '2026-07-14', count: playCount, seconds: playCount * 60 }], artworkKey: null, tint,
})

describe('starSize / starBrightness', () => {
  it('随权重单调增', () => {
    expect(starSize(starWeight(10))).toBeGreaterThan(starSize(starWeight(1)))
    expect(starBrightness(starWeight(10))).toBeGreaterThan(starBrightness(starWeight(1)))
  })
  it('亮度封顶 1、下限为正（1 次也得看得见）', () => {
    expect(starBrightness(starWeight(100000))).toBeLessThanOrEqual(1)
    expect(starBrightness(starWeight(1))).toBeGreaterThan(0.1)
  })
  it('明暗层次拉开：10次 vs 1次的亮度差 > 线性等比的 60%（非线性不塌平）', () => {
    const lo = starBrightness(starWeight(1))
    const hi = starBrightness(starWeight(10))
    expect(hi / lo).toBeGreaterThan(1.3)
  })
})

describe('buildStarInstances', () => {
  it('位置=布局点位透传，长度与星数一致', () => {
    const stars = [star('A', 1), star('B', 5)]
    const placements = layoutGalaxy(stars.map((s) => s.key))
    const inst = buildStarInstances(stars, placements)
    expect(inst.positions.length).toBe(6)
    expect(inst.colors.length).toBe(6)
    expect(inst.sizes.length).toBe(2)
    expect(inst.positions[0]).toBeCloseTo(placements[0].x)
    expect(inst.positions[4]).toBeCloseTo(placements[1].y)
  })
  it('无 tint 星用 DEFAULT_TINT；听得多的星颜色总量更大', () => {
    const stars = [star('A', 1, null), star('B', 30)]
    const inst = buildStarInstances(stars, layoutGalaxy(stars.map((s) => s.key)))
    const sumA = inst.colors[0] + inst.colors[1] + inst.colors[2]
    const sumB = inst.colors[3] + inst.colors[4] + inst.colors[5]
    expect(sumA).toBeGreaterThan(0)
    expect(inst.colors[2] / inst.colors[0]).toBeCloseTo(DEFAULT_TINT[2] / DEFAULT_TINT[0], 3)
    expect(sumB).toBeGreaterThan(sumA)
  })
})

describe('computeDims', () => {
  it('null=全亮；命中集之外按 DIM_FACTOR 调暗', () => {
    const stars = [star('A', 1), star('B', 1), star('C', 1)]
    expect(Array.from(computeDims(stars, null))).toEqual([1, 1, 1])
    const dims = computeDims(stars, new Set(['B\0a']))
    // computeDims 返回 Float32Array（T4 InstancedBufferAttribute 直接消费），
    // 0.12 在 float32 里量化为 0.11999999731779099——Math.fround 对齐这一量化，
    // 而非改动 DIM_FACTOR 本身或返回类型（两者均为签名锁死/亲验旋钮，brief 原样保留）
    expect(Array.from(dims)).toEqual([Math.fround(DIM_FACTOR), 1, Math.fround(DIM_FACTOR)])
    expect(DIM_FACTOR).toBeLessThan(0.3)
  })
})
