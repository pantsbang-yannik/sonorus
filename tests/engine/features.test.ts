import { describe, it, expect } from 'vitest'
import { extractFeatures, mixToMono, HOP_SIZE } from '../../src/engine/features'
import type { PcmFrame } from '../../src/engine/types'

function sine(freq: number, sampleRate: number, n: number, amp = 0.5): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

describe('mixToMono', () => {
  it('立体声交错混为单声道均值', () => {
    const frame: PcmFrame = {
      sampleRate: 48000, channels: 2,
      samples: new Float32Array([1, 0, 1, 0, -1, 0, -1, 0])
    }
    const mono = mixToMono(frame)
    expect(Array.from(mono)).toEqual([0.5, 0.5, -0.5, -0.5])
  })
})

describe('extractFeatures', () => {
  it('60Hz 正弦 → 能量集中在 low', () => {
    const f = extractFeatures(sine(60, 48000, HOP_SIZE), 48000)
    expect(f.bands.low).toBeGreaterThan(f.bands.mid * 5)
    expect(f.bands.low).toBeGreaterThan(f.bands.high * 5)
    expect(f.rms).toBeCloseTo(0.35, 1) // 0.5 幅度正弦 rms ≈ 0.354
  })
  it('8kHz 正弦 → 能量集中在 high', () => {
    const f = extractFeatures(sine(8000, 48000, HOP_SIZE), 48000)
    expect(f.bands.high).toBeGreaterThan(f.bands.low * 5)
  })
  it('静音 → 全零', () => {
    const f = extractFeatures(new Float32Array(HOP_SIZE), 48000)
    expect(f.rms).toBe(0)
    expect(f.spectrum.length).toBe(512)
  })
})
