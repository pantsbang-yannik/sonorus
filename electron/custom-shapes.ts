// 自定义形状图片仓库（idea #12）：userData/custom-shapes/<uuid>.png（创建时渲染层已降采样 ≤512px）。
// IPC 入参不可信：uuid 正则白名单是 id 拼进路径的唯一防线（shape-assets 同哲学）。
import { join } from 'node:path'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CUSTOM_SHAPE_ID_RE } from '../src/scenes/nebula/shapes/types'

const execFileP = promisify(execFile)

function assertCustomShapeId(id: string): void {
  if (!CUSTOM_SHAPE_ID_RE.test(id)) throw new Error(`unknown custom shape id: ${id}`)
}

export function customShapePath(dir: string, id: string): string {
  assertCustomShapeId(id)
  return join(dir, `${id}.png`)
}

/** tmp+rename 原子写（settings.persist 同惯例）：写一半崩溃不留半个 png */
export async function saveCustomShapePng(dir: string, id: string, png: Uint8Array): Promise<void> {
  const file = customShapePath(dir, id)
  await mkdir(dir, { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, Buffer.from(png))
  await rename(tmp, file)
}

export async function readCustomShapePng(dir: string, id: string): Promise<Buffer> {
  return readFile(customShapePath(dir, id))
}

/** 幂等删除：文件已不存在不算错（settings 才是收藏的权威，文件只是附件） */
export async function deleteCustomShapePng(dir: string, id: string): Promise<void> {
  await unlink(customShapePath(dir, id)).catch(() => undefined)
}

/** HEIC 等 Chromium 不解码的格式 → PNG（macOS 自带 sips，本应用 mac-only）。
 * 失败向上 throw：渲染层 invoke reject → 轻提示兜底，绝不静默吞（spec 已知坑） */
export async function convertToPngViaSips(bytes: Uint8Array): Promise<Buffer> {
  const stamp = `audelyra-convert-${process.pid}-${Date.now()}`
  const src = join(tmpdir(), `${stamp}.src`)
  const dst = join(tmpdir(), `${stamp}.png`)
  try {
    await writeFile(src, Buffer.from(bytes))
    await execFileP('sips', ['-s', 'format', 'png', src, '--out', dst], { timeout: 10_000 })
    return await readFile(dst)
  } finally {
    await unlink(src).catch(() => undefined)
    await unlink(dst).catch(() => undefined)
  }
}
