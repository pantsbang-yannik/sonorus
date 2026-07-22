// 屏幕空间最近邻拾取（spec §七）：星数几千级，CPU 一帧内轻松，不做 GPU raycast。
export interface ProjectedStar { key: string; x: number; y: number; depth: number }

export function pickStar(px: number, py: number, projected: ProjectedStar[], radiusPx: number): string | null {
  let best: string | null = null
  let bestD2 = radiusPx * radiusPx
  for (const s of projected) {
    if (s.depth <= 0) continue
    const dx = s.x - px, dy = s.y - py
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD2) { bestD2 = d2; best = s.key }
  }
  return best
}
