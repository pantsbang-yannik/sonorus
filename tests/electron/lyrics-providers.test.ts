import { describe, it, expect } from 'vitest'
import {
  lrclibUrl, parseLrclib, neteaseSearchUrl, parseNeteaseSearch, neteaseLyricUrl, parseNeteaseLyric
} from '../../electron/lyrics/providers'

const SYNCED = '[00:10.00]line one\n[00:20.00]line two'

describe('lrclib', () => {
  it('URL：有时长走 get 带 duration（取整），无时长走 search', () => {
    expect(lrclibUrl('晴天', '周杰伦', 269.7)).toBe(
      'https://lrclib.net/api/get?track_name=%E6%99%B4%E5%A4%A9&artist_name=%E5%91%A8%E6%9D%B0%E4%BC%A6&duration=270'
    )
    expect(lrclibUrl('a', 'b', null)).toContain('/api/search?')
  })
  it('get 单对象命中', () => {
    const lines = parseLrclib({ syncedLyrics: SYNCED, duration: 270 }, 269)
    expect(lines).toHaveLength(2)
    expect(lines![0]).toEqual({ t: 10, text: 'line one' })
  })
  it('时长差超 3s 弃用（防错版整首错位）', () => {
    expect(parseLrclib({ syncedLyrics: SYNCED, duration: 280 }, 269)).toBeNull()
  })
  it('search 数组取首个 synced 且时长匹配的候选', () => {
    const arr = [
      { syncedLyrics: '', duration: 269 },            // 无词
      { syncedLyrics: SYNCED, duration: 400 },        // 错版
      { syncedLyrics: SYNCED, duration: 270 }         // ✓
    ]
    expect(parseLrclib(arr, 269)).toHaveLength(2)
  })
  it('sysDuration 为 null 跳过时长校验；null/垃圾输入 → null', () => {
    expect(parseLrclib({ syncedLyrics: SYNCED, duration: 999 }, null)).toHaveLength(2)
    expect(parseLrclib(null, 269)).toBeNull()
    expect(parseLrclib({ plainLyrics: 'x' }, 269)).toBeNull()
  })
})

describe('netease', () => {
  it('search URL 编码关键词', () => {
    expect(neteaseSearchUrl('晴天', '周杰伦')).toBe(
      'https://music.163.com/api/search/get?s=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=5'
    )
  })
  it('search 解析：取首个时长匹配 id（毫秒→秒）', () => {
    const json = { result: { songs: [{ id: 1, duration: 400_000 }, { id: 2, duration: 269_500 }] } }
    expect(parseNeteaseSearch(json, 269)).toBe(2)
    expect(parseNeteaseSearch(json, null)).toBe(1) // 无系统时长取第一首
    expect(parseNeteaseSearch({ result: { songs: [] } }, 269)).toBeNull()
    expect(parseNeteaseSearch(null, 269)).toBeNull()
  })
  it('lyric URL + 解析；纯文本无标签 → null', () => {
    expect(neteaseLyricUrl(2)).toBe('https://music.163.com/api/song/lyric?id=2&lv=1')
    expect(parseNeteaseLyric({ lrc: { lyric: SYNCED } })).toHaveLength(2)
    expect(parseNeteaseLyric({ lrc: { lyric: '纯文本没有时间戳' } })).toBeNull()
    expect(parseNeteaseLyric({})).toBeNull()
  })
})
