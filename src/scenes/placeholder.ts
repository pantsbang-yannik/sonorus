import type { Scene, SceneContext } from './types'
import type { Signals } from '../engine/types'
import { EnvelopeFollower } from './shared/motion'

export function createPlaceholderScene(): Scene {
  let ctx2d: CanvasRenderingContext2D | null = null
  let canvas: HTMLCanvasElement | null = null
  const loud = new EnvelopeFollower(0.08, 0.4)

  return {
    init(ctx: SceneContext) {
      canvas = ctx.canvas
      canvas.width = window.innerWidth * devicePixelRatio
      canvas.height = window.innerHeight * devicePixelRatio
      ctx2d = canvas.getContext('2d')
      if (!ctx2d) {
        // canvas 已被 webgpu/webgl 上下文占用——静默黑屏不可接受，显式失败给 host 诊断
        throw new Error('placeholder: canvas 已被 GPU 上下文占用，无法获取 2d 上下文')
      }
    },
    update(dt: number, s: Signals | null) {
      if (!ctx2d || !canvas) return
      const { width: w, height: h } = canvas
      ctx2d.fillStyle = '#000'
      ctx2d.fillRect(0, 0, w, h)
      const v = loud.update(s?.loudness.smooth ?? 0, dt)
      ctx2d.beginPath()
      ctx2d.arc(w / 2, h / 2, h * (0.05 + v * 0.25), 0, Math.PI * 2)
      ctx2d.strokeStyle = 'rgba(120,130,255,0.5)'
      ctx2d.lineWidth = 2
      ctx2d.stroke()
    },
    onTrackChange() {},
    resize(w: number, h: number) {
      if (!canvas) return
      canvas.width = w * devicePixelRatio
      canvas.height = h * devicePixelRatio
    },
    dispose() {
      ctx2d = null
    }
  }
}
