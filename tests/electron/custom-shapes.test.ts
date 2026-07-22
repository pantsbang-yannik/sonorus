import { describe, it, expect } from 'vitest'
import { customShapePath } from '../../electron/custom-shapes'

const UID = '01234567-89ab-4cde-8f01-23456789abcd'

describe('customShapePath · uuid 白名单（IPC 入参不可信，shape-assets 同哲学）', () => {
  it('合法 uuid → <dir>/<id>.png', () => {
    expect(customShapePath('/data/custom-shapes', UID)).toBe(`/data/custom-shapes/${UID}.png`)
  })
  it('路径穿越/大写/任意串 → throw', () => {
    for (const bad of ['../evil', 'a/b', UID.toUpperCase(), 'x', '']) {
      expect(() => customShapePath('/d', bad)).toThrow()
    }
  })
})
