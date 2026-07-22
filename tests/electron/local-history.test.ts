import { describe, it, expect } from 'vitest'
import { localChangeEventFrom } from '../../electron/local-history'

describe('localChangeEventFrom', () => {
  it('合法载荷 → change 事件，封面转 Buffer', () => {
    const ev = localChangeEventFrom({ title: '晴天', artist: '周杰伦', duration: 269.5, coverBytes: new Uint8Array([1, 2]), coverMime: 'image/png' })
    expect(ev).not.toBeNull()
    if (ev?.kind !== 'change') throw new Error('应为 change')
    expect(ev.meta.title).toBe('晴天')
    expect(ev.meta.artist).toBe('周杰伦')
    expect(ev.meta.duration).toBe(269.5)
    expect(Buffer.isBuffer(ev.meta.artworkPng)).toBe(true)
    expect(ev.meta.artworkMime).toBe('image/png')
  })

  it('title/artist 缺失或空白 → null（无标签不进星系的主进程侧纵深）', () => {
    expect(localChangeEventFrom({ artist: 'b' })).toBeNull()
    expect(localChangeEventFrom({ title: 'a' })).toBeNull()
    expect(localChangeEventFrom({ title: ' ', artist: 'b' })).toBeNull()
  })

  it('非对象 / null → null', () => {
    expect(localChangeEventFrom(null)).toBeNull()
    expect(localChangeEventFrom('x')).toBeNull()
  })

  it('duration 非有限数 → null 字段；coverBytes 非 Uint8Array → artworkPng null', () => {
    const ev = localChangeEventFrom({ title: 'a', artist: 'b', duration: 'x', coverBytes: 'nope' })
    if (ev?.kind !== 'change') throw new Error('应为 change')
    expect(ev.meta.duration).toBeNull()
    expect(ev.meta.artworkPng).toBeNull()
    expect(ev.meta.artworkMime).toBeNull()
  })
})
