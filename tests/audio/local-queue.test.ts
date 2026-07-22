import { describe, it, expect } from 'vitest'
import { LocalQueue } from '../../src/audio/local-queue'

const f = (name: string): File => new File(['x'], name, { type: 'audio/mpeg' })

describe('LocalQueue', () => {
  it('空队列 add：当前指到第一首新增，displayName 去扩展名', () => {
    const q = new LocalQueue()
    const added = q.add([f('a.mp3'), f('b.mp3')])
    expect(added.length).toBe(2)
    expect(q.size).toBe(2)
    expect(q.current?.displayName).toBe('a')
    expect(q.currentIndex).toBe(0)
    expect(q.current?.tag).toEqual({ kind: 'pending' })
  })

  it('非空队列 add 是追加：当前不动', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3')])
    q.add([f('b.mp3')])
    expect(q.size).toBe(2)
    expect(q.current?.displayName).toBe('a')
  })

  it('next/prev 手动切换永远回绕（与 loop 无关）', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3'), f('b.mp3'), f('c.mp3')])
    expect(q.next()?.displayName).toBe('b')
    expect(q.next()?.displayName).toBe('c')
    expect(q.next()?.displayName).toBe('a') // 尾部回绕
    expect(q.prev()?.displayName).toBe('c') // 头部回绕
  })

  it('advance 中段推进；尾部 loop 关 → null 且当前清空', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3'), f('b.mp3')])
    expect(q.advance()?.displayName).toBe('b')
    expect(q.advance()).toBeNull()
    expect(q.current).toBeNull()
  })

  it('advance 尾部 loop 开 → 回第一首', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3'), f('b.mp3')])
    q.setLoop(true)
    q.next() // 到 b（尾部）
    expect(q.advance()?.displayName).toBe('a')
  })

  it('jumpTo：存在则切换并返回，不存在返回 null 且当前不动', () => {
    const q = new LocalQueue()
    const [a, b] = q.add([f('a.mp3'), f('b.mp3')])
    expect(q.jumpTo(b!.id)?.displayName).toBe('b')
    expect(q.jumpTo(9999)).toBeNull()
    expect(q.current?.id).toBe(b!.id)
    void a
  })

  it('remove 非当前项：当前不动，removedCurrent=false', () => {
    const q = new LocalQueue()
    const [, b] = q.add([f('a.mp3'), f('b.mp3')])
    expect(q.remove(b!.id)).toEqual({ removedCurrent: false, next: null })
    expect(q.current?.displayName).toBe('a')
    expect(q.size).toBe(1)
  })

  it('remove 当前中段项：原位次的下一首顶上', () => {
    const q = new LocalQueue()
    const [a] = q.add([f('a.mp3'), f('b.mp3'), f('c.mp3')])
    const r = q.remove(a!.id)
    expect(r.removedCurrent).toBe(true)
    expect(r.next?.displayName).toBe('b')
    expect(q.current?.displayName).toBe('b')
  })

  it('remove 当前尾部项：接班回绕到第一首', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3'), f('b.mp3')])
    q.next() // 当前 b（尾部）
    const r = q.remove(q.current!.id)
    expect(r.next?.displayName).toBe('a')
  })

  it('remove 删到空：next=null，当前清空', () => {
    const q = new LocalQueue()
    const [a] = q.add([f('a.mp3')])
    expect(q.remove(a!.id)).toEqual({ removedCurrent: true, next: null })
    expect(q.current).toBeNull()
    expect(q.size).toBe(0)
  })

  it('setTag 更新指定项；未知 id 幂等无害', () => {
    const q = new LocalQueue()
    const [a] = q.add([f('a.mp3')])
    q.setTag(a!.id, { kind: 'none' })
    expect(q.tracks[0]!.tag).toEqual({ kind: 'none' })
    q.setTag(9999, { kind: 'none' }) // 不抛
  })

  it('clear 清空队列与当前', () => {
    const q = new LocalQueue()
    q.add([f('a.mp3')])
    q.clear()
    expect(q.size).toBe(0)
    expect(q.current).toBeNull()
  })
})
