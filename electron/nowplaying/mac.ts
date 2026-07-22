import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { parsePlaybackProgress, type PlaybackProgress } from './progress'
import type { TrackEvent, TrackMeta } from './types'

/**
 * macOS「正在播放」通道（M0 spike 验证过的层①实现）。
 *
 * 内部 spawn `media-control stream --no-diff`（Homebrew: `brew install media-control`，
 * ungive 出品，封装 ungive/mediaremote-adapter 的 Apple 签名宿主方案），
 * 逐行读取 JSONL 推送。macOS 26.5.2 arm64 真机验证通过。
 *
 * 事件语义：
 * - 有会话且 title 非空 → `{ kind: 'change', meta }`（按 title|artist|有无封面 去重）
 * - 无会话 / payload 为空 / 子进程挂掉 → `{ kind: 'unknown' }`（去重，只发一次）
 * - 封面异步晚到：同一首歌会先发无封面 change，封面就绪后再补发一次带封面 change
 * - 子进程意外退出后自动重拉（5s 起指数退避，封顶 60s），直到调用返回的停止函数
 * - 二进制不存在（ENOENT，如未装 Homebrew）→ 发一次 unknown 后放弃重试
 *   （元数据是增强功能，缺失不应空转耗电）
 */

const INITIAL_RESTART_DELAY_MS = 5000
const MAX_RESTART_DELAY_MS = 60000

/** Electron GUI 进程的 PATH 通常不含 Homebrew 目录，按绝对路径优先解析。
 * 打包环境：extraResources 把 vendor/media-control 装进 Resources/media-control/，
 * 开发环境 process.resourcesPath 指向 electron 发行目录，该候选不存在自然落空。 */
export function resolveBinary(): string {
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    process.env.SONORUS_MEDIA_CONTROL,
    res ? join(res, 'media-control', 'bin', 'media-control') : undefined,
    '/opt/homebrew/bin/media-control', // Apple Silicon Homebrew
    '/usr/local/bin/media-control', // Intel Homebrew
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return 'media-control' // 兜底走 PATH；ENOENT 时发一次 unknown 并放弃
}

export function startMacNowPlaying(
  onEvent: (e: TrackEvent) => void,
  onProgress?: (p: PlaybackProgress) => void
): () => void {
  let stopped = false
  let child: ChildProcess | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let restartDelay = INITIAL_RESTART_DELAY_MS
  // 去重键：'unknown' 或 `${title}\0${artist}\0${是否有封面}`；null = 尚未发过事件
  let lastKey: string | null = null

  function emitUnknown(): void {
    if (lastKey === 'unknown') return
    lastKey = 'unknown'
    onEvent({ kind: 'unknown' })
  }

  function emitPayload(p: Record<string, unknown>): void {
    const title = p['title']
    if (typeof title !== 'string' || title === '') {
      emitUnknown()
      return
    }
    if (onProgress) {
      const prog = parsePlaybackProgress(p, Date.now())
      if (prog) onProgress(prog)
    }
    const artist = typeof p['artist'] === 'string' ? p['artist'] : ''
    const durationRaw = p['duration']
    const duration =
      typeof durationRaw === 'number' && Number.isFinite(durationRaw) && durationRaw > 0
        ? durationRaw
        : null
    const artworkB64 = p['artworkData']
    const artworkPng =
      typeof artworkB64 === 'string' && artworkB64.length > 0
        ? Buffer.from(artworkB64, 'base64')
        : null
    const artworkMime = typeof p['artworkMimeType'] === 'string' ? p['artworkMimeType'] : null
    const key = `${title}\0${artist}\0${artworkPng ? 1 : 0}`
    if (key === lastKey) return
    lastKey = key
    const meta: TrackMeta = { title, artist, artworkPng, artworkMime, duration }
    onEvent({ kind: 'change', meta })
  }

  function handleLine(line: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return // 忽略非 JSON 行
    }
    if (typeof msg !== 'object' || msg === null) return
    const { type, payload } = msg as { type?: unknown; payload?: unknown }
    if (type !== 'data') return
    if (typeof payload === 'object' && payload !== null) {
      emitPayload(payload as Record<string, unknown>)
    } else {
      emitUnknown() // payload 为 null = 当前无媒体会话
    }
  }

  function spawnStream(): void {
    if (stopped) return
    // --no-diff：每次推送都是全量快照，避免 diff 模式下自行合并状态
    const proc = spawn(resolveBinary(), ['stream', '--no-diff'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    child = proc

    // StringDecoder 缓存跨 chunk 的多字节 UTF-8 尾部（CJK 歌名跨 data 事件不乱码）
    const decoder = new StringDecoder('utf8')
    let buf = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return // stop() 之后残留缓冲不再产生事件
      buf += decoder.write(chunk)
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) {
          restartDelay = INITIAL_RESTART_DELAY_MS // 流健康即重置退避
          handleLine(line)
        }
      }
    })

    let gone = false
    const onGone = (err?: unknown) => {
      if (gone || stopped) return
      gone = true
      child = null
      emitUnknown()
      // 二进制不存在（未装 media-control）属永久缺失：不再重试
      if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return
      restartTimer = setTimeout(spawnStream, restartDelay)
      restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS)
    }
    proc.on('error', onGone) // spawn 失败（含 ENOENT）
    proc.on('exit', () => onGone())
  }

  spawnStream()

  return () => {
    stopped = true
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (child) {
      child.kill('SIGTERM')
      child = null
    }
  }
}
