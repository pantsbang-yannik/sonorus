// Drop 回放动图（idea #8）纯逻辑层：取帧节流 / GOP 环形缓冲 / 录制尺寸 / 文件名。
// 与 WebCodecs/DOM 零耦合（chunk 只要求 type+timestamp 形状），全量单测；
// 编码器与 mux 的脏活在 replay-recorder.ts（亲验件），口径同 poster.ts 的"纯逻辑单测"共识。

/** 编码块的最小形状（timestamp 微秒）——真身是 EncodedVideoChunk，测试用平对象 */
export interface ChunkLike { type: 'key' | 'delta'; timestamp: number }

export const REPLAY_FPS = 30
export const REPLAY_KEY_INTERVAL = 30 // 帧 ≈ 1s GOP
export const REPLAY_KEEP_US = 5_500_000 // 缓冲保留跨度：目标 5s + 半组余量
export const REPLAY_WANT_US = 5_000_000
export const REPLAY_MIN_US = 1_000_000
export const REPLAY_GAP_RESET_MS = 1000 // rAF 停摆（遮挡/最小化）判据：超此间隙重起缓冲
export const REPLAY_MAX_LONG = 1280
export const REPLAY_BITRATE = 8_000_000
export const REPLAY_RESIZE_SETTLE_MS = 300

/** 录制分辨率：长边压到 maxLong 不放大，宽高取偶（H.264 硬编要求），退化输入保底 2 */
export function recordingSize(srcW: number, srcH: number, maxLong = REPLAY_MAX_LONG): { w: number; h: number } {
  const scale = Math.min(1, maxLong / Math.max(srcW, srcH, 1))
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { w: even(srcW), h: even(srcH) }
}

/** rAF（60/120Hz 随显示器）降到目标 fps 的取帧闸：距上次取帧 ≥ 间隔-5ms 才放行。
 * 5ms 容差防 60Hz 下 33.3ms 节拍恰好差半帧永远取不到第二帧；实际帧距进 mp4 用真时间戳，快慢无损 */
export class FrameThrottle {
  private last = -Infinity
  constructor(private readonly fps: number) {}
  shouldCapture(nowMs: number): boolean {
    if (nowMs - this.last < 1000 / this.fps - 5) return false
    this.last = nowMs
    return true
  }
  reset(): void { this.last = -Infinity }
}

/**
 * GOP 环形缓冲：块按 key 分组，滚动淘汰最旧组（淘汰后剩余跨度仍 ≥ keepUs 才丢）。
 * takeClip 从最新往回取最小满足 wantUs 的组后缀——起点天然是 key，直接可解码。
 */
export class GopRing<T extends ChunkLike> {
  private gops: T[][] = []
  constructor(private readonly keepUs: number) {}

  push(c: T): void {
    if (c.type === 'key') {
      this.gops.push([c])
    } else {
      const last = this.gops[this.gops.length - 1]
      if (!last) return // 编码器重建/流重起瞬间的孤儿 delta：无 key 引领不可解码，丢弃
      last.push(c)
    }
    while (this.gops.length > 1 && c.timestamp - this.gops[1][0].timestamp >= this.keepUs) {
      this.gops.shift()
    }
  }

  takeClip(wantUs: number, minUs: number): T[] | null {
    if (this.gops.length === 0) return null
    const lastGop = this.gops[this.gops.length - 1]
    const newest = lastGop[lastGop.length - 1].timestamp
    let start = this.gops.length - 1
    while (start > 0 && newest - this.gops[start][0].timestamp < wantUs) start--
    const chunks = this.gops.slice(start).flat()
    if (newest - chunks[0].timestamp < minUs) return null
    return chunks
  }

  clear(): void { this.gops = [] }
}

/** resize 稳定闸（终审 Issue 1）：目标尺寸须连续稳定 settleMs 才放行编码器重建——
 * 拖拽窗口是连续 resize 流，逐帧重建硬件编码会话既是性能税，任何一次竞态报错
 * 还会烧掉仅有一次的自愈名额；拖拽期间缓冲本就要清，跳帧无损 */
export class SizeSettler {
  private candW = 0
  private candH = 0
  private since = 0
  constructor(private readonly settleMs: number) {}
  /** 每帧喂目标尺寸：true=已连续稳定 settleMs 可重建；false=还在抖，本帧跳过 */
  settled(w: number, h: number, nowMs: number): boolean {
    if (w !== this.candW || h !== this.candH) {
      this.candW = w
      this.candH = h
      this.since = nowMs
      return false
    }
    return nowMs - this.since >= this.settleMs
  }
}

/** 文件名口径镜像 posterFilename（poster.ts）：清洗/截断/秒级时间戳，仅前缀与扩展名不同 */
export function replayFilename(title: string, now: Date): string {
  const safe = title.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'untitled'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `Sonorus-Drop-${safe}-${stamp}.mp4`
}
