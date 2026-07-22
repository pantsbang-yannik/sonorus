// 时间筛选 + 周年提醒（spec §八）：一套筛选机制两个玩法（星轨=区间、那一天=单日）。纯逻辑可单测。
import { localDateOf } from './aggregate'
import type { GalaxyPlayRecord, GalaxyFilter, GalaxyFilterView } from './types'

/** YYYY-MM-DD 本地日历加减天数（Date 构造用本地午间，避开 DST 日界歧义） */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function buildFilterView(records: GalaxyPlayRecord[], f: GalaxyFilter, today: string): GalaxyFilterView | null {
  if (f.kind === 'all') return null
  const from = f.kind === 'range' ? shiftDate(today, -(f.days - 1)) : f.date
  const to = f.kind === 'range' ? today : f.date
  const hits = records
    .filter((r) => { const d = localDateOf(r.endedAt); return d >= from && d <= to })
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
  const activeKeys = [...new Set(hits.map((r) => `${r.title}\0${r.artist}`))]
  const trailKeys: string[] = []
  for (const r of hits) {
    const k = `${r.title}\0${r.artist}`
    if (trailKeys[trailKeys.length - 1] !== k) trailKeys.push(k) // 相邻重复折叠（连听同一首不来回画轨）
  }
  return { activeKeys, trailKeys }
}

export interface Anniversary { date: string; label: string; title: string; artist: string }

/** 进入星系时调用一次：优先「去年今天」，其次「上月今天」；命中日取当天聆听最久的歌 */
export function anniversaryFor(records: GalaxyPlayRecord[], now: Date): Anniversary | null {
  const p = (n: number): string => String(n).padStart(2, '0')
  const probe = (y: number, m: number, d: number, label: string): Anniversary | null => {
    const date = `${y}-${p(m)}-${p(d)}`
    const best = new Map<string, { title: string; artist: string; seconds: number }>()
    for (const r of records) {
      if (localDateOf(r.endedAt) !== date) continue
      const k = `${r.title}\0${r.artist}`
      const e = best.get(k) ?? { title: r.title, artist: r.artist, seconds: 0 }
      e.seconds += r.listenedSeconds
      best.set(k, e)
    }
    if (best.size === 0) return null
    const top = [...best.values()].sort((a, b) => b.seconds - a.seconds)[0]
    return { date, label, title: top.title, artist: top.artist }
  }
  return probe(now.getFullYear() - 1, now.getMonth() + 1, now.getDate(), '去年今天')
    ?? probe(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
      now.getMonth() === 0 ? 12 : now.getMonth(), now.getDate(), '上个月的今天')
}
