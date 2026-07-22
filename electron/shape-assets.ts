// 打包路径已接线（发布准备① Task 2）：打包后 appPath = process.resourcesPath（extraResources），开发环境 = app.getAppPath()。
import { join } from 'node:path'

const SHAPE_ASSET_IDS = ['heart', 'demo-gramophone', 'demo-cassette', 'demo-headphones', 'demo-mic'] as const
export type ShapeAssetId = (typeof SHAPE_ASSET_IDS)[number]

/** IPC 入参不可信：白名单精确匹配，杜绝路径穿越（id 直接拼进路径的唯一防线） */
function assertShapeId(id: string): asserts id is ShapeAssetId {
  if (!(SHAPE_ASSET_IDS as readonly string[]).includes(id)) throw new Error(`unknown shape asset: ${id}`)
}

export function resolveShapeAssetPath(id: string, appPath: string): string {
  assertShapeId(id)
  return join(appPath, 'assets', 'shapes', `${id}.bin`)
}

export function resolveShapeMetaPath(id: string, appPath: string): string {
  assertShapeId(id)
  return join(appPath, 'assets', 'shapes', `${id}.meta.json`)
}

export interface ShapeAssetMeta { version: number; layout: string; count: number }

/** 布局兼容闸（S2 终审 Minor-A 回账）：方言期渲染端开始消费法线块，布局漂移必须在 IPC 边界拦下，
 * 不兼容 → throw → 渲染端既有 catch 走「加载失败回退星云」路径，画面不坏 */
export function parseShapeAssetMeta(raw: string, id: string): ShapeAssetMeta {
  const m = JSON.parse(raw) as Partial<ShapeAssetMeta>
  if (m.version !== 1 || m.layout !== 'pos3f32+norm3f32' || typeof m.count !== 'number' || m.count <= 0) {
    throw new Error(`shape asset meta 不兼容: ${id} version=${String(m.version)} layout=${String(m.layout)}`)
  }
  return { version: m.version, layout: m.layout, count: m.count }
}
