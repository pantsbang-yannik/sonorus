// 本地音频文件识别:MIME 优先(audio/* 全认,Chromium 能吞的都在里面),
// 扩展名兜底(Finder 拖入偶发空 MIME)。列表 = Chromium 可解码格式,不含 wma/ape 等播不了的
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm'])

export function isSupportedAudio(name: string, mime: string): boolean {
  if (mime.startsWith('audio/')) return true
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTS.has(name.slice(dot + 1).toLowerCase())
}

/** 控制条/海报落款用的展示名:去扩展名;`.hidden` 这类点起头的名字不切成空串 */
export function displayName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
