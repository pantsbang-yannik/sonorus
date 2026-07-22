import { describe, it, expect } from 'vitest'
import { srgbToOklch, oklchToSrgb, extractDominant, remapToMood } from '../../src/scenes/shared/palette'
import type { PixelSource } from '../../src/scenes/nebula/cover-points'

function solidImage(r: number, g: number, b: number): PixelSource {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let i = 0; i < 64; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255 }
  return { width: 8, height: 8, data }
}

describe('OKLCH 变换', () => {
  it('白色 L≈1 C≈0；纯红 h≈29°', () => {
    const white = srgbToOklch({ r: 1, g: 1, b: 1 })
    expect(white.l).toBeCloseTo(1, 1)
    expect(white.c).toBeLessThan(0.02)
    const red = srgbToOklch({ r: 1, g: 0, b: 0 })
    expect(red.h).toBeGreaterThan(20)
    expect(red.h).toBeLessThan(40)
  })
  it('往返误差 < 0.02', () => {
    for (const rgb of [{ r: 0.8, g: 0.3, b: 0.1 }, { r: 0.1, g: 0.5, b: 0.9 }, { r: 0.5, g: 0.5, b: 0.5 }]) {
      const back = oklchToSrgb(srgbToOklch(rgb))
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(0.02)
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(0.02)
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(0.02)
    }
  })
})

describe('extractDominant', () => {
  it('纯色图提取出该色', () => {
    const d = extractDominant(solidImage(200, 40, 40))
    expect(d.r).toBeGreaterThan(d.g)
    expect(d.r).toBeGreaterThan(0.6)
  })
  it('深色背景 + 少量主题色 → 提取主题色而非背景（彩度加权）', () => {
    const w = 16, h = 16
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const red = i % 7 === 0 // ~14% 红色主题色，其余近黑背景（典型深底封面）
      data[i * 4] = red ? 220 : 25
      data[i * 4 + 1] = red ? 40 : 25
      data[i * 4 + 2] = red ? 40 : 28
      data[i * 4 + 3] = 255
    }
    const d = extractDominant({ width: w, height: h, data })
    expect(d.r).toBeGreaterThan(d.g * 2)
  })
  it('全图近黑（无可用色相）→ 回退默认冷色骨架而非灰色', () => {
    const d = extractDominant(solidImage(10, 10, 12))
    expect(d.b).toBeGreaterThan(d.r) // 默认冷色
  })
})

describe('remapToMood（调色台铁律）', () => {
  it('高饱和刺眼色被驯服：C≤0.13、L 进窗口、色相保留', () => {
    const p = remapToMood({ r: 1, g: 0, b: 0.05 })
    const prim = srgbToOklch(p.primary)
    expect(prim.c).toBeLessThanOrEqual(0.14)
    expect(prim.l).toBeGreaterThanOrEqual(0.5)
    expect(prim.l).toBeLessThanOrEqual(0.8)
    const src = srgbToOklch({ r: 1, g: 0, b: 0.05 })
    expect(Math.abs(prim.h - src.h)).toBeLessThan(20) // 色相倾向保留
  })
  it('三色系统明度分离：deep < primary < highlight', () => {
    const p = remapToMood({ r: 0.2, g: 0.5, b: 0.9 })
    expect(srgbToOklch(p.deep).l).toBeLessThan(srgbToOklch(p.primary).l)
    expect(srgbToOklch(p.highlight).l).toBeGreaterThan(srgbToOklch(p.primary).l)
  })
  it('灰度输入不产生 NaN，输出有效', () => {
    const p = remapToMood({ r: 0.5, g: 0.5, b: 0.5 })
    for (const c of [p.primary, p.deep, p.highlight]) {
      expect(Number.isFinite(c.r + c.g + c.b)).toBe(true)
    }
  })
})
