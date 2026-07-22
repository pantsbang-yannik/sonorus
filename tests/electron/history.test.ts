import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HistoryTracker,
  appendPlayRecord,
  readPlayRecords,
  artworkKeyFor,
  safeArtworkPath,
  MIN_LISTEN_SECONDS,
  UNKNOWN_GRACE_SECONDS,
  type PlayRecord
} from '../../electron/history'
import type { TrackEvent } from '../../electron/nowplaying/types'

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'sonorus-history-')), 'plays.jsonl')

const change = (title: string, artist = '歌手A', duration: number | null = 240): TrackEvent => ({
  kind: 'change',
  meta: { title, artist, artworkPng: null, artworkMime: null, duration }
})
const UNKNOWN: TrackEvent = { kind: 'unknown' }

/** 可控时钟 + 记录收集器的测试装置 */
function rig() {
  let t = 1_000_000 // 起始毫秒，非零防"0 即假"类错误
  const records: PlayRecord[] = []
  const tracker = new HistoryTracker({ now: () => t, onRecord: (r) => records.push(r) })
  return { tracker, records, tick: (sec: number) => { t += sec * 1000 } }
}

describe('HistoryTracker 有效聆听钟', () => {
  it('①聆听 29s 切歌：不记录（< MIN_LISTEN_SECONDS）', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(MIN_LISTEN_SECONDS - 1)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(0)
  })

  it('②聆听 30s 切歌：记录一条，字段完整', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里', '姚六一', 251))
    tick(MIN_LISTEN_SECONDS)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      title: '雾里',
      artist: '姚六一',
      duration: 251,
      listenedSeconds: MIN_LISTEN_SECONDS,
      artworkKey: null
    })
    expect(Date.parse(records[0].endedAt)).not.toBeNaN()
  })

  it('③暂停不计时：播 20s→暂停 100s→播 15s→切歌 = 有效 35s', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(20)
    tracker.onProgress(false)
    tick(100)
    tracker.onProgress(true)
    tick(15)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(1)
    expect(records[0].listenedSeconds).toBe(35)
  })

  it('④同曲二次 change（封面晚到）：不重置钟，只补 artworkKey', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(20)
    tracker.onTrack(change('雾里'), 'abc123.jpg') // 封面就绪的补发
    tick(15)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(1)
    expect(records[0].listenedSeconds).toBe(35)
    expect(records[0].artworkKey).toBe('abc123.jpg')
  })

  it('⑤unknown 宽限内同曲回归：续钟不结算，宽限间隙不计时', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(20)
    tracker.onTrack(UNKNOWN)
    tick(UNKNOWN_GRACE_SECONDS - 2) // 宽限内
    tracker.onTrack(change('雾里'))
    tick(15)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(1)
    expect(records[0].listenedSeconds).toBe(35)
  })

  it('⑥unknown 宽限过期后同曲 change：先结算旧段，再起新段', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(35)
    tracker.onTrack(UNKNOWN)
    tick(UNKNOWN_GRACE_SECONDS + 2) // 宽限已过
    tracker.onTrack(change('雾里')) // 同曲但视为新一次聆听
    expect(records).toHaveLength(1)
    expect(records[0].listenedSeconds).toBe(35)
    // 新段独立计时
    tick(40)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(2)
    expect(records[1].listenedSeconds).toBe(40)
  })

  it('⑦flush（退出）结算当前曲目', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(45)
    tracker.flush()
    expect(records).toHaveLength(1)
    expect(records[0].listenedSeconds).toBe(45)
    // flush 后再 flush 不重复结算
    tracker.flush()
    expect(records).toHaveLength(1)
  })

  it('unknown 后异曲 change：旧段按 unknown 时刻结算（宽限只保同曲续钟）', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(35)
    tracker.onTrack(UNKNOWN)
    tick(2)
    tracker.onTrack(change('海底'))
    expect(records).toHaveLength(1)
    expect(records[0].title).toBe('雾里')
    expect(records[0].listenedSeconds).toBe(35) // unknown 后的 2s 不计
  })

  it('暂停中切歌：新曲沿用暂停态，挂机时长不虚增（双审①P2）', () => {
    const { tracker, records, tick } = rig()
    tracker.onTrack(change('雾里'))
    tick(35)
    tracker.onProgress(false)
    tracker.onTrack(change('海底')) // 暂停中切歌（Music 切歌不自动播）
    tick(7200) // 挂机 2 小时
    tracker.onProgress(true)
    tick(40)
    tracker.onTrack(change('第三首'))
    expect(records).toHaveLength(2)
    expect(records[0].listenedSeconds).toBe(35)
    expect(records[1].listenedSeconds).toBe(40) // 挂机 7200s 不入账
  })

  it('无当前曲目时 progress/unknown/flush 均安全空转', () => {
    const { tracker, records } = rig()
    tracker.onProgress(true)
    tracker.onProgress(false)
    tracker.onTrack(UNKNOWN)
    tracker.flush()
    expect(records).toHaveLength(0)
  })
})

describe('JSONL 追加与坏行容错', () => {
  const record = (title: string): PlayRecord => ({
    title,
    artist: '歌手A',
    duration: 240,
    listenedSeconds: 60,
    endedAt: '2026-07-14T12:00:00.000Z',
    artworkKey: null
  })

  it('追加两条好行 + 手插一条坏行：读回两条', () => {
    const file = tmpFile()
    appendPlayRecord(file, record('雾里'))
    appendFileSync(file, '{broken json…\n')
    appendPlayRecord(file, record('海底'))
    const back = readPlayRecords(file)
    expect(back).toHaveLength(2)
    expect(back.map((r) => r.title)).toEqual(['雾里', '海底'])
  })

  it('文件不存在：读回空数组', () => {
    expect(readPlayRecords(join(tmpdir(), 'sonorus-none', 'nope.jsonl'))).toEqual([])
  })

  it('appendPlayRecord 自动建目录（mkdirSync recursive 惯例）', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sonorus-history-')), 'deep', 'plays.jsonl')
    appendPlayRecord(file, record('雾里'))
    expect(readFileSync(file, 'utf-8')).toContain('雾里')
  })

  it('缺关键字段的行被跳过（title 非字符串）', () => {
    const file = tmpFile()
    writeFileSync(file, JSON.stringify({ artist: 'x', listenedSeconds: 60 }) + '\n')
    appendPlayRecord(file, record('雾里'))
    expect(readPlayRecords(file)).toHaveLength(1)
  })
})

describe('artworkKeyFor', () => {
  it('同曲稳定、异曲不同、含扩展名', () => {
    const a = artworkKeyFor('雾里', '姚六一')
    expect(artworkKeyFor('雾里', '姚六一')).toBe(a)
    expect(artworkKeyFor('海底', '姚六一')).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{40}\.jpg$/)
  })
})

describe('safeArtworkPath（history:artwork 路径守卫）', () => {
  const dir = '/tmp/artwork'
  const hex40 = 'a'.repeat(40)
  it('放行 <hex40>.jpg', () => {
    expect(safeArtworkPath(dir, `${hex40}.jpg`)).toBe(join(dir, `${hex40}.jpg`))
  })
  it('拒绝路径穿越与异形键', () => {
    expect(safeArtworkPath(dir, '../plays.jsonl')).toBeNull()
    expect(safeArtworkPath(dir, `${hex40}.png`)).toBeNull()
    expect(safeArtworkPath(dir, '')).toBeNull()
    expect(safeArtworkPath(dir, `${'A'.repeat(40)}.jpg`)).toBeNull() // 只认小写 hex（sha1 hex digest 即小写）
  })
})
