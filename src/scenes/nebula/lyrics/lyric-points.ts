// 单行歌词→点云（spec §5.5）。像素源→采样复用 title-points 的 sampleTitlePoints；
// 本文件只做单行画布渲染（DOM，不进单测）+ padPositions 护栏纯函数（测）。
import type { PixelSource } from '../cover-points'

export const LYRIC_CANVAS_W = 1024
export const LYRIC_CANVAS_H = 192
/** 单行歌词世界宽度（歌名 2.4）；高按画布纵横比 192/1024 折算。
 * 亲验反馈「太窄」放宽 2.6→4.0：默认机位（z=3.0 fov58 16:9）可视宽约 5.9，4.0 留有安全边距 */
export const LYRIC_WORLD_WIDTH = 4.0

/** 点云长度护栏（还一期 title-particles.setCloud 契约注释的账）：
 * 超长截断；偏短用首点补齐——补首点而非补零，避免尾部粒子聚成原点亮斑 */
export function padPositions(positions: Float32Array, capacity: number): Float32Array {
  const need = capacity * 3
  if (positions.length === need) return positions
  const out = new Float32Array(need) // 默认 0：空输入时全零
  out.set(positions.subarray(0, Math.min(positions.length, need)))
  if (positions.length >= 3 && positions.length < need) {
    for (let i = positions.length; i < need; i += 3) {
      out[i] = positions[0]
      out[i + 1] = positions[1]
      out[i + 2] = positions[2]
    }
  }
  return out
}

/** 单行白字离屏画布：120px 起步、超长整体缩号保单行（下限 40）。
 * 无 DOM/拿不到 2d 上下文返回 null（场景侧 cancel 兜底，先例 renderTitleImage） */
export function renderLyricLine(text: string): PixelSource | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = LYRIC_CANVAS_W
  canvas.height = LYRIC_CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, LYRIC_CANVAS_W, LYRIC_CANVAS_H)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let px = 120
  ctx.font = `600 ${px}px "PingFang SC", "Helvetica Neue", sans-serif`
  const w = ctx.measureText(text).width
  if (w > LYRIC_CANVAS_W * 0.92) {
    px = Math.max(40, Math.floor(px * (LYRIC_CANVAS_W * 0.92) / w))
    ctx.font = `600 ${px}px "PingFang SC", "Helvetica Neue", sans-serif`
  }
  ctx.fillText(text, LYRIC_CANVAS_W / 2, LYRIC_CANVAS_H / 2)
  return ctx.getImageData(0, 0, LYRIC_CANVAS_W, LYRIC_CANVAS_H)
}
