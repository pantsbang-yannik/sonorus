import type { PixelSource } from '../nebula/cover-points'

export interface RGB { r: number; g: number; b: number }
export interface OKLCH { l: number; c: number; h: number }
export interface MoodPalette { primary: RGB; deep: RGB; highlight: RGB }

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function srgbToOklch(rgb: RGB): OKLCH {
  const r = toLinear(rgb.r), g = toLinear(rgb.g), b = toLinear(rgb.b)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.hypot(a, bb)
  let h = (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

export function oklchToSrgb(lch: OKLCH): RGB {
  const hRad = (lch.h * Math.PI) / 180
  const a = lch.c * Math.cos(hRad)
  const b = lch.c * Math.sin(hRad)
  const l_ = Math.pow(lch.l + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m_ = Math.pow(lch.l - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s_ = Math.pow(lch.l - 0.0894841775 * a - 1.291485548 * b, 3)
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  return { r: clamp01(toSrgb(r)), g: clamp01(toSrgb(g)), b: clamp01(toSrgb(bl)) }
}

export function extractDominant(img: PixelSource): RGB {
  // 评审修订：纯计票下深底封面的最大桶是近黑（色相无意义 → 全灰调色板，"千歌千面"失效）。
  // 改为：跳过近黑/近白像素 + 彩度加权计票，深底封面提取的是主题色而非背景
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>()
  const step = Math.max(1, Math.floor((img.width * img.height) / 4096)) // 大图下采样
  for (let i = 0; i < img.width * img.height; i += step) {
    const o = i * 4
    if (img.data[o + 3] < 128) continue
    const r = img.data[o] / 255, g = img.data[o + 1] / 255, b = img.data[o + 2] / 255
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (lum < 0.15 || lum > 0.92) continue // 近黑/近白不携带可用色相
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const w = 0.2 + chroma * 3
    const key = (img.data[o] >> 6) * 16 + (img.data[o + 1] >> 6) * 4 + (img.data[o + 2] >> 6)
    const e = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 }
    e.w += w; e.r += r * w; e.g += g * w; e.b += b * w
    buckets.set(key, e)
  }
  let best: { w: number; r: number; g: number; b: number } | null = null
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e
  if (!best) return { r: 0.35, g: 0.42, b: 1.0 } // 全图无可用色相 → 默认冷色骨架
  return { r: best.r / best.w, g: best.g / best.w, b: best.b / best.w }
}

/** 调色台铁律：封面给色相倾向，明度/饱和度锁进预设计窗口 */
export function remapToMood(dominant: RGB): MoodPalette {
  const src = srgbToOklch(dominant)
  const c = Math.min(src.c, 0.13)
  return {
    primary: oklchToSrgb({ l: Math.min(0.75, Math.max(0.55, src.l)), c, h: src.h }),
    deep: oklchToSrgb({ l: 0.28, c: c * 0.8, h: (src.h - 15 + 360) % 360 }),
    highlight: oklchToSrgb({ l: 0.92, c: Math.min(c, 0.05), h: src.h })
  }
}
