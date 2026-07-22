// 星图海报（idea #6）：竖版排版——RT 竖构图主图 + 歌名/歌手/时间戳 + 能量声纹条 + 字标。
// 纯逻辑（排版几何/文件名/环形缓冲）与 canvas 绘制分离：前者单测，后者亲验（先例 TSL 教训）。
import { wrapTitleLines } from '../scenes/shared/wrap-lines'

// ===== 排版常量（亲验旋钮，收敛改这里）=====
// fb3 拍板：尺寸改小红书 3:4；排版三原则=简约/留白/大小对比（歌名大而重、辅助信息小而淡、声纹通栏细线）
export const POSTER_W = 1242
export const POSTER_H = 1656 // 3:4，小红书标准竖图
/** 主图带最大高：主图=屏幕原样（fb1 所见即所得拍板），比例随窗口——近方/竖窗时封顶此高，等比缩宽居中 */
export const IMAGE_MAX_H = 1000
const PAD_X = 112         // 文字区左右留白（留白原则：比 fb1 版更慷慨）
const TITLE_GAP = 72      // 文字栈与主图的最小间距（栈居中放不下时回落此值；亲验 fb①：落款两行化后从版式空隙里调剂让出高度，比 fb3 版略收）
const TITLE_LINE_H = 120  // 歌名单行行高（字号 92，大小对比的"大"；fb4：最多两行，超两行省略号）
const META_GAP = 20
const META_LINE_H = 46    // 歌手/日期每行行高（字号 34，行距≈1.4 倍；亲验 fb①：落款两行化——歌手超长串+日期挤一行顶边缘，拆两行）
const RIBBON_GAP = 44     // 亲验 fb①：同上，调剂给两行 meta
const RIBBON_H = 72       // 声纹条高（细线化）
const BRAND_H = 36        // SONORUS 字标行高
const BRAND_BOTTOM = 76   // 字标锚定离底距离（主图高度随窗口变，字标钉底保版式稳定；亲验 fb①：同上，调剂给两行 meta）
const BG_COLOR = '#05070c'          // 深空底色（与场景背景同族）
const TITLE_COLOR = 'rgba(255, 255, 255, 0.95)'
const META_COLOR = 'rgba(255, 255, 255, 0.45)'
const RIBBON_COLOR = 'rgba(255, 255, 255, 0.35)'
const BRAND_COLOR = 'rgba(255, 255, 255, 0.28)'
const FONT_STACK = `-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`

// ===== 能量声纹环形缓冲（唯一常驻状态：600 桶 × 100ms = 最近 60s）=====
export const RIBBON_BUCKET_MS = 100
export const RIBBON_CAPACITY = 600

export interface Rect { x: number; y: number; w: number; h: number }

/** 排版几何（纯函数）：主图带按截图比例顶置（宽优先铺满、超高封顶居中），
 * title→meta→ribbon 顺流其下，brand 钉底。imageAspect = 截图 w/h（随窗口变）；
 * titleLines = 歌名实际行数（1|2，fb4），title 区高随之伸缩、文字栈居中自动适配；
 * metaLines = 落款行数（1=仅日期即 unknown 态，2=歌手+日期，亲验 fb①），meta 区高同理伸缩 */
export function layoutPoster(imageAspect: number, titleLines = 1, metaLines = 1): { image: Rect; title: Rect; meta: Rect; ribbon: Rect; brand: Rect } {
  const a = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 16 / 10 // 脏输入回默认窗口比例
  let w = POSTER_W
  let h = Math.round(w / a)
  if (h > IMAGE_MAX_H) {
    h = IMAGE_MAX_H
    w = Math.round(h * a)
  }
  const image = { x: Math.round((POSTER_W - w) / 2), y: 0, w, h }
  const textW = POSTER_W - PAD_X * 2
  const brand = { x: PAD_X, y: POSTER_H - BRAND_BOTTOM - BRAND_H, w: textW, h: BRAND_H }
  const titleH = TITLE_LINE_H * Math.min(Math.max(Math.round(titleLines), 1), 2)
  const metaH = META_LINE_H * Math.min(Math.max(Math.round(metaLines), 1), 2)
  // 文字栈（title/meta/ribbon）在主图底与字标顶之间垂直居中（聚焦审#4：16:9 全屏主图矮，
  // 顺流排会头重脚轻留 40% 空白；居中让留白对称）。竖窗空间紧时回落最小间距顺流排
  const stackH = titleH + META_GAP + metaH + RIBBON_GAP + RIBBON_H
  const offset = Math.max(TITLE_GAP, Math.round((brand.y - image.h - stackH) / 2))
  const title = { x: PAD_X, y: image.h + offset, w: textW, h: titleH }
  const meta = { x: PAD_X, y: title.y + title.h + META_GAP, w: textW, h: metaH }
  const ribbon = { x: PAD_X, y: meta.y + meta.h + RIBBON_GAP, w: textW, h: RIBBON_H }
  return { image, title, meta, ribbon, brand }
}

/** 下载文件名：`Sonorus-<title|untitled>-<yyyyMMdd-HHmmss>.png`，清洗非法字符、超长截断 */
export function posterFilename(title: string, now: Date): string {
  const safe = title.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'untitled'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `Sonorus-${safe}-${stamp}.png`
}

export { wrapTitleLines } from '../scenes/shared/wrap-lines'

