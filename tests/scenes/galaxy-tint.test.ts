import { describe, it, expect } from 'vitest'
import { dominantTint } from '../../src/scenes/nebula/galaxy/tint'

describe('dominantTint', () => {
  it('纯色图 → 对应线性色相且亮度被抬到可视', () => {
    const img = { width: 2, height: 2, data: new Uint8ClampedArray([200, 40, 40, 255, 200, 40, 40, 255, 200, 40, 40, 255, 200, 40, 40, 255]) }
    const [r, g, b] = dominantTint(img)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
    expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(0.55)
  })
})
