import { describe, it, expect } from 'vitest'
import { PcmChunker } from '../../electron/capture/pcm-chunker'

// 测试用小参数：2 声道 Float32 → frameBytes=8；每 chunk 4 帧 → chunkBytes=32
const FRAME_BYTES = 8
const CHUNK_BYTES = 32
const MAX_BACKLOG = 64

/** 生成 n 帧交织立体声：L 声道恒为 1.0，R 声道恒为 2.0 */
function stereoFrames(n: number): Buffer {
  const f = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    f[i * 2] = 1.0
    f[i * 2 + 1] = 2.0
  }
  return Buffer.from(f.buffer)
}

function decode(chunk: Buffer): Float32Array {
  return new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4)
}

describe('PcmChunker', () => {
  it('凑不齐一个 chunk 不吐帧；跨多次 push 凑齐后按 chunk 边界吐出', () => {
    const c = new PcmChunker(CHUNK_BYTES, FRAME_BYTES, MAX_BACKLOG)
    expect(c.push(stereoFrames(1))).toEqual([]) // 8 bytes
    expect(c.push(stereoFrames(2))).toEqual([]) // 累计 24 bytes
    const chunks = c.push(stereoFrames(2)) // 累计 40 bytes → 1 chunk + 8 残留
    expect(chunks).toHaveLength(1)
    expect(chunks[0].byteLength).toBe(CHUNK_BYTES)
    expect(c.pendingBytes).toBe(8)
  })

  it('一次大 push 跨多个 chunk 全部吐出', () => {
    const c = new PcmChunker(CHUNK_BYTES, FRAME_BYTES, 1024) // 大 backlog 不触发丢帧
    const chunks = c.push(stereoFrames(9)) // 72 bytes → 2 chunks + 8 残留
    expect(chunks).toHaveLength(2)
    expect(chunks.every((ch) => ch.byteLength === CHUNK_BYTES)).toBe(true)
    expect(c.pendingBytes).toBe(8)
  })

  it('积压超限丢旧留新，且丢弃点非帧长整数倍时保留尾部仍帧对齐（L/R 不互换）', () => {
    // 可判别构造（旧公式 `subarray(acc.length - chunkBytes)` 在此用例下必挂）：
    // ① push 36 bytes → 吐 1 chunk（消费 32），残留 4 bytes（半帧，模拟管道分片）
    // ② 再 push 96 bytes → 积压 100 > 64 → drop = 100-32 = 68（落在帧中间）
    //    新实现对齐到 64 → 吐出的 chunk 起点在帧边界，首浮点 = L = 1.0
    //    旧实现直接从 68 切 → 起点错半帧，首浮点 = R = 2.0（声道互换）
    const c = new PcmChunker(CHUNK_BYTES, FRAME_BYTES, MAX_BACKLOG)
    const src = stereoFrames(17) // 136 bytes 连续 L=1.0/R=2.0 流
    const first = c.push(src.subarray(0, 36))
    expect(first).toHaveLength(1)
    expect(c.pendingBytes).toBe(4)
    const chunks = c.push(src.subarray(36, 132))
    expect(chunks).toHaveLength(1)
    const samples = decode(chunks[0])
    expect(samples[0]).toBe(1.0) // 首样本必须是 L —— 旧公式这里是 2.0
    expect(samples[1]).toBe(2.0)
    for (let i = 0; i < samples.length; i += 2) {
      expect(samples[i]).toBe(1.0) // L 声道
      expect(samples[i + 1]).toBe(2.0) // R 声道
    }
  })

  it('无溢出时字节守恒：吐出字节 + 残留 = 灌入总量', () => {
    const c = new PcmChunker(CHUNK_BYTES, FRAME_BYTES, 1024)
    // 故意用不规则分片
    const pieces = [3, 13, 32, 7, 21, 40]
    let pushed = 0
    let emitted = 0
    const src = stereoFrames(64) // 512 bytes 源数据
    let off = 0
    for (const n of pieces) {
      pushed += n
      for (const ch of c.push(src.subarray(off, off + n))) emitted += ch.byteLength
      off += n
    }
    expect(emitted + c.pendingBytes).toBe(pushed)
    expect(emitted % CHUNK_BYTES).toBe(0)
  })

  it('溢出丢帧后字节守恒被打破但吐出量仍是 chunk 整数倍，残留 < chunk', () => {
    const c = new PcmChunker(CHUNK_BYTES, FRAME_BYTES, MAX_BACKLOG)
    const chunks = c.push(stereoFrames(30)) // 240 bytes >> 64
    let emitted = 0
    for (const ch of chunks) emitted += ch.byteLength
    expect(emitted % CHUNK_BYTES).toBe(0)
    expect(c.pendingBytes).toBeLessThan(CHUNK_BYTES)
    expect(emitted + c.pendingBytes).toBeLessThan(240) // 确实丢了旧数据
  })

  it('chunkBytes 不是 frameBytes 整数倍时拒绝构造', () => {
    expect(() => new PcmChunker(30, 8, 64)).toThrow()
  })
})
