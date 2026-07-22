// 背景输入侧（自定义背景 v1 图片 + v2 视频）：与形状 ingest（custom-shape-ingest.ts）同骨架，降采样档不同——
// 背景要全屏清晰，长边 ≤2560 存 JPEG（无 alpha 需求，控制磁盘占用）；不做太暗/太空可用性校验
// （纯色图也是合法背景）。纯函数与 DOM 流程分开，backgroundTargetSize/isSupportedVideo 可 node 单测；
// captureVideoThumb 是 DOM 流程，node 环境测不了。
import { needsConvert } from './custom-shape-ingest'
import { BACKGROUND_VIDEO_EXTS } from '../scenes/nebula/background-types'

export const BACKGROUND_IMAGE_MAX_PX = 2560
const JPEG_QUALITY = 0.9

/** 降采样目标尺寸：长边超限等比缩到 2560；不放大小图；钳 ≥1 防 0 尺寸除零 */
export function backgroundTargetSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, BACKGROUND_IMAGE_MAX_PX / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** File → 降采样 JPEG。HEIC 先经主进程 sips 转 PNG（convert 注入，复用 customShapes:convert，失败上抛） */
export async function decodeBackgroundFile(
  file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> },
  convert: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<{ jpeg: Blob }> {
  let bytes = new Uint8Array(await file.arrayBuffer())
  if (needsConvert(file.name, file.type)) bytes = new Uint8Array(await convert(bytes))
  const url = URL.createObjectURL(new Blob([bytes]))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const { w, h } = backgroundTargetSize(img.width, img.height)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, w, h)
    const jpeg = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', JPEG_QUALITY))
    return { jpeg }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ===== 视频背景 v2 =====

const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm']
const THUMB_MAX_PX = 512
const THUMB_JPEG_QUALITY = 0.8

/** 视频容器白名单判别（纯函数）：扩展名或 MIME 命中即真。白名单外的 video/* MIME（如 avi）
 * 一律拒——Chromium 未必硬解，拒收好过入库后黑屏 */
export function isSupportedVideo(name: string, mime: string): boolean {
  if (VIDEO_MIMES.includes(mime.toLowerCase())) return true
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return (BACKGROUND_VIDEO_EXTS as readonly string[]).includes(ext)
}

/** 首帧缩略图（视频卡显示用）：loadeddata 即有首帧可画，不 seek（首帧即 spec 要求）。
 * 失败上抛，调用方不阻断入库（缩略图缺失=卡片占位剪影兜底）。成败都释放解码器防泄漏 */
export async function captureVideoThumb(url: string): Promise<{ jpeg: Blob }> {
  const video = document.createElement('video')
  video.muted = true
  video.src = url
  try {
    await new Promise<void>((res, rej) => {
      video.addEventListener('loadeddata', () => res(), { once: true })
      video.addEventListener('error', () => rej(new Error('video decode failed')), { once: true })
    })
    // 亲验缺陷修：loadeddata 直画常得黑帧（视频黑场淡入开头 + 硬解首帧未必已可抽）——
    // seek 到 0.5s（短片钳到时长一半）等 seeked 再画，取有内容的代表帧
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
    await new Promise<void>((res) => video.addEventListener('seeked', () => res(), { once: true }))
    const scale = Math.min(1, THUMB_MAX_PX / Math.max(video.videoWidth, video.videoHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', THUMB_JPEG_QUALITY))
    return { jpeg }
  } finally {
    video.removeAttribute('src')
    video.load() // 释放解码器（同 user-backdrop releaseVideo 惯例）
  }
}
