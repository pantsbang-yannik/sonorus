// 轮廓形状（S2，spec §4.3）：预烘焙 .bin 资产的运行时缓存。
// 未就绪/加载失败 → contourCloud 返回 null → resolveShape 现有 null→free 语义 = 回退星云；
// 就绪回调触发 applyShape 重放 = 自动补切。法线块已消费进 aux（方言期批1：雕像/心脏法线浮雕数据源）。
import type { ShapePointCloud } from '../cover-points'

export type ContourId = 'heart' | 'demo-gramophone' | 'demo-cassette' | 'demo-headphones' | 'demo-mic'
/** 常规启动只load图鉴形状（statue 已退役，发布准备③ 用户拍板删卡）；
 * 序幕四形体由引导接线用 DEMO_CONTOUR_IDS 按需加载，不拖累每次启动 */
export const CONTOUR_IDS: readonly ContourId[] = ['heart']
export const DEMO_CONTOUR_IDS: readonly ContourId[] = ['demo-gramophone', 'demo-cassette', 'demo-headphones', 'demo-mic']

interface ContourData { pos: Float32Array; norm: Float32Array }
const loaded = new Map<ContourId, ContourData>()

/** 布局 v1：[pos f32×3N][norm f32×3N]，N=byteLength/24。
 * 防御（S2 留痕回账）：字节数不整除布局 → throw 走加载失败回退；byteOffset 非 4 对齐 → 拷贝重对齐 */
function parseContour(raw: Uint8Array): ContourData {
  if (raw.byteLength === 0 || raw.byteLength % 24 !== 0) {
    throw new Error(`轮廓资产字节数不符布局 v1: ${raw.byteLength}`)
  }
  const aligned = raw.byteOffset % 4 === 0 ? raw : raw.slice()
  const n = aligned.byteLength / 24
  return {
    pos: new Float32Array(aligned.buffer, aligned.byteOffset, n * 3),
    norm: new Float32Array(aligned.buffer, aligned.byteOffset + n * 12, n * 3),
  }
}

export function loadContourAssets(
  fetchAsset: (id: ContourId) => Promise<Uint8Array>,
  onReady: (id: ContourId) => void,
  ids: readonly ContourId[] = CONTOUR_IDS,
): void {
  for (const id of ids) {
    if (loaded.has(id)) continue
    void fetchAsset(id)
      .then((raw) => {
        loaded.set(id, parseContour(raw))
        onReady(id)
      })
      .catch((err) => console.warn(`[shapes] 轮廓资产 ${id} 加载失败，回退星云`, err))
  }
}

/** 序幕形体卸载（审①P2-3/审②P2-9）：引导落幕后 ~14MB 原始点数据不再需要；只供 demo 收尾调用 */
export function unloadContourAssets(ids: readonly ContourId[]): void {
  for (const id of ids) loaded.delete(id)
}

export function contourCloud(id: ContourId, count: number): ShapePointCloud | null {
  const data = loaded.get(id)
  if (!data) return null
  const take = Math.min(count, data.pos.length / 3)
  // 法线装 aux.xyz（方言法线浮雕消费，S2 终审观察-B「法线白赚」兑现）；w=0 备用（批2 棱相位/环编号）
  const aux = new Float32Array(take * 4)
  for (let i = 0; i < take; i++) {
    aux[i * 4] = data.norm[i * 3]
    aux[i * 4 + 1] = data.norm[i * 3 + 1]
    aux[i * 4 + 2] = data.norm[i * 3 + 2]
  }
  return { positions: data.pos.slice(0, take * 3), aux } // 烘焙序随机 → 前缀仍均匀（spec §4.2）
}
