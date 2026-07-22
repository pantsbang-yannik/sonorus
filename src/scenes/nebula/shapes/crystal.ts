// 晶体：细分二十面体棱边线框（42 顶点/120 棱）+ 中心内核球。FUI 硬边路线代表（调研 §三）。
// 80% 粒子沿棱成束（±0.04 紧贴读作发光线，复用波形 85/15 成束经验）；20% 内核（能量核，r=0.35）。
import type { ShapePointCloud } from '../cover-points'
import { makeXorshift } from './rand'

const SCALE = 1.15 // 外接半径，与星球同档
const EDGE_JITTER = 0.04
const CORE_R = 0.35
const CORE_FRAC = 0.2

type V3 = [number, number, number]

/** 细分一次的二十面体棱集：基础 12 顶点/20 面 → 中点投影回单位球 → 去重后 120 棱。模块加载时构建一次。 */
function buildEdges(): Array<[V3, V3]> {
  const t = (1 + Math.sqrt(5)) / 2
  const verts: V3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as V3[]
  ).map((v) => {
    const l = Math.hypot(v[0], v[1], v[2])
    return [v[0] / l, v[1] / l, v[2] / l] as V3
  })
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  const midCache = new Map<string, number>()
  const midpoint = (i: number, j: number): number => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`
    let idx = midCache.get(key)
    if (idx === undefined) {
      const a = verts[i], b = verts[j]
      const m: V3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
      const l = Math.hypot(m[0], m[1], m[2])
      verts.push([m[0] / l, m[1] / l, m[2] / l])
      idx = verts.length - 1
      midCache.set(key, idx)
    }
    return idx
  }
  const edgeKeys = new Set<string>()
  const edges: Array<[V3, V3]> = []
  const addEdge = (i: number, j: number): void => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push([verts[i], verts[j]])
  }
  for (const [i0, i1, i2] of faces) {
    const ab = midpoint(i0, i1), bc = midpoint(i1, i2), ca = midpoint(i2, i0)
    addEdge(i0, ab); addEdge(ab, i1)
    addEdge(i1, bc); addEdge(bc, i2)
    addEdge(i2, ca); addEdge(ca, i0)
    addEdge(ab, bc); addEdge(bc, ca); addEdge(ca, ab)
  }
  return edges
}

const EDGES = buildEdges() // 120 条

export function generateCrystal(count: number): ShapePointCloud {
  const positions = new Float32Array(count * 3)
  // 方言批2：aux.xyz=所在棱的单位方向、w=沿棱相位 u（波前沿棱传播的坐标）；内核粒子全 0（kernel 以 length(aux.xyz) 区分）
  const aux = new Float32Array(count * 4)
  const rand = makeXorshift(0x3c9e1b2f)
  for (let i = 0; i < count; i++) {
    if (rand() < CORE_FRAC) {
      // 内核：均匀实心小球（cbrt 均匀化体密度）；aux 保持 0
      const a = rand() * Math.PI * 2
      const z = rand() * 2 - 1
      const s = Math.sqrt(Math.max(0, 1 - z * z))
      const r = CORE_R * Math.cbrt(rand())
      positions[i * 3] = s * Math.cos(a) * r
      positions[i * 3 + 1] = s * Math.sin(a) * r
      positions[i * 3 + 2] = z * r
    } else {
      const e = EDGES[Math.floor(rand() * EDGES.length) % EDGES.length]
      const u = rand()
      for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = (e[0][k] + (e[1][k] - e[0][k]) * u) * SCALE + (rand() * 2 - 1) * EDGE_JITTER
      }
      const dx = e[1][0] - e[0][0], dy = e[1][1] - e[0][1], dz = e[1][2] - e[0][2]
      const dl = Math.hypot(dx, dy, dz)
      aux[i * 4] = dx / dl
      aux[i * 4 + 1] = dy / dl
      aux[i * 4 + 2] = dz / dl
      aux[i * 4 + 3] = u
    }
  }
  return { positions, aux }
}
