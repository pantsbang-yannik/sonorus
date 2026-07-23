// Drop 回放录制引擎（idea #8 方案B）：持续硬件编码 + GOP 环形缓冲，快门=秒封 MP4。
// 三条生命线：
// 1. capture 必须由 SceneHost.afterFrame 调（渲染同任务，WebGPU 画布 present 后即不可读——海报教训）；
// 2. 编码在 VideoToolbox 硬件单元异步进行，主循环每帧只付一次缩放 drawImage + 角标文字；
// 3. 任何编码故障都只降级本功能（available=false），绝不外抛拖垮渲染。
import { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } from 'mediabunny'
import {
  GopRing, FrameThrottle, recordingSize, SizeSettler,
  REPLAY_FPS, REPLAY_KEY_INTERVAL, REPLAY_KEEP_US, REPLAY_WANT_US, REPLAY_MIN_US,
  REPLAY_GAP_RESET_MS, REPLAY_MAX_LONG, REPLAY_BITRATE, REPLAY_RESIZE_SETTLE_MS,
} from './replay-clip'

export interface ReplayMeta { title: string; artist: string }
export interface ReplayClip { blob: Blob; durationSec: number }

interface StoredChunk { type: 'key' | 'delta'; timestamp: number; chunk: EncodedVideoChunk }

/** H.264 档位候选（高→低探测取首个支持项）：High/Main/Constrained-Baseline，均 L4.0（1080p30 上限够用） */
const AVC_CANDIDATES = ['avc1.640028', 'avc1.4D4028', 'avc1.42E028']

type State = 'idle' | 'initializing' | 'ready' | 'unavailable'

export class ReplayRecorder {
  private state: State = 'idle'
  private encoder: VideoEncoder | null = null
  private codec: string | null = null
  private decoderConfig: VideoDecoderConfig | null = null // 首个 output 回调携带（含 avcC description），mux 首包必需
  private ring = new GopRing<StoredChunk>(REPLAY_KEEP_US)
  private throttle = new FrameThrottle(REPLAY_FPS)
  private settler = new SizeSettler(REPLAY_RESIZE_SETTLE_MS)
  private recCanvas = document.createElement('canvas')
  private ctx = this.recCanvas.getContext('2d', { alpha: false })!
  private framesSinceKey = REPLAY_KEY_INTERVAL // 起步即 key
  private lastCaptureMs: number | null = null
  private rebuilt = false // 编码器错误自愈一次；再错本会话禁用
  private takingClip = false // 封装期间暂停投喂（flush 后的编码器状态窗口）

  constructor(
    private source: HTMLCanvasElement,
    private deps: { getMeta: () => ReplayMeta | null }
  ) {}

  get available(): boolean { return this.state !== 'unavailable' }

  /** 每帧调用（渲染同任务）。未初始化时懒起（异步探测编码支持，期间跳帧）；不可用后永久空转。 */
  capture(nowMs: number): void {
    if (this.state === 'unavailable' || this.takingClip) return
    if (this.state === 'idle') { this.state = 'initializing'; void this.init(); return }
    if (this.state !== 'ready' || !this.encoder) return
    if (this.source.width < 2 || this.source.height < 2) return
    if (!this.throttle.shouldCapture(nowMs)) return
    // rAF 停摆（遮挡/最小化/调试断点）恢复：时间轴断裂，重起缓冲防"冻结跳变"混进片段
    if (this.lastCaptureMs !== null && nowMs - this.lastCaptureMs > REPLAY_GAP_RESET_MS) this.resetStream()
    this.lastCaptureMs = nowMs
    const { w, h } = recordingSize(this.source.width, this.source.height, REPLAY_MAX_LONG)
    if (w !== this.recCanvas.width || h !== this.recCanvas.height) {
      // 窗口 resize：H.264 流分辨率不可中途变，整条流重建（缓冲清空重攒，几秒又满）；
      // 拖拽是连续 resize 流，须尺寸稳定 settleMs 才放行重建，防每帧 churn 烧光自愈名额
      if (!this.settler.settled(w, h, nowMs)) return
      this.reconfigure(w, h)
      if (this.state !== 'ready' || !this.encoder) return
    }
    const keyFrame = this.framesSinceKey >= REPLAY_KEY_INTERVAL
    let frame: VideoFrame | null = null
    try {
      // drawImage/VideoFrame 构造在 GPU 上下文丢失等异常下会抛 InvalidStateError；
      // 全段并入同一 try，任何一步故障都只降级本功能，绝不外抛拖垮渲染循环
      this.ctx.drawImage(this.source, 0, 0, w, h)
      this.drawBadge(w, h)
      frame = new VideoFrame(this.recCanvas, { timestamp: Math.round(nowMs * 1000) })
      if (keyFrame) this.framesSinceKey = 0
      this.framesSinceKey++
      this.encoder.encode(frame, { keyFrame })
    } catch (err) {
      this.onEncoderError(err)
    } finally {
      frame?.close()
    }
  }

