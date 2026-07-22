import type { PcmFrame } from '../engine/types'

/** 与 electron/capture/mac-tap.ts 的 CHUNK_SAMPLES 同口径:引擎按 1024(=HOP_SIZE)切帧,
 * 攒满整批再发省 IPC 级碎消息(worklet 每块只有 128 帧) */
export const BATCH_SAMPLES = 1024

/** worklet 小块 → 引擎口径 PcmFrame。worklet 侧已混好单声道,这里只管攒批 */
export class PcmBatcher {
  private pending = new Float32Array(0)

  constructor(private sampleRate: number, private emit: (f: PcmFrame) => void) {}

  push(block: Float32Array): void {
    const merged = new Float32Array(this.pending.length + block.length)
    merged.set(this.pending)
    merged.set(block, this.pending.length)
    let off = 0
    while (merged.length - off >= BATCH_SAMPLES) {
      this.emit({ sampleRate: this.sampleRate, channels: 1, samples: merged.slice(off, off + BATCH_SAMPLES) })
      off += BATCH_SAMPLES
    }
    this.pending = merged.slice(off)
  }

  /** 切歌/停止时丢弃残样本——不足一批的尾巴不送引擎 */
  reset(): void {
    this.pending = new Float32Array(0)
  }
}
