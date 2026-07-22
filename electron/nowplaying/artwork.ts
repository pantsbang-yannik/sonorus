/**
 * 封面 MIME 判定：优先信任系统上报（media-control payload 的 artworkMimeType 字段，
 * 直接来自 macOS MediaRemote），只有系统没给出时才按魔数兜底嗅探。
 *
 * 兜底嗅探只覆盖最常见的 JPEG/PNG 两种——HEIC/WEBP 等格式会被误标成 image/png，
 * 渲染层 `<img>.decode()` 会因声明格式与实际字节不符而失败（见 cover-loader.ts
 * 换歌 decode 失败时的降级处理）。优先用系统上报值可以从源头减少踩中这条失败路径。
 */
export function resolveArtworkMime(bytes: Buffer, reportedMime: string | null): string {
  if (reportedMime && /^image\/[\w.+-]+$/i.test(reportedMime)) return reportedMime
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png'
}
