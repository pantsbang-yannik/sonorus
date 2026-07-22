/**
 * 纯 Buffer 数学的 PCM 累积/切帧/丢帧器（无 electron 依赖，可单测）。
 *
 * - push() 累积任意长度的字节流，返回所有已凑齐的完整 chunk
 * - 积压超过 maxBacklogBytes 时丢弃旧数据只保留最新（低延迟优先），
 *   丢弃点向下对齐到 frameBytes 边界 —— 管道分片会让积压长度不是帧长的
 *   整数倍，若不对齐，一次丢帧就会永久错位声道交织（L/R 互换）。
 *
 * 不变量：acc 的起点始终位于帧边界（初始为 0；消费只按 chunkBytes 走，
 * 而 chunkBytes 必须是 frameBytes 的整数倍；丢弃点也对齐到帧边界）。
 */
export class PcmChunker {
  private acc: Buffer = Buffer.alloc(0)

  constructor(
    private readonly chunkBytes: number,
    private readonly frameBytes: number,
    private readonly maxBacklogBytes: number
  ) {
    if (chunkBytes % frameBytes !== 0) {
      throw new Error('chunkBytes must be a multiple of frameBytes')
    }
  }

  /** 喂入一段字节流，返回凑齐的完整 chunk（可能为空数组）。 */
  push(data: Buffer): Buffer[] {
    // 始终 concat 拥有自己的缓冲：直接持有来路 chunk（零拷贝）会让吐出的
    // subarray 的 byteOffset 依赖 Node 流内部分配的对齐方式，而下游
    // Float32Array 视图要求 4 字节对齐，不能依赖内部实现（~23 次/s 拷贝可忽略）
    this.acc = Buffer.concat([this.acc, data])

    // 丢帧策略：积压超上限只保留最新一个 chunk 的量，丢弃点对齐帧边界
    if (this.acc.length > this.maxBacklogBytes) {
      let drop = this.acc.length - this.chunkBytes
      drop -= drop % this.frameBytes
      if (drop > 0) this.acc = this.acc.subarray(drop)
    }

    const chunks: Buffer[] = []
    while (this.acc.length >= this.chunkBytes) {
      chunks.push(this.acc.subarray(0, this.chunkBytes))
      this.acc = this.acc.subarray(this.chunkBytes)
    }
    return chunks
  }

  /** 当前未凑齐一个 chunk 的残留字节数（测试/诊断用）。 */
  get pendingBytes(): number {
    return this.acc.length
  }
}
