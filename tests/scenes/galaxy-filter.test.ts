import { describe, it, expect } from 'vitest'
import { buildFilterView, anniversaryFor, shiftDate } from '../../src/scenes/nebula/galaxy/filter'
import { localDateOf } from '../../src/scenes/nebula/galaxy/aggregate'
import type { GalaxyPlayRecord } from '../../src/scenes/nebula/galaxy/types'

// 用本地时区正午构造 ISO，避开日界线歧义
const atLocal = (date: string, hour = 12): string => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
const rec = (title: string, date: string, seconds = 60, hour = 12): GalaxyPlayRecord => ({
  title, artist: 'a', duration: null, listenedSeconds: seconds, endedAt: atLocal(date, hour), artworkKey: null
})

describe('shiftDate', () => {
  it('跨月/跨年进退位正确', () => {
    expect(shiftDate('2026-07-17', -6)).toBe('2026-07-11')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('buildFilterView', () => {
  const records = [rec('A', '2026-07-10'), rec('B', '2026-07-16', 60, 9), rec('A', '2026-07-16', 60, 10), rec('A', '2026-07-16', 60, 11)]
  it("kind 'all' → null（无筛选态）", () => {
    expect(buildFilterView(records, { kind: 'all' }, '2026-07-17')).toBeNull()
  })
  it('range 7 天：today 往前 6 天含当天', () => {
    const v = buildFilterView(records, { kind: 'range', days: 7 }, '2026-07-17')!
    expect(v.activeKeys.sort()).toEqual(['A\0a', 'B\0a'])
    expect(v.trailKeys).toEqual(['B\0a', 'A\0a']) // 相邻重复折叠：B, A, A → B, A
  })
  it('range 边界：恰好第 7 天前的记录不命中', () => {
    const v = buildFilterView([rec('A', '2026-07-10')], { kind: 'range', days: 7 }, '2026-07-17')!
    expect(v.activeKeys).toEqual([])
  })
  it("day：只取那一天，trail 按时间升序", () => {
    const v = buildFilterView(records, { kind: 'day', date: '2026-07-16' }, '2026-07-17')!
    expect(v.activeKeys.sort()).toEqual(['A\0a', 'B\0a'])
    expect(v.trailKeys[0]).toBe('B\0a')
  })
})

describe('anniversaryFor', () => {
  const now = new Date('2026-07-17T12:00:00')
  it('去年今天有记录 → 命中年，取当天聆听最久的歌', () => {
    const a = anniversaryFor([rec('X', '2025-07-17', 30), rec('Y', '2025-07-17', 300), rec('Y', '2026-06-17', 999)], now)!
    expect(a.label).toContain('去年')
    expect(a.title).toBe('Y')
    expect(a.date).toBe('2025-07-17')
  })
  it('无年命中但上月今天有 → 命中月', () => {
    const a = anniversaryFor([rec('Z', '2026-06-17')], now)!
    expect(a.label).toContain('上'); expect(a.date).toBe('2026-06-17')
  })
  it('两者皆无 → null（静默不打扰）', () => {
    expect(anniversaryFor([rec('Z', '2026-07-10')], now)).toBeNull()
  })
})
