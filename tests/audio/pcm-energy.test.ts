// 原始 PCM 帧能量探针（发布准备③）：零流/有声判别
import { describe, expect, it } from 'vitest'
import { frameRms, AUDIBLE_RMS } from '../../src/audio/pcm-energy'

describe('frameRms', () => {
  it('全零帧（macOS 拒绝授权的静音流）RMS = 0，低于可闻阈值', () => {
    expect(frameRms(new Float32Array(2048))).toBe(0)
    expect(frameRms(new Float32Array(2048)) >= AUDIBLE_RMS).toBe(false)
  })

  it('小声正弦（幅度 0.01）RMS ≈ 0.007，仍高于阈值', () => {
    const n = 2048
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) s[i] = 0.01 * Math.sin((i / n) * Math.PI * 2 * 32)
    const rms = frameRms(s)
    expect(rms).toBeGreaterThan(AUDIBLE_RMS)
    expect(rms).toBeCloseTo(0.01 / Math.SQRT2, 3)
  })

  it('空帧不除零', () => {
    expect(frameRms(new Float32Array(0))).toBe(0)
  })
})
