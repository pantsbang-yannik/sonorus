import { describe, it, expect } from 'vitest'
import { PcmBatcher, BATCH_SAMPLES } from '../../src/audio/pcm-batcher'
import type { PcmFrame } from '../../src/engine/types'

function collect(): { frames: PcmFrame[]; emit: (f: PcmFrame) => void } {
  const frames: PcmFrame[] = []
  return { frames, emit: (f) => frames.push(f) }
}

describe('PcmBatcher(worklet 128 帧块 → 1024 样本 PcmFrame,与捕获链 CHUNK_SAMPLES 同口径)', () => {
  it('不足一批不发射', () => {
    const { frames, emit } = collect()
    const b = new PcmBatcher(48000, emit)
    b.push(new Float32Array(BATCH_SAMPLES - 1))
    expect(frames.length).toBe(0)
  })

  it('攒满一批发射:mono/采样率/长度正确', () => {
    const { frames, emit } = collect()
    const b = new PcmBatcher(44100, emit)
    for (let i = 0; i < 8; i++) b.push(new Float32Array(128).fill(i)) // 8×128=1024
    expect(frames.length).toBe(1)
    expect(frames[0].sampleRate).toBe(44100)
    expect(frames[0].channels).toBe(1)
    expect(frames[0].samples.length).toBe(BATCH_SAMPLES)
    expect(frames[0].samples[0]).toBe(0)   // 第一块内容
    expect(frames[0].samples[1023]).toBe(7) // 最后一块内容——顺序不乱
  })

  it('跨批余量保留:一次 push 超过一批,余下的进下一批', () => {
    const { frames, emit } = collect()
    const b = new PcmBatcher(48000, emit)
    b.push(new Float32Array(BATCH_SAMPLES + 100).fill(1))
    expect(frames.length).toBe(1)
    b.push(new Float32Array(BATCH_SAMPLES - 100).fill(2))
    expect(frames.length).toBe(2)
    expect(frames[1].samples[99]).toBe(1)  // 前 100 是上次余量
    expect(frames[1].samples[100]).toBe(2)
  })

  it('reset 丢弃残样本(切歌/停止时不足一批的尾巴不送引擎)', () => {
    const { frames, emit } = collect()
    const b = new PcmBatcher(48000, emit)
    b.push(new Float32Array(500).fill(9))
    b.reset()
    b.push(new Float32Array(BATCH_SAMPLES).fill(1))
    expect(frames.length).toBe(1)
    expect(frames[0].samples[0]).toBe(1) // 残样本 9 没混进来
  })
})
