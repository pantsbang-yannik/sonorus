// 自定义形状源→点云控制器（idea #12）：CoverController 的简化同构——
// 只生产点云不碰 uniform/调色；显示决定权在编排层 refreshShape（spec §4.3 职责切割）。
// 文字同步光栅化；图片异步 IPC 读文件→解码→采样，单调 token 防换源竞态。
import { sampleCoverPoints, type ShapePointCloud } from './cover-points'
import { sampleTitlePoints } from './title-points'
import { renderCustomTextImage } from './custom-points'
import type { CustomShapeMeta } from './shapes/types'

export type CustomShapeFetcher = (id: string) => Promise<Uint8Array>

// 注入模式同 contour.loadContourAssets：场景模块不直接摸 window.audelyra，main.ts 启动时接线
let fetcher: CustomShapeFetcher | null = null
export function setCustomShapeFetcher(f: CustomShapeFetcher): void {
  fetcher = f
}

export class CustomShapeController {
  private token = 0
  private appliedId: string | null = null
  private kind_: 'image' | 'text' | null = null
  private cloud_: ShapePointCloud | null = null

  constructor(
    private count: number,
    private readonly hooks: { onCloudChanged: () => void }
  ) {}

  /** 仲裁的 custom 输入：null=未选自定义；cloud=null=加载中/失败（仲裁回退 free） */
  get state(): { cloud: ShapePointCloud | null; kind: 'image' | 'text' } | null {
    return this.kind_ ? { cloud: this.cloud_, kind: this.kind_ } : null
  }

  /** 粒子重建后换 count：点云不重采样（setTargets 取模复用，cover 同惯例），下次换源才用新 count */
  rebind(count: number): void {
    this.count = count
  }

  setSource(meta: CustomShapeMeta | null): void {
    if ((meta?.id ?? null) === this.appliedId) return // 同源短路：落盘回流/无关广播
    const token = ++this.token
    this.appliedId = meta?.id ?? null
    this.kind_ = meta?.kind ?? null
    this.cloud_ = null
    if (!meta) {
      this.hooks.onCloudChanged()
      return
    }
    if (meta.kind === 'text') {
      const img = renderCustomTextImage(meta.text ?? '')
      this.cloud_ = img ? sampleTitlePoints(img, this.count, { worldWidth: 2.4, depth: 0.06 }) : null
      this.hooks.onCloudChanged()
      return
    }
    void this.loadImage(meta.id, token)
  }

  private async loadImage(id: string, token: number): Promise<void> {
    try {
      if (!fetcher) throw new Error('custom shape fetcher 未接线')
      const bytes = await fetcher(id)
      if (token !== this.token) return // 等待期间已换源
      const imageData = await decodePngToImageData(bytes)
      if (token !== this.token) return
      this.cloud_ = sampleCoverPoints(imageData, this.count)
    } catch (err) {
      console.warn('[nebula] 自定义形状图片加载失败', err)
      if (token !== this.token) return // stale 失败不覆盖新状态
      this.cloud_ = null // 仲裁回退 free；文件缺失（用户手删）不崩画面
    }
    this.hooks.onCloudChanged()
  }
}

/** PNG 字节 → ImageData（存的已是 ≤512px，直接整图取像素）。独立函数便于阅读，无 DOM 环境不会被走到 */
async function decodePngToImageData(bytes: Uint8Array): Promise<ImageData> {
  // IPC 传回的 Uint8Array 类型标注为 ArrayBufferLike（@types/node 与 DOM lib 的已知泛型冲突，
  // 见 TS 5.7+ 起 Uint8Array<ArrayBufferLike> 不满足 BlobPart）：本项目从不跨 Worker 传 SharedArrayBuffer，
  // 显式裁剪出精确字节范围再断言 ArrayBuffer 是安全的
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, img.width, img.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}
