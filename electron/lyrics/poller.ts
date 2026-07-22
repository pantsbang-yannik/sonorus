// 进度轮询兜底（spec §3）：media-control stream 是事件驱动，长时间无事件会漂移——
// 歌词展示中每 5s 主动 get 一次校准。门控在 main.ts（仅 lyrics.enabled 且当前歌命中时运行）。
import { execFile } from 'node:child_process'
import { parsePlaybackProgress, type PlaybackProgress } from '../nowplaying/progress'

export const POLL_INTERVAL_MS = 5000

export function createProgressPoller(deps: {
  intervalMs: number
  readOnce: () => Promise<Record<string, unknown> | null>
  onProgress: (p: PlaybackProgress) => void
}): { start(): void; stop(): void; running(): boolean } {
  let timer: ReturnType<typeof setInterval> | null = null
  const tick = async (): Promise<void> => {
    const payload = await deps.readOnce()
    if (!payload) return
    const p = parsePlaybackProgress(payload, Date.now())
    if (p) deps.onProgress(p)
  }
  return {
    start(): void {
      if (timer) return // 幂等
      timer = setInterval(() => { void tick() }, deps.intervalMs)
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
    running(): boolean {
      return timer !== null
    }
  }
}

/** 生产 readOnce：`media-control get` 单次快照；无会话输出 "null"、任何失败 → null 静默跳过 */
export function readNowPlayingOnce(binary: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    // get 快照带封面 base64（artworkData），高清封面会超 execFile 默认 1MB maxBuffer 截断报错→err→null 轮询静默哑火——显式放宽到 16MB
    execFile(binary, ['get'], { timeout: 3000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        const json: unknown = JSON.parse(stdout)
        resolve(typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null)
      } catch {
        resolve(null)
      }
    })
  })
}
