// 封面取图注入 seam（视觉重做后唯一职责）：场景模块不直接摸 window.audelyra，main.ts 启动时接线。
// V1 的封面纹理 LRU 缓存随近处封面体系退役——全量呈现改走 cover-atlas 图集。
export type GalaxyArtworkFetcher = (artworkKey: string) => Promise<Uint8Array | null>

let fetcher: GalaxyArtworkFetcher | null = null
export function setGalaxyArtworkFetcher(f: GalaxyArtworkFetcher): void {
  fetcher = f
}
export function getGalaxyArtworkFetcher(): GalaxyArtworkFetcher | null {
  return fetcher
}
