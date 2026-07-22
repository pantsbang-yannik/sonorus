import { describe, it, expect } from 'vitest'
import { tagsFromMetadata, bytesToDataUrl } from '../../src/audio/track-tags'

const meta = (common: Record<string, unknown>, format: Record<string, unknown> = {}): Parameters<typeof tagsFromMetadata>[0] =>
  ({ common, format } as unknown as Parameters<typeof tagsFromMetadata>[0])

describe('tagsFromMetadata', () => {
  it('title+artist 齐全 → tagged，duration 透传', () => {
    const t = tagsFromMetadata(meta({ title: '晴天', artist: '周杰伦' }, { duration: 269.5 }))
    expect(t).toMatchObject({ title: '晴天', artist: '周杰伦', duration: 269.5, coverBytes: null, coverDataUrl: null })
  })

  it('缺 title / 缺 artist / 空白串 → null（无标签不进星系的源头门控）', () => {
    expect(tagsFromMetadata(meta({ artist: '周杰伦' }))).toBeNull()
    expect(tagsFromMetadata(meta({ title: '晴天' }))).toBeNull()
    expect(tagsFromMetadata(meta({ title: '  ', artist: '周杰伦' }))).toBeNull()
  })

  it('artist 缺失时用 artists[0] 兜底', () => {
    const t = tagsFromMetadata(meta({ title: '晴天', artists: ['周杰伦', '合唱者'] }))
    expect(t?.artist).toBe('周杰伦')
  })

  it('picture[0] → coverBytes/coverMime/coverDataUrl', () => {
    const data = new Uint8Array([72, 105])
    const t = tagsFromMetadata(meta({ title: 'a', artist: 'b', picture: [{ format: 'image/png', data }] }))
    expect(t?.coverBytes).toEqual(data)
    expect(t?.coverMime).toBe('image/png')
    expect(t?.coverDataUrl).toBe('data:image/png;base64,SGk=')
  })

  it('duration 非有限数 → null', () => {
    const t = tagsFromMetadata(meta({ title: 'a', artist: 'b' }, { duration: Infinity }))
    expect(t?.duration).toBeNull()
  })
})

describe('bytesToDataUrl', () => {
  it('小字节序列 → 正确 base64 data url', () => {
    expect(bytesToDataUrl(new Uint8Array([72, 105]), 'image/jpeg')).toBe('data:image/jpeg;base64,SGk=')
  })

  it('超过分块阈值(0x8000)的长序列不炸且前缀正确', () => {
    const big = new Uint8Array(0x8000 + 3)
    expect(bytesToDataUrl(big, 'image/png').startsWith('data:image/png;base64,')).toBe(true)
  })
})
