import { describe, it, expect } from 'vitest'
import {
  GopRing, FrameThrottle, recordingSize, replayFilename, SizeSettler,
  type ChunkLike,
} from '../../src/replay/replay-clip'

const key = (us: number): ChunkLike => ({ type: 'key', timestamp: us })
const delta = (us: number): ChunkLike => ({ type: 'delta', timestamp: us })
const S = 1_000_000 // 1s in µs

describe('recordingSize', () => {
  it('大画布按长边缩到 maxLong，宽高取偶', () => {
    expect(recordingSize(2560, 1440, 1280)).toEqual({ w: 1280, h: 720 })
    expect(recordingSize(2879, 1799, 1280)).toEqual({ w: 1280, h: 800 })
  })
  it('小画布不放大', () => {
    expect(recordingSize(960, 540, 1280)).toEqual({ w: 960, h: 540 })
  })
  it('奇数尺寸落偶（H.264 硬编要求偶数）', () => {
    const { w, h } = recordingSize(1281, 721, 1280)
    expect(w % 2).toBe(0)
    expect(h % 2).toBe(0)
  })
  it('退化输入不产出 0 尺寸', () => {
    const { w, h } = recordingSize(1, 1, 1280)
    expect(w).toBeGreaterThanOrEqual(2)
    expect(h).toBeGreaterThanOrEqual(2)
  })
})

describe('FrameThrottle', () => {
  it('60Hz 显示器（16.7ms 帧）下取帧约 30fps', () => {
    const t = new FrameThrottle(30)
    let captured = 0
    for (let i = 0; i < 120; i++) if (t.shouldCapture(i * (1000 / 60))) captured++
    expect(captured).toBeGreaterThanOrEqual(58)
    expect(captured).toBeLessThanOrEqual(62)
  })
  it('120Hz 下同样约 30fps（不随显示器翻倍）', () => {
    const t = new FrameThrottle(30)
    let captured = 0
    for (let i = 0; i < 240; i++) if (t.shouldCapture(i * (1000 / 120))) captured++
    expect(captured).toBeGreaterThanOrEqual(58)
    expect(captured).toBeLessThanOrEqual(62)
  })
  it('长间隙后恢复即取帧', () => {
    const t = new FrameThrottle(30)
    t.shouldCapture(0)
    expect(t.shouldCapture(5000)).toBe(true)
  })
})

describe('GopRing', () => {
  it('无归属 GOP 的 delta 被丢弃（编码器重建瞬间只等 key）', () => {
    const ring = new GopRing<ChunkLike>(5_500_000)
    ring.push(delta(0))
    expect(ring.takeClip(5 * S, 0)).toBeNull()
  })
  it('滚动淘汰最旧 GOP，剩余跨度始终 ≥ keepUs', () => {
    const ring = new GopRing<ChunkLike>(5_500_000)
    // 10 组 1s GOP：0s,1s,...9s，每组 key + 1 delta
    for (let g = 0; g < 10; g++) {
      ring.push(key(g * S))
      ring.push(delta(g * S + S / 2))
    }
    const clip = ring.takeClip(100 * S, 0)! // 要得比有的多 → 给全部存量
    // 最新 9.5s：淘汰后第二组起点距最新 ≥5.5s 即可丢首组 → 存量起点应在 4s
    expect(clip[0].timestamp).toBe(4 * S)
    expect(clip[0].type).toBe('key')
  })
  it('takeClip 取最小满足 wantUs 的后缀，起点必为 key', () => {
    const ring = new GopRing<ChunkLike>(60 * S) // keep 放宽，专测选段
    for (let g = 0; g < 8; g++) {
      ring.push(key(g * S))
      ring.push(delta(g * S + S / 2))
    }
    const clip = ring.takeClip(5 * S, S)!
    // 最新时间戳 7.5s，跨度 ≥5s 的最小后缀从 2s 的 key 起（7.5-2=5.5 ≥ 5; 从3s起只有4.5s 不够）
    expect(clip[0]).toEqual(key(2 * S))
    expect(clip[clip.length - 1]).toEqual(delta(7 * S + S / 2))
  })
  it('总跨度 < minUs → null（攒不够不出片）', () => {
    const ring = new GopRing<ChunkLike>(5_500_000)
    ring.push(key(0))
    ring.push(delta(S / 2))
    expect(ring.takeClip(5 * S, S)).toBeNull()
  })
  it('clear 清空后无片可取', () => {
    const ring = new GopRing<ChunkLike>(5_500_000)
    ring.push(key(0))
    ring.clear()
    expect(ring.takeClip(0, 0)).toBeNull()
  })
})

describe('SizeSettler', () => {
  it('尺寸首见即计时，未满 settleMs 不放行', () => {
    const s = new SizeSettler(300)
    expect(s.settled(1280, 720, 1000)).toBe(false)
    expect(s.settled(1280, 720, 1200)).toBe(false)
  })
  it('同尺寸连续稳定满 settleMs 放行', () => {
    const s = new SizeSettler(300)
    s.settled(1280, 720, 1000)
    expect(s.settled(1280, 720, 1300)).toBe(true)
  })
  it('中途尺寸再变则重新计时（拖拽抖动）', () => {
    const s = new SizeSettler(300)
    s.settled(1280, 720, 1000)
    expect(s.settled(1000, 600, 1200)).toBe(false) // 变了，重计
    expect(s.settled(1000, 600, 1400)).toBe(false) // 距重计仅 200ms
    expect(s.settled(1000, 600, 1500)).toBe(true)
  })
})

describe('replayFilename', () => {
  it('Audelyra-Drop 前缀 + 歌名清洗 + 秒级时间戳 + .mp4', () => {
    const now = new Date(2026, 6, 16, 21, 5, 9)
    expect(replayFilename('夜曲', now)).toBe('Audelyra-Drop-夜曲-20260716-210509.mp4')
  })
  it('非法字符替换、空名回落 untitled（同 posterFilename 口径）', () => {
    const now = new Date(2026, 6, 16, 21, 5, 9)
    expect(replayFilename('a/b:c', now)).toBe('Audelyra-Drop-a_b_c-20260716-210509.mp4')
    expect(replayFilename('', now)).toBe('Audelyra-Drop-untitled-20260716-210509.mp4')
  })
})
