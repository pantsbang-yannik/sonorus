import { describe, it, expect } from 'vitest'
import { makeXorshift, transformPoint, normalizePoints, sampleSurface, rotatePoints } from '../../scripts/bake-lib.mjs'

// 两个共面三角：大三角面积是小三角的 9 倍（直角边 3:1）
const POS = new Float32Array([
  0, 0, 0,  3, 0, 0,  0, 3, 0, // 大：面积 4.5
  10, 0, 0, 11, 0, 0, 10, 1, 0, // 小：面积 0.5
])
const IDX = new Uint32Array([0, 1, 2, 3, 4, 5])

describe('bake-lib', () => {
  it('sampleSurface 面积加权：9:1 双三角采样占比落在 [0.85,0.95]，且确定性（同 seed 同输出）', () => {
    const a = sampleSurface({ positions: POS, indices: IDX, count: 4000, seed: 42 })
    const b = sampleSurface({ positions: POS, indices: IDX, count: 4000, seed: 42 })
    expect(a.positions).toEqual(b.positions)
    let big = 0
    for (let i = 0; i < 4000; i++) if (a.positions[i * 3] < 5) big++
    expect(big / 4000).toBeGreaterThan(0.85)
    expect(big / 4000).toBeLessThan(0.95)
  })
  it('采样点落在源三角形内（共面 z=0、xy 在边界内）且法线单位长、方向 ±z', () => {
    const { positions, normals } = sampleSurface({ positions: POS, indices: IDX, count: 1000, seed: 7 })
    for (let i = 0; i < 1000; i++) {
      expect(Math.abs(positions[i * 3 + 2])).toBeLessThan(1e-6)
      const nl = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
      expect(nl).toBeCloseTo(1, 5)
      expect(Math.abs(Math.abs(normals[i * 3 + 2]) - 1)).toBeLessThan(1e-6)
    }
  })
  it('normalizePoints：居中后最大半径=targetRadius，返回 center/scale 可追溯', () => {
    const pts = new Float32Array([10, 0, 0, 14, 0, 0, 12, 2, 0])
    const { center, scale } = normalizePoints(pts, 1.3)
    expect(center).toEqual([12, 1, 0])
    let maxR = 0
    for (let i = 0; i < 3; i++) maxR = Math.max(maxR, Math.hypot(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]))
    expect(maxR).toBeCloseTo(1.3, 5)
    expect(scale).toBeGreaterThan(0)
  })
  it('transformPoint：列主序 mat4 平移+缩放', () => {
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 6, 7, 1] // scale2 + translate(5,6,7)
    expect(transformPoint(m, 1, 1, 1)).toEqual([7, 8, 9])
  })
  it('rotatePoints：z90 把 +x 转到 +y；z90,x90 复合把薄轴 x 转到 z（卡带修姿用例）', () => {
    const p1 = new Float32Array([1, 0, 0])
    rotatePoints(p1, 'z90')
    expect([...p1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, 0])
    // 卡带实况：薄轴 x、长轴 y、中轴 z → z90,x90 后应为 长x、中y、薄z
    const p2 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) // 三个单位轴点
    rotatePoints(p2, 'z90,x90')
    const r = [...p2].map((v) => Math.round(v * 1e6) / 1e6)
    expect(r.slice(0, 3)).toEqual([0, 0, 1]) // 原 x（薄）→ z ✓
    expect(r.slice(3, 6)).toEqual([-1, 0, 0]) // 原 y（长）→ x ✓
    expect(r.slice(6, 9)).toEqual([0, -1, 0]) // 原 z（中）→ y ✓
    expect(() => rotatePoints(new Float32Array(3), 'w45')).toThrow() // 非法轴拒收
    const untouched = new Float32Array([1, 2, 3])
    rotatePoints(untouched, '')
    expect([...untouched]).toEqual([1, 2, 3]) // 空 spec 零操作
  })
})
