import { PcmBatcher } from './pcm-batcher'
import type { PcmFrame } from '../engine/types'

/** AudioWorklet 处理器源码。用 Blob URL 注入而非独立 .ts 文件:electron-vite 对 worklet
 * 模块没有开箱打包路径,内联源码零构建配置。职责刻意最小:混单声道 post 回主线程 + 原样透传出声。 */
const TAP_WORKLET_SOURCE = `
registerProcessor('pcm-tap', class extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (input.length === 0) return true
    const n = input[0].length
    const mono = new Float32Array(n)
    for (let c = 0; c < input.length; c++) {
      const ch = input[c]
      for (let i = 0; i < n; i++) mono[i] += ch[i]
    }
    if (input.length > 1) { for (let i = 0; i < n; i++) mono[i] /= input.length }
    for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, input.length - 1)])
    this.port.postMessage(mono, [mono.buffer])
    return true
  }
})
`

export interface LocalPlayerDeps {
  onPcm: (f: PcmFrame) => void
  onTime: (current: number, duration: number) => void
  onPlayState: (playing: boolean) => void
  onEnded: () => void
  onError: (err: unknown) => void
}

/**
 * 本地文件播放器:<audio> 管解码/出声/进度,Web Audio 图只做 PCM 分流。
 * 数据流:<audio> → MediaElementSource → pcm-tap worklet(透传出声 + post 块)→ PcmBatcher → onPcm。
 * 注意:createMediaElementSource 每元素一生只能调一次——audio 元素与图全生命周期复用,只换 src。
 * dispose 后实例不可复用——audio 元素已绑定过 MediaElementSource,重建图必抛 InvalidStateError。
 */
export class LocalPlayer {
  private audio = new Audio()
  private ctx: AudioContext | null = null
  private batcher: PcmBatcher | null = null
  private objectUrl: string | null = null
  /** 图构建的单发 promise:守卫原子化——并发 load 共享同一次构建,失败也不重置
   * (失败若发生在 createMediaElementSource 之后,重试必抛 InvalidStateError,不如稳定失败) */
  private graphReady: Promise<void> | null = null

  constructor(private deps: LocalPlayerDeps) {
    this.audio.addEventListener('timeupdate', () => {
      this.deps.onTime(this.audio.currentTime, Number.isFinite(this.audio.duration) ? this.audio.duration : 0)
    })
    this.audio.addEventListener('play', () => this.deps.onPlayState(true))
    this.audio.addEventListener('pause', () => this.deps.onPlayState(false))
    this.audio.addEventListener('ended', () => this.deps.onEnded())
    this.audio.addEventListener('error', () => {
      // stop() 清 src 会触发一次良性 abort error——没有 objectUrl 说明不在播放态,不上报
      if (this.objectUrl) this.deps.onError(this.audio.error)
    })
  }

  private ensureGraph(): Promise<void> {
    this.graphReady ??= this.buildGraph()
    return this.graphReady
  }

  private async buildGraph(): Promise<void> {
    const ctx = new AudioContext()
    const url = URL.createObjectURL(new Blob([TAP_WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const tap = new AudioWorkletNode(ctx, 'pcm-tap')
    this.batcher = new PcmBatcher(ctx.sampleRate, (f) => this.deps.onPcm(f))
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.batcher?.push(e.data)
    ctx.createMediaElementSource(this.audio).connect(tap)
    tap.connect(ctx.destination)
    this.ctx = ctx
  }

  /** 换源并播放;解码/播放失败会 reject(装配层负责报错提示与回退) */
  async load(file: File): Promise<void> {
    await this.ensureGraph()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.batcher?.reset()
    this.objectUrl = URL.createObjectURL(file)
    this.audio.src = this.objectUrl
    await this.ctx!.resume() // 防御自动播放策略挂起;stop() 后再 load 也靠这句唤醒
    await this.audio.play()
  }

  toggle(): void {
    if (this.audio.paused) {
      void this.ctx?.resume()
      void this.audio.play().catch((e) => this.deps.onError(e))
    } else {
      this.audio.pause()
    }
  }

  seek(sec: number): void {
    this.audio.currentTime = sec
  }

  get playing(): boolean {
    return !this.audio.paused
  }

  /** 停播并释放(回监听模式):ctx 挂起省 CPU;元素与图保留,下次 load 复用 */
  stop(): void {
    this.audio.pause()
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    this.audio.removeAttribute('src')
    this.audio.load()
    this.batcher?.reset()
    void this.ctx?.suspend()
  }

  dispose(): void {
    this.stop()
    void this.ctx?.close()
  }
}
