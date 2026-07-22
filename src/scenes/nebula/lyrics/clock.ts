// 播放进度外插器（spec §3）：进度事件到达时 mark 定基准，逐帧 advance 按倍率外插。
// 不用墙钟（Date/performance）——advance(dt) 由场景帧循环驱动，纯逻辑可步进单测。
// 系统只在播放/暂停/seek/切歌时推事件，中间靠外插；5s 轮询兜底会以新 mark 校准漂移。
export interface ClockMark {
  elapsedTime: number
  playbackRate: number
  playing: boolean
}

export class PlaybackClock {
  private pos: number | null = null
  private rate = 1
  private playing = false

  mark(m: ClockMark): void {
    this.pos = m.elapsedTime
    this.rate = m.playbackRate
    this.playing = m.playing
  }

  advance(dt: number): void {
    if (this.pos !== null && this.playing) this.pos += dt * this.rate
  }

  position(): number | null {
    return this.pos
  }

  /** 切歌时归零：旧曲外插值不得驱动新曲歌词（场景 onTrackChange 调用） */
  reset(): void {
    this.pos = null
    this.rate = 1
    this.playing = false
  }
}
