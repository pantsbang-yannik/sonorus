// 本地播放历史载荷校验（V2）：渲染层 IPC 载荷 → TrackEvent。纯逻辑零 electron 依赖（先例 history.ts）。
// 只认「歌名+歌手都有」的载荷——"无标签不进星系"在主进程侧的纵深防线（渲染层不发是第一道）。
import type { TrackEvent } from './nowplaying/types'

export function localChangeEventFrom(p: unknown): TrackEvent | null {
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  const title = typeof r['title'] === 'string' ? r['title'].trim() : ''
  const artist = typeof r['artist'] === 'string' ? r['artist'].trim() : ''
  if (!title || !artist) return null
  const cover = r['coverBytes'] instanceof Uint8Array ? Buffer.from(r['coverBytes']) : null
  return {
    kind: 'change',
    meta: {
      title,
      artist,
      duration: typeof r['duration'] === 'number' && Number.isFinite(r['duration']) ? r['duration'] : null,
      artworkPng: cover,
      artworkMime: cover && typeof r['coverMime'] === 'string' ? r['coverMime'] : null
    }
  }
}