/** 海报落款日期（中文，本地时区） */
export function formatPosterDate(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${p(now.getHours())}:${p(now.getMinutes())}`
}

/** 单行超长截断（亲验 fb①：歌手多人串如 "A/B/C" 顶版式边缘）：量得下原样返回，
 * 否则逐字符缩短直到「截断串 + …」量得下——量级小不必二分，逐字符足够快 */
export function truncateToFit(text: string, fits: (s: string) => boolean): string {
  if (fits(text)) return text
  const chars = [...text]
  while (chars.length > 1 && !fits(chars.join('') + '…')) chars.pop()
  return chars.join('') + '…'
}

/** 最近 60s 能量折线的定长降采样缓冲（push+splice 定长数组）：同桶取峰值（drop 不被抹平）、
 * 跳桶补 0（静默可见）、超容量丢最旧 */
export class EnergyRibbon {
  private buckets: number[] = []
  private lastBucket: number | null = null

  push(value: number, nowMs: number): void {
    const v = Math.min(1, Math.max(0, value))
    const b = Math.floor(nowMs / RIBBON_BUCKET_MS)
    // 断流超一屏（采集重启/系统睡眠回来）：老数据反正全会被挤掉，清空重起——
    // 否则补 0 循环一次要 push 数十万个（双审②P2：主线程尖刺且理论无界）
    if (this.lastBucket !== null && b - this.lastBucket > RIBBON_CAPACITY) {
      this.buckets = []
      this.lastBucket = null
    }
    if (this.lastBucket !== null && b === this.lastBucket) {
      const i = this.buckets.length - 1
      this.buckets[i] = Math.max(this.buckets[i], v)
    } else {
      if (this.lastBucket !== null) {
        for (let gap = this.lastBucket + 1; gap < b; gap++) this.buckets.push(0)
      }
      this.buckets.push(v)
      this.lastBucket = b
    }
    if (this.buckets.length > RIBBON_CAPACITY) this.buckets.splice(0, this.buckets.length - RIBBON_CAPACITY)
  }

  values(): number[] {
    return [...this.buckets]
  }
}

export interface PosterMeta { title: string; artist: string }

/** 合成海报（canvas 绘制，亲验收口）：mainImage=屏幕原样截图（fb1），按其比例定主图带并缩放绘入。
 * meta=null（unknown 态）：歌名/歌手留空，落款只有时间戳。 */
export async function composePoster(
  mainImage: ImageData,
  meta: PosterMeta | null,
  ribbonValues: number[],
  now: Date
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_W
  canvas.height = POSTER_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('poster: 2d context 不可用')
  ctx.imageSmoothingQuality = 'high' // retina 全屏截图缩 ~4 倍，默认 low 损失星点细部（聚焦审建议）

  // 歌名先断行再排版（行数决定 title 区高）；宽度上限 = 文字区宽（与 layout 的 textW 同源常量）
  ctx.font = `600 92px ${FONT_STACK}`
  const titleMaxW = POSTER_W - PAD_X * 2
  const titleLines = meta ? wrapTitleLines(meta.title, (s) => ctx.measureText(s).width <= titleMaxW) : []
  const L = layoutPoster(mainImage.width / mainImage.height, Math.max(titleLines.length, 1), meta ? 2 : 1)

  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, POSTER_W, POSTER_H)

  // 主图：经临时 canvas 走 drawImage（putImageData 不缩放且无视合成，尺寸不符会破版）
  const src = document.createElement('canvas')
  src.width = mainImage.width
  src.height = mainImage.height
  src.getContext('2d')!.putImageData(mainImage, 0, 0)
  ctx.drawImage(src, L.image.x, L.image.y, L.image.w, L.image.h)

  // 歌名（大小对比的"大"：92px/600；fb4 最多两行，wrapTitleLines 已断好行）
  if (titleLines.length) {
    ctx.fillStyle = TITLE_COLOR
    ctx.font = `600 92px ${FONT_STACK}`
    ctx.textBaseline = 'top'
    titleLines.forEach((line, i) => ctx.fillText(line, L.title.x, L.title.y + i * (L.title.h / titleLines.length)))
  }

  // 歌手 / 日期（大小对比的"小"；亲验 fb①：两行落款——歌手一行超长省略号截断、日期独立一行；
  // 从未有过曲目时只有日期一行，语义不变）
  ctx.fillStyle = META_COLOR
  ctx.font = `400 34px ${FONT_STACK}`
  ctx.textBaseline = 'top'
  const dateStr = formatPosterDate(now)
  if (meta) {
    const artistLine = truncateToFit(meta.artist, (s) => ctx.measureText(s).width <= titleMaxW)
    ctx.fillText(artistLine, L.meta.x, L.meta.y)
    ctx.fillText(dateStr, L.meta.x, L.meta.y + META_LINE_H)
  } else {
    ctx.fillText(dateStr, L.meta.x, L.meta.y)
  }

  // 能量声纹折线（无数据跳过）：按现有点数横向铺满整条（fb3——固定时间轴会让开播不久的波形缩在左角）
  if (ribbonValues.length > 1) {
    ctx.strokeStyle = RIBBON_COLOR
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const stepX = L.ribbon.w / (ribbonValues.length - 1)
    for (let i = 0; i < ribbonValues.length; i++) {
      const x = L.ribbon.x + i * stepX
      const y = L.ribbon.y + L.ribbon.h - ribbonValues[i] * L.ribbon.h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // 字标（居中、疏排、更轻）
  ctx.fillStyle = BRAND_COLOR
  ctx.font = `500 28px ${FONT_STACK}`
  ctx.textBaseline = 'top'
  const brand = 'S O N O R U S'
  ctx.fillText(brand, L.brand.x + (L.brand.w - ctx.measureText(brand).width) / 2, L.brand.y)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster: toBlob 失败'))), 'image/png')
  })
}
