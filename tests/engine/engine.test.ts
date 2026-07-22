import { describe, it, expect } from 'vitest'
import { SonorusEngine } from '../../src/engine/engine'
import type { PcmFrame, Signals } from '../../src/engine/types'

function frame(samples: Float32Array): PcmFrame {
  return { sampleRate: 48000, channels: 1, samples }
}

describe('SonorusEngine', () => {
  it('喂入 1 秒 60Hz 正弦 → 收到 ~46 次信号，low 频段占优，无 drop', () => {
    const engine = new SonorusEngine()
    const received: Signals[] = []
    engine.bus.subscribe((s) => received.push(s))

    const n = 48000
    const sig = new Float32Array(n)
    for (let i = 0; i < n; i++) sig[i] = 0.4 * Math.sin((2 * Math.PI * 60 * i) / 48000)
    // 按 512 样本的小帧喂入，验证跨帧积攒
    for (let off = 0; off < n; off += 512) engine.ingest(frame(sig.subarray(off, off + 512)))

    expect(received.length).toBeGreaterThanOrEqual(45)
    expect(received.length).toBeLessThanOrEqual(48)
    const last = received.at(-1)!
    expect(last.bands.low).toBeGreaterThan(last.bands.high)
    expect(last.silence).toBe(false)
    expect(received.some((s) => s.drop)).toBe(false)
  })

  it('退订后不再收到信号', () => {
    const engine = new SonorusEngine()
    let count = 0
    const off = engine.bus.subscribe(() => count++)
    engine.ingest(frame(new Float32Array(2048)))
    const before = count
    off()
    engine.ingest(frame(new Float32Array(2048)))
    expect(count).toBe(before)
  })
})
