// 歌词源纯函数（spec §4）：URL 构造 + 响应解析，不发请求（service.ts 注入 fetch 编排）。
// 网易云是非官方接口：结构不符一律返回 null，由 service 静默降级，不得抛错。
import { parseLrc, type LyricLine } from '../../src/scenes/nebula/lyrics/lrc'

/** 系统时长与歌词源时长差超此值视为版本不符（防错版整首错位，spec §4） */
export const DURATION_TOLERANCE_SEC = 3

export function lrclibUrl(title: string, artist: string, duration: number | null): string {
  const q = `track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
  return duration !== null
    ? `https://lrclib.net/api/get?${q}&duration=${Math.round(duration)}`
    : `https://lrclib.net/api/search?${q}`
}

function durationOk(dur: unknown, sysDuration: number | null): boolean {
  if (sysDuration === null) return true
  if (typeof dur !== 'number' || !Number.isFinite(dur)) return true // 源未给时长不据此否决
  return Math.abs(dur - sysDuration) <= DURATION_TOLERANCE_SEC
}

export function parseLrclib(json: unknown, sysDuration: number | null): LyricLine[] | null {
  const candidates = Array.isArray(json) ? json : [json]
  for (const c of candidates) {
    if (typeof c !== 'object' || c === null) continue
    const r = c as Record<string, unknown>
    const synced = r['syncedLyrics']
    if (typeof synced !== 'string' || synced === '') continue
    if (!durationOk(r['duration'], sysDuration)) continue
    const lines = parseLrc(synced)
    if (lines.length > 0) return lines
  }
  return null
}

export function neteaseSearchUrl(title: string, artist: string): string {
  const kw = encodeURIComponent(`${title} ${artist}`.trim())
  return `https://music.163.com/api/search/get?s=${kw}&type=1&limit=5`
}

export function parseNeteaseSearch(json: unknown, sysDuration: number | null): number | null {
  if (typeof json !== 'object' || json === null) return null
  const songs = (json as { result?: { songs?: unknown } }).result?.songs
  if (!Array.isArray(songs)) return null
  for (const s of songs) {
    if (typeof s !== 'object' || s === null) continue
    const r = s as Record<string, unknown>
    if (typeof r['id'] !== 'number') continue
    const durSec = typeof r['duration'] === 'number' ? r['duration'] / 1000 : undefined // 网易毫秒
    if (!durationOk(durSec, sysDuration)) continue
    return r['id']
  }
  return null
}

export function neteaseLyricUrl(id: number): string {
  return `https://music.163.com/api/song/lyric?id=${id}&lv=1`
}

export function parseNeteaseLyric(json: unknown): LyricLine[] | null {
  if (typeof json !== 'object' || json === null) return null
  const lyric = (json as { lrc?: { lyric?: unknown } }).lrc?.lyric
  if (typeof lyric !== 'string' || lyric === '') return null
  const lines = parseLrc(lyric) // 纯文本歌词无时间标签 → 空数组 → null（只用 synced，spec §1）
  return lines.length > 0 ? lines : null
}
