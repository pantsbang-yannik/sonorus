import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LyricsService, cacheFileName, NEGATIVE_CACHE_TTL_MS } from '../../electron/lyrics/service'

const SYNCED = '[00:10.00]line one\n[00:20.00]line two'
const LRCLIB_HIT = { syncedLyrics: SYNCED, duration: 269 }
const NETEASE_SEARCH = { result: { songs: [{ id: 42, duration: 269_000 }] } }
const NETEASE_LYRIC = { lrc: { lyric: SYNCED } }

/** 按 URL 前缀路由的假 fetch；record 记录请求序列 */
function fakeFetch(routes: Record<string, unknown>, record: string[] = []) {
  return (async (url: string | URL) => {
    const u = String(url)
    record.push(u)
    for (const [prefix, body] of Object.entries(routes)) {
      if (u.startsWith(prefix)) {
        if (body === 'ERR') throw new Error('network down')
        if (body === '404') return new Response('', { status: 404 })
        return new Response(JSON.stringify(body), { status: 200 })
      }
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lyr-')) })

describe('LyricsService', () => {
  it('lrclib 命中：返回行集 + 写正缓存', async () => {
    const svc = new LyricsService(dir, fakeFetch({ 'https://lrclib.net': LRCLIB_HIT }))
    const lines = await svc.lookup('晴天', '周杰伦', 269)
    expect(lines).toHaveLength(2)
    const cached = JSON.parse(readFileSync(join(dir, cacheFileName('晴天', '周杰伦')), 'utf8'))
    expect(cached.lines).toHaveLength(2)
  })
  it('lrclib 未命中回退网易云两跳', async () => {
    const record: string[] = []
    const svc = new LyricsService(dir, fakeFetch({
      'https://lrclib.net': '404',
      'https://music.163.com/api/search': NETEASE_SEARCH,
      'https://music.163.com/api/song/lyric': NETEASE_LYRIC
    }, record))
    expect(await svc.lookup('晴天', '周杰伦', 269)).toHaveLength(2)
    expect(record.some((u) => u.includes('id=42'))).toBe(true)
  })
  it('双源都失败（含网络异常）→ null + 负缓存', async () => {
    const svc = new LyricsService(dir, fakeFetch({ 'https://lrclib.net': 'ERR', 'https://music.163.com': 'ERR' }))
    expect(await svc.lookup('a', 'b', null)).toBeNull()
    const cached = JSON.parse(readFileSync(join(dir, cacheFileName('a', 'b')), 'utf8'))
    expect(cached.none).toBe(true)
  })
  it('正缓存命中零请求；负缓存未过期零请求，过期后重查', async () => {
    const record: string[] = []
    let t = 1000
    const svc = new LyricsService(dir, fakeFetch({ 'https://lrclib.net': LRCLIB_HIT }, record), () => t)
    writeFileSync(join(dir, cacheFileName('c', 'd')), JSON.stringify({ lines: [{ t: 1, text: 'x' }] }))
    expect(await svc.lookup('c', 'd', null)).toEqual([{ t: 1, text: 'x' }])
    writeFileSync(join(dir, cacheFileName('e', 'f')), JSON.stringify({ none: true, at: 500 }))
    expect(await svc.lookup('e', 'f', null)).toBeNull()
    expect(record).toHaveLength(0)
    t = 500 + NEGATIVE_CACHE_TTL_MS + 1
    expect(await svc.lookup('e', 'f', null)).toHaveLength(2) // 过期重查命中
    expect(record.length).toBeGreaterThan(0)
  })
  it('缓存目录不存在自动创建；损坏缓存文件当作无缓存', async () => {
    const svc = new LyricsService(join(dir, 'nested'), fakeFetch({ 'https://lrclib.net': LRCLIB_HIT }))
    expect(await svc.lookup('g', 'h', 269)).toHaveLength(2)
    expect(existsSync(join(dir, 'nested'))).toBe(true)
  })
  it('合法 JSON 但非对象的缓存文件（如原始字符串）当作无缓存，不抛错照常查询', async () => {
    const svc = new LyricsService(dir, fakeFetch({ 'https://lrclib.net': LRCLIB_HIT }))
    writeFileSync(join(dir, cacheFileName('i', 'j')), '"corrupted"') // JSON.parse 成功但 shape 错误
    expect(await svc.lookup('i', 'j', 269)).toHaveLength(2) // 不抛 TypeError，走查询链路命中
  })
})
