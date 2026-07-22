import { describe, it, expect } from 'vitest'
import { resolveShapeAssetPath, parseShapeAssetMeta, resolveShapeMetaPath } from '../../electron/shape-assets'

describe('shape 资产路径守卫', () => {
  it('白名单 id → assets/shapes/<id>.bin；任意其他串（含路径穿越）一律抛错', () => {
    expect(resolveShapeAssetPath('heart', '/app')).toBe('/app/assets/shapes/heart.bin')
    expect(resolveShapeAssetPath('demo-mic', '/app')).toBe('/app/assets/shapes/demo-mic.bin')
    for (const bad of ['../../etc/passwd', 'heart.bin', '', 'HEART', 'nebula', 'statue']) { // statue 已退役=非法 id
      expect(() => resolveShapeAssetPath(bad, '/app')).toThrow()
    }
  })
})

describe('轮廓资产 meta 运行时校验（S2 终审 Minor-A 回账）', () => {
  const good = JSON.stringify({ version: 1, layout: 'pos3f32+norm3f32', count: 450000 })
  it('合法 meta 通过并返回解析结果', () => {
    expect(parseShapeAssetMeta(good, 'heart').count).toBe(450000)
  })
  it('version≠1 / layout 不符 / count 非正 → throw', () => {
    expect(() => parseShapeAssetMeta(JSON.stringify({ version: 2, layout: 'pos3f32+norm3f32', count: 1 }), 'heart')).toThrow()
    expect(() => parseShapeAssetMeta(JSON.stringify({ version: 1, layout: 'pos3f32', count: 1 }), 'heart')).toThrow()
    expect(() => parseShapeAssetMeta(JSON.stringify({ version: 1, layout: 'pos3f32+norm3f32', count: 0 }), 'heart')).toThrow()
  })
  it('meta 路径同 bin 白名单守卫：未知 id throw', () => {
    expect(resolveShapeMetaPath('heart', '/app')).toBe('/app/assets/shapes/heart.meta.json')
    expect(() => resolveShapeMetaPath('../evil', '/app')).toThrow()
  })
})
