import { describe, it, expect } from 'vitest'
import { layoutGalaxy, galaxyRadius, LAYOUT_R0 } from '../../src/scenes/nebula/galaxy/layout'

const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => `song${i}\0artist${i}`)

describe('layoutGalaxy（时间星旋）', () => {
  it('确定性：同输入同输出', () => {
    expect(layoutGalaxy(keys(30))).toEqual(layoutGalaxy(keys(30)))
  })
  it('旧星永不挪窝：追加新星不改前面任何点位', () => {
    const before = layoutGalaxy(keys(10))
    const after = layoutGalaxy([...keys(10), 'new\0one'])
    expect(after.slice(0, 10)).toEqual(before)
  })
  it('半径随 rank 单调外扩（首星在核心附近，末星最远）', () => {
    const p = layoutGalaxy(keys(50))
    const r = (i: number): number => Math.hypot(p[i].x, p[i].z)
    expect(r(0)).toBeLessThan(LAYOUT_R0 + 0.15)
    expect(r(49)).toBeGreaterThan(r(0))
    expect(r(49)).toBeGreaterThan(r(25))
  })
  it('点位由 key 哈希抖动：同 rank 不同 key 点位不同', () => {
    const a = layoutGalaxy(['x\0x'])[0]
    const b = layoutGalaxy(['y\0y'])[0]
    expect(a).not.toEqual(b)
  })
  it('薄盘：|y| 有界', () => {
    for (const p of layoutGalaxy(keys(100))) expect(Math.abs(p.y)).toBeLessThan(0.25)
  })
  it('galaxyRadius 覆盖最外星且有下限（稀疏态相机基准用）', () => {
    const p = layoutGalaxy(keys(200))
    const maxR = Math.max(...p.map((q) => Math.hypot(q.x, q.z)))
    expect(galaxyRadius(200)).toBeGreaterThanOrEqual(maxR)
    expect(galaxyRadius(1)).toBeGreaterThanOrEqual(0.6)
  })
})
