// 文字→粒子点云（切歌拼字，spec 2026-07-12-sonorus-particle-title-design §5.2）。
// 与封面同一套路：像素源→采样点云。renderTitleImage 是 DOM 画布部分（node 单测不覆盖，
// 返回 null 的降级路径由场景侧 cancel 兜底）；sampleTitlePoints 是纯函数（可测）。
import { hash01, type PixelSource, type ShapePointCloud } from './cover-points'

export const TITLE_CANVAS_W = 1024
export const TITLE_CANVAS_H = 320

const ALPHA_LIT = 128 // 亮像素判定：文字白字实心 alpha=255，抗锯齿边缘减半即弃

/** 亮像素采样：count 个点均匀散布在文字笔画上（确定性伪随机，同曲重采样逐位稳定） */
export function sampleTitlePoints(
  img: PixelSource, count: number, opts: { worldWidth?: number; depth?: number } = {}
): ShapePointCloud | null {
  const worldWidth = opts.worldWidth ?? 2.4
  const depth = opts.depth ?? 0.06
  // 收集亮像素（y*w+x 线性索引）
  const lit: number[] = []
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.data[i * 4 + 3] > ALPHA_LIT) lit.push(i)
  }
  if (lit.length === 0) return null
  const positions = new Float32Array(count * 3)
  const sx = worldWidth
  const sy = worldWidth * (img.height / img.width) // 保纵横比
  for (let i = 0; i < count; i++) {
    const p = lit[Math.floor(hash01(i * 127.1) * lit.length) % lit.length]
    const px = p % img.width
    const py = Math.floor(p / img.width)
    // 像素中心 + 亚像素抖动（±半像素），破网格感
    const u = (px + 0.5 + (hash01(i * 311.7) - 0.5)) / img.width
    const v = (py + 0.5 + (hash01(i * 74.7) - 0.5)) / img.height
    positions[i * 3] = (u - 0.5) * sx
    positions[i * 3 + 1] = (0.5 - v) * sy // 图像 y 向下 → 世界 y 向上
    positions[i * 3 + 2] = (hash01(i * 269.5) - 0.5) * depth
  }
  return { positions }
}

/** 两行白字渲染到离屏画布：歌名大字在上、演唱者小字在下（artist 空则单行居中）。
 * 超长歌名整体缩字号保单行。无 DOM/拿不到 2d 上下文返回 null（场景侧静默放弃本次拼字）。 */
export function renderTitleImage(title: string, artist: string): PixelSource | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = TITLE_CANVAS_W
  canvas.height = TITLE_CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, TITLE_CANVAS_W, TITLE_CANVAS_H)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fit = (text: string, px: number, weight: number): number => {
    ctx.font = `${weight} ${px}px "PingFang SC", "Helvetica Neue", sans-serif`
    const w = ctx.measureText(text).width
    if (w <= TITLE_CANVAS_W * 0.9) return px
    return Math.max(36, Math.floor(px * (TITLE_CANVAS_W * 0.9) / w))
  }
  const hasArtist = artist.trim() !== ''
  const titlePx = fit(title, 104, 600)
  ctx.font = `600 ${titlePx}px "PingFang SC", "Helvetica Neue", sans-serif`
  ctx.fillText(title, TITLE_CANVAS_W / 2, TITLE_CANVAS_H * (hasArtist ? 0.36 : 0.5))
  if (hasArtist) {
    const artistPx = fit(artist, 44, 400)
    ctx.font = `400 ${artistPx}px "PingFang SC", "Helvetica Neue", sans-serif`
    ctx.fillText(artist, TITLE_CANVAS_W / 2, TITLE_CANVAS_H * 0.76)
  }
  return ctx.getImageData(0, 0, TITLE_CANVAS_W, TITLE_CANVAS_H)
}
