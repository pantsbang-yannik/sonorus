// 聚合器（星系图鉴 spec §四）：PlayRecord[] → GalaxyStar[]。纯逻辑零 three 依赖，可单测。
import type { GalaxyPlayRecord, GalaxyStar, GalaxyDay } from './types'

/** ISO → 本地时区 YYYY-MM-DD（「一天」按用户本地日历切，不按 UTC） */
export function localDateOf(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function aggregateStars(records: GalaxyPlayRecord[]): GalaxyStar[] {
  const byKey = new Map<string, GalaxyStar & { dayMap: Map<string, GalaxyDay> }>()
  for (const r of records) {
    if (!r.title.trim()) continue // 防御：unknown 不落盘是批0保证，这里仍跳过空 title 行
    const key = `${r.title}\0${r.artist}`
    let s = byKey.get(key)
    if (!s) {
      s = {
        key, title: r.title, artist: r.artist, playCount: 0, totalListenedSeconds: 0,
        firstAt: r.endedAt, lastAt: r.endedAt, days: [], artworkKey: null, tint: null,
        dayMap: new Map(),
      }
      byKey.set(key, s)
    }
    s.playCount++
    s.totalListenedSeconds += r.listenedSeconds
    if (r.endedAt < s.firstAt) s.firstAt = r.endedAt
    if (r.endedAt > s.lastAt) s.lastAt = r.endedAt
    if (r.artworkKey && !s.artworkKey) s.artworkKey = r.artworkKey
    const date = localDateOf(r.endedAt)
    const day = s.dayMap.get(date) ?? { date, count: 0, seconds: 0 }
    day.count++
    day.seconds += r.listenedSeconds
    s.dayMap.set(date, day)
  }
  return [...byKey.values()]
    .map(({ dayMap, ...star }) => ({ ...star, days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
}
