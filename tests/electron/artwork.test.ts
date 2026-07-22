import { describe, it, expect } from 'vitest'
import { resolveArtworkMime } from '../../electron/nowplaying/artwork'

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const heicBytes = Buffer.from([0x00, 0x00, 0x00, 0x18]) // ftyp box，魔数与 JPEG/PNG 都不同

describe('resolveArtworkMime', () => {
  it('系统上报了合法 image/* MIME → 直接采信，不管魔数是什么', () => {
    expect(resolveArtworkMime(pngBytes, 'image/heic')).toBe('image/heic')
    expect(resolveArtworkMime(heicBytes, 'image/heic')).toBe('image/heic')
  })

  it('未上报（null）→ 按魔数兜底嗅探 JPEG/PNG', () => {
    expect(resolveArtworkMime(jpegBytes, null)).toBe('image/jpeg')
    expect(resolveArtworkMime(pngBytes, null)).toBe('image/png')
  })

  it('未上报且魔数是非 JPEG 的其它格式（如 HEIC）→ 兜底会误标成 PNG（已知局限，靠系统上报规避）', () => {
    expect(resolveArtworkMime(heicBytes, null)).toBe('image/png')
  })

  it('上报值格式不像 image/* → 视为无效，仍走魔数兜底', () => {
    expect(resolveArtworkMime(jpegBytes, '')).toBe('image/jpeg')
    expect(resolveArtworkMime(jpegBytes, 'garbage')).toBe('image/jpeg')
  })
})
