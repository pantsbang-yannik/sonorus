import { describe, it, expect } from 'vitest'
import { SonorusEngine } from '../../src/engine/engine'
import type { PcmFrame, Signals } from '../../src/engine/types'

const SR = 48000

function sine(amp: number, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
  return out
}

/** 按 2048 样本小帧喂入 seconds 秒正弦，返回收到的全部信号 */
function feed(engine: SonorusEngine, amp: number, seconds: number): Signals[] {
  const received: Signals[] = []
  const un = engine.bus.subscribe((s) => received.push(s))
  const sig = sine(amp, Math.round(SR * seconds))
  for (let off = 0; off < sig.length; off += 2048) {
    const frame: PcmFrame = { sampleRate: SR, channels: 1, samples: sig.subarray(off, off + 2048) }
    engine.ingest(frame)
  }
  un()
  return received
}

describe('loudness 相对化（契约 v1.1）', () => {
  it('同一波形不同音量 → 稳定后 smooth 相近且都接近 1（音量无关）', () => {
    const a = feed(new SonorusEngine(), 0.4, 10).at(-1)!
    const b = feed(new SonorusEngine(), 0.05, 10).at(-1)!
    expect(a.loudness.smooth).toBeGreaterThan(0.7)
    expect(b.loudness.smooth).toBeGreaterThan(0.7)
    expect(Math.abs(a.loudness.smooth - b.loudness.smooth)).toBeLessThan(0.15)
  })
  it('安静段后突然放大 → instant 冲高到接近 1', () => {
    const engine = new SonorusEngine()
    feed(engine, 0.05, 8)
    const after = feed(engine, 0.5, 0.5)
    expect(Math.max(...after.map((s) => s.loudness.instant))).toBeGreaterThan(0.9)
  })
  it('静音 → loudness 归零', () => {
    const engine = new SonorusEngine()
    feed(engine, 0.3, 3)
    const silent = feed(engine, 0, 5).at(-1)!
    expect(silent.loudness.instant).toBe(0)
    expect(silent.loudness.smooth).toBeLessThan(0.05)
  })
  it('值域恒在 0..1', () => {
    const all = feed(new SonorusEngine(), 0.9, 5)
    for (const s of all) {
      expect(s.loudness.instant).toBeGreaterThanOrEqual(0)
      expect(s.loudness.instant).toBeLessThanOrEqual(1)
      expect(s.loudness.smooth).toBeLessThanOrEqual(1)
    }
  })
})
