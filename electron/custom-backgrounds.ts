// 自定义背景图片仓库（自定义背景 v1）：userData/backgrounds/<uuid>.jpg（渲染层已降采样长边≤2560 转 JPEG）。
// IPC 入参不可信：uuid 正则白名单是 id 拼进路径的唯一防线（custom-shapes 同哲学）。
import { join, extname } from 'node:path'
import { mkdir, readFile, writeFile, rename, unlink, copyFile, stat } from 'node:fs/promises'
import { CUSTOM_BG_ID_RE, BACKGROUND_VIDEO_EXTS, BACKGROUND_VIDEO_MAX_BYTES } from '../src/scenes/nebula/background-types'

function assertCustomBackgroundId(id: string): void {
  if (!CUSTOM_BG_ID_RE.test(id)) throw new Error(`unknown custom background id: ${id}`)
}

export function customBackgroundPath(dir: string, id: string): string {
  assertCustomBackgroundId(id)
  return join(dir, `${id}.jpg`)
}

/** tmp+rename 原子写（custom-shapes 同惯例）：写一半崩溃不留半张图 */
export async function saveCustomBackgroundJpeg(dir: string, id: string, jpeg: Uint8Array): Promise<void> {
  const file = customBackgroundPath(dir, id)
  await mkdir(dir, { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, Buffer.from(jpeg))
  await rename(tmp, file)
}

export async function readCustomBackgroundJpeg(dir: string, id: string): Promise<Buffer> {
  return readFile(customBackgroundPath(dir, id))
}

// ===== 视频背景 v2：拷原件落盘 + 候选解析（一个 id 只会有一种主文件，jpg 或某视频容器）=====

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
}
export function backgroundContentType(ext: string): string {
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** 拷原件入库（用户拍板：不转码保画质）：扩展名白名单 + 大小上限（maxBytes 可注入便于测试），
 * tmp+rename 原子写惯例。srcPath 来自 webUtils.getPathForFile，主进程仍不信任——白名单/上限双校验。 */
export async function saveCustomBackgroundVideoFromPath(
  dir: string, id: string, srcPath: string, maxBytes: number = BACKGROUND_VIDEO_MAX_BYTES
): Promise<void> {
  assertCustomBackgroundId(id)
  const ext = extname(srcPath).slice(1).toLowerCase()
  if (!(BACKGROUND_VIDEO_EXTS as readonly string[]).includes(ext)) throw new Error(`unsupported video ext: ${ext}`)
  const size = (await stat(srcPath)).size
  if (size > maxBytes) throw new Error(`video too large: ${size}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.${ext}`)
  const tmp = file + '.tmp'
  try {
    await copyFile(srcPath, tmp)
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => undefined) // 拷贝/换名失败不留半截大文件（磁盘满场景尤甚）
    throw e
  }
}

/** 视频卡缩略图（首帧 JPEG，渲染层生成）：<id>.thumb.jpg，tmp+rename 同惯例 */
export async function saveCustomBackgroundThumb(dir: string, id: string, jpeg: Uint8Array): Promise<void> {
  assertCustomBackgroundId(id)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.thumb.jpg`)
  const tmp = file + '.tmp'
  await writeFile(tmp, Buffer.from(jpeg))
  await rename(tmp, file)
}

export async function readCustomBackgroundThumb(dir: string, id: string): Promise<Buffer> {
  assertCustomBackgroundId(id)
  return readFile(join(dir, `${id}.thumb.jpg`))
}

/** 按 id 解析主文件（协议 handler 消费）：jpg 优先（v1 存量），再按视频容器顺序探测。
 * 非法 id / 无文件回 null（handler 据此 404），不 throw——协议层不吃异常 */
export async function resolveCustomBackgroundFile(
  dir: string, id: string
): Promise<{ path: string; contentType: string } | null> {
  if (!CUSTOM_BG_ID_RE.test(id)) return null
  for (const ext of ['jpg', ...BACKGROUND_VIDEO_EXTS]) {
    const p = join(dir, `${id}.${ext}`)
    const found = await stat(p).then(() => true, () => false)
    if (found) return { path: p, contentType: backgroundContentType(ext) }
  }
  return null
}

/** 解析 HTTP Range 头（纯函数）：协议 handler 手工实现 range 语义的核心——net.fetch(file://)
 * 会无视 Range 头回 200 无长度流，mp4 在媒体栈直接判 SRC_NOT_SUPPORTED（亲验黑屏根因）。
 * 只支持单一范围（Chromium 媒体栈只发单范围）；坏头/越界回 null = 回整文件 200 */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    // bytes=-n：尾部 n 字节
    const n = Number(m[2])
    if (n <= 0) return null
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  if (start >= size) return null
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (end < start) return null
  return { start, end }
}

/** 幂等删除全家（v2 替代 deleteCustomBackgroundJpeg）：jpg/视频候选/缩略图一并清 */
export async function deleteCustomBackground(dir: string, id: string): Promise<void> {
  assertCustomBackgroundId(id)
  const names = ['jpg', ...BACKGROUND_VIDEO_EXTS].map((e) => `${id}.${e}`)
  names.push(`${id}.thumb.jpg`)
  await Promise.all(names.map((n) => unlink(join(dir, n)).catch(() => undefined)))
}