  /** 快门：排空在途帧 → 从缓冲取最近 ~5s（起点必 key）→ mediabunny 封 MP4。
   * 攒不够(<1s)/未就绪/封装失败 → null，调用方按 available 区分提示文案。 */
  async takeClip(): Promise<ReplayClip | null> {
    if (this.takingClip) return null // 重入防御：调用方去抖失效时防对同一 encoder 并发 flush
    if (this.state !== 'ready' || !this.encoder || !this.decoderConfig) return null
    this.takingClip = true
    try {
      await this.encoder.flush()
      const decoderConfig = this.decoderConfig // 快照（终审 Issue 4）：mux 的 await 间隙可能被 reconfigure 置 null
      if (!decoderConfig) return null
      const chunks = this.ring.takeClip(REPLAY_WANT_US, REPLAY_MIN_US)
      if (!chunks) return null
      const t0 = chunks[0].timestamp
      const frameUs = Math.round(1e6 / REPLAY_FPS)
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
      const packetSource = new EncodedVideoPacketSource('avc')
      output.addVideoTrack(packetSource)
      await output.start()
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i].chunk
        const data = new Uint8Array(c.byteLength)
        c.copyTo(data)
        // 时间戳重定基到 0；时长=到下一帧的真实间隔（末帧记标称帧长）。mediabunny 用秒
        const durUs = i + 1 < chunks.length ? chunks[i + 1].timestamp - chunks[i].timestamp : frameUs
        const packet = new EncodedPacket(data, chunks[i].type, (chunks[i].timestamp - t0) / 1e6, Math.max(durUs, 0) / 1e6)
        await packetSource.add(packet, i === 0 ? { decoderConfig } : undefined)
      }
      await output.finalize()
      const buffer = (output.target as BufferTarget).buffer
      if (!buffer) return null
      const durationSec = (chunks[chunks.length - 1].timestamp - t0 + frameUs) / 1e6
      return { blob: new Blob([buffer], { type: 'video/mp4' }), durationSec }
    } catch (err) {
      console.warn('[replay] takeClip 封装失败', err)
      return null
    } finally {
      this.takingClip = false
      this.framesSinceKey = REPLAY_KEY_INTERVAL // flush 后下一帧强制 key，续录无缝成组
    }
  }

  dispose(): void {
    try { this.encoder?.close() } catch { /* 已 close 的编码器再 close 会抛，尽力释放 */ }
    this.encoder = null
    this.ring.clear()
    this.state = 'unavailable'
  }

  private async init(): Promise<void> {
    try {
      if (typeof VideoEncoder === 'undefined') { this.state = 'unavailable'; return }
      const { w, h } = recordingSize(Math.max(this.source.width, 2), Math.max(this.source.height, 2), REPLAY_MAX_LONG)
      for (const codec of AVC_CANDIDATES) {
        const support = await VideoEncoder.isConfigSupported(this.encoderConfig(codec, w, h))
        if (support.supported) { this.codec = codec; break }
      }
      if (!this.codec) { this.state = 'unavailable'; return }
      this.recCanvas.width = w
      this.recCanvas.height = h
      this.buildEncoder(w, h)
      this.state = 'ready'
    } catch (err) {
      console.warn('[replay] 编码器初始化失败，本会话禁用 Drop 快门', err)
      this.state = 'unavailable'
    }
  }

  private encoderConfig(codec: string, w: number, h: number): VideoEncoderConfig {
    // avc 格式（非 annexb）：chunk 自带 avcC description，MP4 封装必需
    return { codec, width: w, height: h, bitrate: REPLAY_BITRATE, framerate: REPLAY_FPS, avc: { format: 'avc' } }
  }

  private buildEncoder(w: number, h: number): void {
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig
        this.ring.push({ type: chunk.type as 'key' | 'delta', timestamp: chunk.timestamp, chunk })
      },
      error: (err) => this.onEncoderError(err),
    })
    this.encoder.configure(this.encoderConfig(this.codec!, w, h))
  }

  private reconfigure(w: number, h: number): void {
    try { this.encoder?.close() } catch { /* 错误态编码器 close 可抛，无碍重建 */ }
    this.encoder = null
    this.recCanvas.width = w
    this.recCanvas.height = h
    this.decoderConfig = null // 新流新参数集，等新编码器的首个 output 重新携带
    this.resetStream()
    try {
      this.buildEncoder(w, h)
    } catch (err) {
      this.onEncoderError(err)
    }
  }

  private resetStream(): void {
    this.ring.clear()
    this.framesSinceKey = REPLAY_KEY_INTERVAL
    this.throttle.reset()
  }

  private onEncoderError(err: unknown): void {
    console.warn('[replay] 编码器错误', err)
    if (this.rebuilt) { this.state = 'unavailable'; this.encoder = null; return }
    this.rebuilt = true // 只自愈一次：反复重建说明是环境问题，别在渲染循环里无限折腾
    this.reconfigure(this.recCanvas.width || 2, this.recCanvas.height || 2)
    if (this.encoder) this.state = 'ready'
    else this.state = 'unavailable'
  }

  /** 角标烧进帧（spec 拍板"轻量角标"）：左下 歌名·歌手，右下 Audelyra；字号随录制高度，阴影保深浅背景可读 */
  private drawBadge(w: number, h: number): void {
    const meta = this.deps.getMeta()
    const pad = Math.round(h * 0.033)
    const fontPx = Math.max(11, Math.round(h * 0.026))
    const ctx = this.ctx
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = Math.max(2, Math.round(fontPx * 0.35))
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
    ctx.font = `300 ${fontPx}px -apple-system, "PingFang SC", sans-serif`
    ctx.textBaseline = 'bottom'
    if (meta) {
      ctx.textAlign = 'left'
      const label = meta.artist ? `${meta.title} · ${meta.artist}` : meta.title
      ctx.fillText(label, pad, h - pad, Math.round(w * 0.6)) // maxWidth 压扁超长歌名而非溢出
    }
    ctx.textAlign = 'right'
    ctx.fillText('AUDELYRA', w - pad, h - pad)
    ctx.restore()
  }
}
