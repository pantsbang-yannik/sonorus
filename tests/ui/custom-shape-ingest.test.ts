import { describe, it, expect } from 'vitest'
import { isSupportedImage, needsConvert, ingestErrorText } from '../../src/ui/custom-shape-ingest'

describe('isSupportedImage（spec 边界：PDF/视频 → 只支持图片）', () => {
  it('png/jpg/webp/gif/heic 放行（mime 或扩展名任一命中）', () => {
    expect(isSupportedImage('a.png', 'image/png')).toBe(true)
    expect(isSupportedImage('b.JPG', '')).toBe(true)
    expect(isSupportedImage('c.heic', '')).toBe(true)
    expect(isSupportedImage('d', 'image/webp')).toBe(true)
  })
  it('pdf/mp4/未知 → 拒', () => {
    expect(isSupportedImage('a.pdf', 'application/pdf')).toBe(false)
    expect(isSupportedImage('b.mp4', 'video/mp4')).toBe(false)
    expect(isSupportedImage('c', '')).toBe(false)
  })
})

describe('needsConvert（Chromium 不解码 HEIC/HEIF → 走 sips）', () => {
  it('heic/heif → true；png/jpg → false', () => {
    expect(needsConvert('a.heic', '')).toBe(true)
    expect(needsConvert('b.heif', 'image/heif')).toBe(true)
    expect(needsConvert('c.png', 'image/png')).toBe(false)
  })
})

describe('ingestErrorText 文案闭环（每个失败态都有人话）', () => {
  it('四种失败态文案齐全且互异', () => {
    const texts = (['unsupported', 'dark', 'empty', 'failed'] as const).map(ingestErrorText)
    expect(new Set(texts).size).toBe(4)
    expect(texts[0]).toContain('图片')
  })
})
