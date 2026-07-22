// 播放历史纯逻辑（idea 批0：为星系图鉴攒数据）。纯 node 零 electron 依赖以便单测（先例 settings.ts）。
// 封面缩略的 nativeImage 薄壳在 main.ts 接线侧，本层只收 artworkKey。
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { TrackEvent } from './nowplaying/types'

/** 有效聆听 ≥30s 才算一次播放（业界惯例，免快切歌记垃圾） */
export const MIN_LISTEN_SECONDS = 30
/** unknown 宽限期（秒）：media-control 子进程崩溃/重启也会发 unknown（mac.ts onGone/ENOENT），
 * 不立即结算——宽限内同曲 change 回归则无缝续钟，免把一次聆听误拆两条。
 * 取 10s：必须盖过子进程重启链路（INITIAL_RESTART_DELAY_MS=5s + spawn + 首包），5s 数值上永远赶不上（双审①P3） */
export const UNKNOWN_GRACE_SECONDS = 10

export interface PlayRecord {
  title: string
  artist: string
  duration: number | null   // 秒，同 TrackMeta 语义
  listenedSeconds: number   // 有效聆听秒数（整数）
  endedAt: string           // ISO 时间戳（记录落盘时刻）
  artworkKey: string | null // 缩略封面文件名；无封面为 null
}

interface Session {
  title: string
  artist: string
  duration: number | null
  artworkKey: string | null
  accumulatedMs: number       // 已结算入账的有效聆听
  runningSince: number | null // 计时中的起点毫秒；null = 暂停（progress 暂停或 unknown 挂起）
  unknownAt: number | null    // unknown 挂起时刻；非 null 期间钟停走
}

/** 有效聆听钟：change 起表、progress playing 暂停/恢复、unknown 宽限、切歌/flush 结算。
 * 纯逻辑注入 now()，无定时器——宽限过期在下一个事件到达时惰性判定。 */
export class HistoryTracker {
  private readonly now: () => number
  private readonly onRecord: (r: PlayRecord) => void
  private session: Session | null = null
  private playing = true // 最近一次 progress 的 playing；初值 true=从未收到 progress 时按在播兜底（新曲起表沿用此值，见 onTrack）

  constructor(opts: { now: () => number; onRecord: (r: PlayRecord) => void }) {
    this.now = opts.now
    this.onRecord = opts.onRecord
  }

  onTrack(e: TrackEvent, artworkKey: string | null = null): void {
    if (e.kind === 'unknown') {
      this.suspend()
      return
    }
    const { title, artist, duration } = e.meta
    const s = this.session
    if (s && s.title === title && s.artist === artist) {
      if (artworkKey) s.artworkKey = artworkKey
      const graceExpired = s.unknownAt !== null && this.now() - s.unknownAt > UNKNOWN_GRACE_SECONDS * 1000
      if (!graceExpired) {
        // 同曲：封面晚到补发 / 宽限内回归——续钟不重置
        if (s.unknownAt !== null) {
          s.unknownAt = null
          if (this.playing) s.runningSince = this.now()
        }
        return
      }
      // 宽限已过的同曲回归 = 新一次聆听：落穿到结算+重启
    }
    this.settle()
    // 新曲起表沿用当前 playing：mac.ts 同一载荷先发 onProgress 后发 change，此刻 playing 是刚刷新的真实态——
    // 硬置 true 会让"暂停中切歌"墙钟空跑虚增时长（双审①P2）。从未收到 progress 时初值 true 兜底
    this.session = { title, artist, duration, artworkKey, accumulatedMs: 0, runningSince: this.playing ? this.now() : null, unknownAt: null }
  }

  onProgress(playing: boolean): void {
    this.playing = playing
    const s = this.session
    if (!s || s.unknownAt !== null) return // unknown 挂起期钟已停，恢复交给同曲 change
    if (playing && s.runningSince === null) s.runningSince = this.now()
    else if (!playing && s.runningSince !== null) {
      s.accumulatedMs += this.now() - s.runningSince
      s.runningSince = null
    }
  }

  /** 退出前结算当前曲目（before-quit 挂载） */
  flush(): void {
    this.settle()
  }

  /** unknown：停钟挂起，不立即结算（宽限语义见常量注释） */
  private suspend(): void {
    const s = this.session
    if (!s || s.unknownAt !== null) return
    if (s.runningSince !== null) {
      s.accumulatedMs += this.now() - s.runningSince
      s.runningSince = null
    }
    s.unknownAt = this.now()
  }

  private settle(): void {
    const s = this.session
    if (!s) return
    this.session = null
    const totalMs = s.accumulatedMs + (s.runningSince !== null ? this.now() - s.runningSince : 0)
    if (totalMs < MIN_LISTEN_SECONDS * 1000) return
    this.onRecord({
      title: s.title,
      artist: s.artist,
      duration: s.duration,
      listenedSeconds: Math.round(totalMs / 1000),
      endedAt: new Date(this.now()).toISOString(),
      artworkKey: s.artworkKey
    })
  }
}

/** 缩略封面文件名：按歌去重的稳定键（sha1(title\0artist)，键法同歌词 key 惯例） */
export function artworkKeyFor(title: string, artist: string): string {
  return `${createHash('sha1').update(`${title}\0${artist}`).digest('hex')}.jpg`
}

export function appendPlayRecord(file: string, r: PlayRecord): void {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(r) + '\n')
}

/** 逐行解析，坏行/缺关键字段跳过不炸（settings.ts 坏数据回默认哲学同源） */
export function readPlayRecords(file: string): PlayRecord[] {
  if (!existsSync(file)) return []
  const out: PlayRecord[] = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as Record<string, unknown>
      if (typeof r['title'] !== 'string' || typeof r['artist'] !== 'string') continue
      if (typeof r['listenedSeconds'] !== 'number' || typeof r['endedAt'] !== 'string') continue
      out.push({
        title: r['title'],
        artist: r['artist'],
        duration: typeof r['duration'] === 'number' ? r['duration'] : null,
        listenedSeconds: r['listenedSeconds'],
        endedAt: r['endedAt'],
        artworkKey: typeof r['artworkKey'] === 'string' ? r['artworkKey'] : null
      })
    } catch {
      // 坏行跳过
    }
  }
  return out
}

/** history:artwork 路径守卫（纵深，同 poster:reveal 只放行下载夹哲学）：
 * 只放行 `<sha1 hex 40 位>.jpg` 形状的键，其余一律 null——渲染层传任意路径也翻不出 artwork 目录 */
export function safeArtworkPath(dir: string, key: string): string | null {
  return /^[0-9a-f]{40}\.jpg$/.test(key) ? join(dir, key) : null
}
