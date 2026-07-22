// 自定义形状创建的输入侧（idea #12）：格式判定/解码降采样/失败文案。
// 纯函数与 DOM 流程分开——isSupportedImage/needsConvert/ingestErrorText 可 node 单测。
export type IngestError = 'unsupported' | 'dark' | 'empty' | 'failed'

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif)$/i
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|heic|heif)$/
const HEIC_EXT = /\.(heic|heif)$/i
const HEIC_MIME = /^image\/hei[cf]$/

export const CUSTOM_IMAGE_MAX_PX = 512 // 封面 MAX_COVER_PX 同值：对采样无收益的分辨率不落盘

export function isSupportedImage(name: string, mime: string): boolean {
  return IMAGE_MIME.test(mime) || IMAGE_EXT.test(name)
}

export function needsConvert(name: string, mime: string): boolean {
  return HEIC_MIME.test(mime) || HEIC_EXT.test(name)
}

export function ingestErrorText(reason: IngestError): string {
  switch (reason) {
    case 'unsupported': return '只支持图片（PNG/JPG/WebP/GIF/HEIC）'
    case 'dark': return '这张图太暗，拼不出形状'
    case 'empty': return '这张图太空，拼不出形状'
    case 'failed': return '创建失败，换张图试试'
  }
}

/** File → 采样像素 + 落盘 png（≤512px）。HEIC 先经主进程 sips 转 PNG（convert 注入，失败上抛） */
export async function decodeImageFile(
  file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> },
  convert: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<{ imageData: ImageData; png: Blob }> {
  let bytes = new Uint8Array(await file.arrayBuffer())
  if (needsConvert(file.name, file.type)) bytes = new Uint8Array(await convert(bytes))
  const url = URL.createObjectURL(new Blob([bytes]))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, CUSTOM_IMAGE_MAX_PX / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const png = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png'))
    return { imageData, png }
  } finally {
    URL.revokeObjectURL(url)
  }
}
