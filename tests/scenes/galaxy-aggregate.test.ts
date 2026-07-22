import { describe, it, expect } from 'vitest'
import { aggregateStars, localDateOf } from '../../src/scenes/nebula/galaxy/aggregate'
import type { GalaxyPlayRecord } from '../../src/scenes/nebula/galaxy/types'

// 时区去敏（评审 P2）：用「本地正午±」构造 ISO——断言在任何本机时区都成立（同 T4 filter 测试口径）
const atLocal = (date: string, hour = 12): string => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
const rec = (p: Partial<GalaxyPlayRecord>): GalaxyPlayRecord => ({
  title: 't', artist: 'a', duration: null, listenedSeconds: 60,
  endedAt: atLocal('2026-07-15'), artworkKey: null, ...p
})

describe('aggregateStars', () => {
  it('同歌归并：次数/累计时长/首末时间/days 按天聚合', () => {
    const stars = aggregateStars([
      rec({ endedAt: atLocal('2026-07-14', 10), listenedSeconds: 40 }),
      rec({ endedAt: atLocal('2026-07-14', 11), listenedSeconds: 50 }),
      rec({ endedAt: atLocal('2026-07-15', 11), listenedSeconds: 30 }),
    ])
    expect(stars).toHaveLength(1)
    const s = stars[0]
    expect(s.key).toBe('t\0a')
    expect(s.playCount).toBe(3)
    expect(s.totalListenedSeconds).toBe(120)
    expect(s.firstAt).toBe(atLocal('2026-07-14', 10))
    expect(s.lastAt).toBe(atLocal('2026-07-15', 11))
    expect(s.days.map((d) => d.count)).toEqual([2, 1])
    expect(s.days[0].seconds).toBe(90)
    expect(s.tint).toBeNull()
  })
  it('输出按 firstAt 升序（布局 rank 序）', () => {
    const stars = aggregateStars([
      rec({ title: 'B', endedAt: atLocal('2026-07-15') }),
      rec({ title: 'A', endedAt: atLocal('2026-07-14') }),
    ])
    expect(stars.map((s) => s.title)).toEqual(['A', 'B'])
  })
  it('artworkKey 取首个非空；空 title 防御性跳过', () => {
    const stars = aggregateStars([
      rec({ artworkKey: null }),
      rec({ artworkKey: 'k.jpg' }),
      rec({ title: '' }),
      rec({ title: '   ' }),
    ])
    expect(stars).toHaveLength(1)
    expect(stars[0].artworkKey).toBe('k.jpg')
  })
  it('乱序输入不影响归并结果（days 仍升序）', () => {
    const stars = aggregateStars([
      rec({ endedAt: atLocal('2026-07-15') }),
      rec({ endedAt: atLocal('2026-07-13') }),
    ])
    expect(stars[0].days.map((d) => d.date)).toEqual([...stars[0].days.map((d) => d.date)].sort())
    expect(stars[0].firstAt).toBe(atLocal('2026-07-13'))
  })
})

describe('localDateOf', () => {
  it('产出 YYYY-MM-DD（本地时区，长度恒 10）', () => {
    expect(localDateOf('2026-07-15T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
