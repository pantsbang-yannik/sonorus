// 歌词服务（spec §4）：回退链 lrclib → 网易云 + userData 正负文件缓存。
// fetch/now 可注入（单测不打真网络）；所有网络/解析失败静默降级，绝不抛错到调用方。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { LyricLine } from '../../src/scenes/nebula/lyrics/lrc'
import {
  lrclibUrl, parseLrclib, neteaseSearchUrl, parseNeteaseSearch, neteaseLyricUrl, parseNeteaseLyric
} from './providers'

export const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 3600 * 1000
export const FETCH_TIMEOUT_MS = 8000

/** 缓存文件名 = sha1(title\0artist).hex + .json——键与渲染层 track key 同构 */
export function cacheFileName(title: string, artist: string): string {
  return createHash('sha1').update(`${title}\0${artist}`).digest('hex') + '.json'
}

type CacheEntry = { lines: LyricLine[] } | { none: true; at: number }

export class LyricsService {
  constructor(
    private cacheDir: string,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now
  ) {}

  async lookup(title: string, artist: string, duration: number | null): Promise<LyricLine[] | null> {
    const file = join(this.cacheDir, cacheFileName(title, artist))
    const cached = this.readCache(file)
    if (cached) {
      if ('lines' in cached) return cached.lines
      if (this.now() - cached.at < NEGATIVE_CACHE_TTL_MS) return null
      // 负缓存过期 → 落穿重查
    }
    let lines = await this.tryLrclib(title, artist, duration)
    if (!lines) lines = await this.tryNetease(title, artist, duration)
    this.writeCache(file, lines ? { lines } : { none: true, at: this.now() })
    return lines
  }

  private async tryLrclib(title: string, artist: string, duration: number | null): Promise<LyricLine[] | null> {
    const json = await this.fetchJson(lrclibUrl(title, artist, duration))
    return json === null ? null : parseLrclib(json, duration)
  }

  private async tryNetease(title: string, artist: string, duration: number | null): Promise<LyricLine[] | null> {
    const search = await this.fetchJson(neteaseSearchUrl(title, artist))
    const id = search === null ? null : parseNeteaseSearch(search, duration)
    if (id === null) return null
    const lyric = await this.fetchJson(neteaseLyricUrl(id))
    return lyric === null ? null : parseNeteaseLyric(lyric)
  }

  /** 非 200 / 超时 / 网络异常 / 非 JSON → null（回退链下一环） */
  private async fetchJson(url: string): Promise<unknown | null> {
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  private readCache(file: string): CacheEntry | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      // 合法 JSON 但非对象（如原始字符串/数字）也算损坏——防 'lines' in 抛 TypeError
      if (typeof parsed !== 'object' || parsed === null) return null
      return parsed as CacheEntry
    } catch {
      return null // 不存在/损坏都当无缓存
    }
  }

  private writeCache(file: string, entry: CacheEntry): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true })
      writeFileSync(file, JSON.stringify(entry))
    } catch {
      // 缓存写失败不致命：下次重查而已
    }
  }
}
