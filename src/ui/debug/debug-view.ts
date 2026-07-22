import type { Signals } from '../../engine/types'
import { NarrativeTracker } from '../../engine/narrative'

export class DebugView {
  private ctx: CanvasRenderingContext2D
  private latest: Signals | null = null
  private beatFlash = 0
  private dropFlash = 0
  private trackText = 'track: unknown'
  private artwork: HTMLImageElement | null = null
  // 叙事态自跑一个 tracker：DebugView 只收 Signals（叙事不进契约），从 s.t 差分还原 dt
  private narr = new NarrativeTracker()
  private narrText = 'narr=steady(0.00)'
  private lastT: number | null = null

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    const resize = (): void => {
      canvas.width = window.innerWidth * devicePixelRatio
      canvas.height = window.innerHeight * devicePixelRatio
    }
    window.addEventListener('resize', resize)
    resize()
    requestAnimationFrame(this.frame)
  }

  setTrack(title: string, artist: string, artworkDataUrl: string | null): void {
    this.trackText = artist ? `track: ${title} — ${artist}` : `track: ${title}`
    this.artwork = null // 先清空，防止解码期间显示上一首的封面
    if (artworkDataUrl) {
      const img = new Image()
      // onload 异步：仅当没被更新的 setTrack 抢先时才生效
      img.onload = () => {
        if (this.trackText.startsWith(`track: ${title}`)) this.artwork = img
      }
      img.src = artworkDataUrl
    }
  }

  update(s: Signals): void {
    this.latest = s
    const dt = this.lastT === null ? 1024 / 48000 : Math.max(s.t - this.lastT, 1e-4)
    this.lastT = s.t
    const n = this.narr.update(dt, { energy: s.energy, drop: s.drop, silence: s.silence })
    this.narrText = `narr=${n.phase}(${n.progress.toFixed(2)})`
    if (s.beat.onBeat) this.beatFlash = 1
    if (s.drop) this.dropFlash = 1
  }

  private frame = (): void => {
    const { ctx, canvas } = this
    const w = canvas.width, h = canvas.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const s = this.latest
    if (s) {
      // 三段频带柱
      const bands = [s.bands.low, s.bands.mid, s.bands.high]
      const colors = ['#4a7dff', '#9a6bff', '#ff6be8']
      bands.forEach((v, i) => {
        const bh = Math.min(1, v * 8) * h * 0.5
        ctx.fillStyle = colors[i]
        ctx.fillRect(w * (0.25 + i * 0.18), h * 0.75 - bh, w * 0.1, bh)
      })
      // 中心脉冲圆：半径随平滑响度，鼓点闪白，drop 撑满
      this.beatFlash *= 0.9
      this.dropFlash *= 0.96
      const r = h * (0.06 + s.loudness.smooth * 0.5 + this.dropFlash * 0.3)
      ctx.beginPath()
      ctx.arc(w / 2, h * 0.4, r, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + this.beatFlash * 0.7})`
      ctx.lineWidth = 2 + this.beatFlash * 10
      ctx.stroke()
      // 文本
      ctx.fillStyle = '#888'
      ctx.font = `${14 * devicePixelRatio}px monospace`
      ctx.fillText(
        `bpm=${s.bpm ?? '--'} energy=${s.energy.toFixed(2)} ` +
        `silence=${s.silence} loud=${s.loudness.smooth.toFixed(3)} ${this.narrText}`,
        20, 30 * devicePixelRatio
      )
      ctx.fillText(this.trackText, 20, 55 * devicePixelRatio)
      if (this.artwork) {
        const size = 200 * devicePixelRatio
        ctx.drawImage(this.artwork, w - size - 20 * devicePixelRatio, 20 * devicePixelRatio, size, size)
      }
    } else {
      ctx.fillStyle = '#444'
      ctx.font = `${16 * devicePixelRatio}px monospace`
      ctx.fillText('等待音频…（请播放音乐；首次需允许系统音频录制权限）', 20, 40)
    }
    requestAnimationFrame(this.frame)
  }
}
