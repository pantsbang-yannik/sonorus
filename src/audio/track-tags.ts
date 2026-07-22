// 本地文件标签解析（V2）：music-metadata parseBlob 包装 + 纯映射。
// 门控哲学：title+artist 都有才算"有标签"（tagged）——无标签的文件只展示文件名、不进历史/星系。
import { parseBlob, type IAudioMetadata } from 'music-metadata'

export interface TrackTags {
  title: string
  artist: string
  duration: number | null
  coverBytes: Uint8Array | null
  coverMime: string | null
  coverDataUrl: string | null
}

/** 纯映射可测：metadata → TrackTags | null（null=无标签） */
export function tagsFromMetadata(m: Pick<IAudioMetadata, 'common' | 'format'>): TrackTags | null {
  const title = m.common.title?.trim()
  const artist = (m.common.artist ?? m.common.artists?.[0])?.trim()
  if (!title || !artist) return null
  const pic = m.common.picture?.[0] ?? null
  const coverBytes = pic ? new Uint8Array(pic.data) : null
  const coverMime = pic ? (pic.format || 'image/jpeg') : null
  return {
    title,
    artist,
    duration: typeof m.format.duration === 'number' && Number.isFinite(m.format.duration) ? m.format.duration : null,
    coverBytes,
    coverMime,
    coverDataUrl: coverBytes && coverMime ? bytesToDataUrl(coverBytes, coverMime) : null
  }
}

/** 封面字节 → data url。分块拼串防大封面撑爆调用栈（String.fromCharCode 展开参数有上限） */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(bin)}`
}

/** 解析失败/不支持的容器 → null 静默（标签是增强不是主体，播不播得了归 <audio> 管） */
export async function readTags(file: File): Promise<TrackTags | null> {
  try {
    return tagsFromMetadata(await parseBlob(file))
  } catch {
    return null
  }
}
