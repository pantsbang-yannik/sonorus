// 自定义形状（idea #12）的输入侧纯函数：图像可用性检查 + 自定义文字光栅化。
// 采样本身零新代码——图复用 sampleCoverPoints（彩色浮雕）、文字复用 sampleTitlePoints（情绪三色）。
import type { PixelSource } from './cover-points'
import { wrapTitleLines } from '../shared/wrap-lines'

export const CUSTOM_TEXT_CANVAS_W = 1024
export const CUSTOM_TEXT_CANVAS_H = 512 // 两行大字：高于歌名画布（320），行高×2+边距

const ALPHA_LIT = 128 // 与 title-points 同阈值
const EMPTY_FRACTION = 0.02 // 不透明像素占比 <2% = 拼不出东西
const DARK_LUM = 0.05 // 最亮不透明像素的相对亮度 <0.05 = 浮雕全平且全黑

/** 全黑/全透明图创建前拦截（spec 边界）：empty=太空、dark=太暗。
 * 亮度用 sRGB 字节近似（0..1 线性加权），只做门槛判定不追色度精确 */
export function checkImageUsable(img: PixelSource): 'ok' | 'dark' | 'empty' {
  const total = img.width * img.height
  let opaque = 0
  let maxLum = 0
  for (let i = 0; i < total; i++) {
    const o = i * 4
    if (img.data[o + 3] <= ALPHA_LIT) continue
    opaque++
    const lum = (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]) / 255
    if (lum > maxLum) maxLum = lum
  }
  if (opaque < total * EMPTY_FRACTION) return 'empty'
  if (maxLum < DARK_LUM) return 'dark'
  return 'ok'
}

/** 自适应字号断行（fb1 修复：缩字号必须先于省略号判定，否则 30 字内的输入会被误截断）。
 * 从 maxPx 起尝试断行；只要 wrapTitleLines 的结果不带省略号（两行能完整装下）就直接返回，
 * 否则降字号重排，直到装下或触底 minPx——minPx 下两行容量远超输入框上限，省略号只在触底兜底时出现。
 * 快路径不变：短文本第一轮（maxPx）就 fits，wrapTitleLines 直接单行返回。 */
export function fitTextLines(
  text: string,
  measure: (s: string, px: number) => number,
  opts: { maxW: number; maxPx: number; minPx: number }
): { px: number; lines: string[] } {
  const { maxW, maxPx, minPx } = opts
  let px = maxPx
  for (;;) {
    const lines = wrapTitleLines(text, (s) => measure(s, px) <= maxW)
    const truncated = lines.some((l) => l.endsWith('…'))
    if (!truncated || px <= minPx) return { px, lines }
    px = Math.max(minPx, Math.floor(px * 0.85))
  }
}

/** 自定义文字光栅化：白字、最多两行（复用海报 fb4 断行：英文空格优先/emoji 安全/超两行省略号），
 * 缩字号先于省略号判定（fitTextLines，下限 36）——输入框已限 30 字，minPx 下两行容量约 50 字，
 * 实际用户输入必然完整显示，省略号只在触底兜底时出现。无 DOM/拿不到 2d 上下文返回 null（场景侧回退 free） */
export function renderCustomTextImage(text: string): PixelSource | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = CUSTOM_TEXT_CANVAS_W
  canvas.height = CUSTOM_TEXT_CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const maxW = CUSTOM_TEXT_CANVAS_W * 0.9
  const font = (px: number): string => `600 ${px}px "PingFang SC", "Helvetica Neue", sans-serif`
  const { px, lines } = fitTextLines(text.trim(), (s, p) => {
    ctx.font = font(p)
    return ctx.measureText(s).width
  }, { maxW, maxPx: 148, minPx: 36 })
  ctx.clearRect(0, 0, CUSTOM_TEXT_CANVAS_W, CUSTOM_TEXT_CANVAS_H)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(px)
  const lineH = px * 1.3
  const y0 = CUSTOM_TEXT_CANVAS_H / 2 - ((lines.length - 1) * lineH) / 2
  lines.forEach((line, i) => ctx.fillText(line, CUSTOM_TEXT_CANVAS_W / 2, y0 + i * lineH))
  return ctx.getImageData(0, 0, CUSTOM_TEXT_CANVAS_W, CUSTOM_TEXT_CANVAS_H)
}
