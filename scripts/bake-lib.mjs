// 烘焙纯函数库：bake-shape-points.mjs 与 vitest 共用。零依赖。
// xorshift 与 src/scenes/nebula/shapes/rand.ts 同算法（确定性烘焙=同输入同 .bin）。

export function makeXorshift(seedInit) {
  let seed = seedInit >>> 0
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0xffffffff
  }
}

/** 列主序 mat4（gltf-transform getWorldMatrix 同序）作用于点 */
export function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** 包围盒居中 + 等比缩放至最大半径 targetRadius。原地修改，返回 {center, scale} 供 meta 追溯。 */
export function normalizePoints(positions, targetRadius = 1.3) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  let maxR = 0
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - center[0], y = positions[i + 1] - center[1], z = positions[i + 2] - center[2]
    maxR = Math.max(maxR, Math.hypot(x, y, z))
  }
  const scale = maxR > 0 ? targetRadius / maxR : 1
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - center[0]) * scale
    positions[i + 1] = (positions[i + 1] - center[1]) * scale
    positions[i + 2] = (positions[i + 2] - center[2]) * scale
  }
  return { center, scale }
}

/** 面积加权三角面采样（MeshSurfaceSampler 同原理的零依赖实现）：
 * CDF 二分选三角 + 重心均匀采样；法线=几何面法线（粒子浮雕只需方向）。 */
export function sampleSurface({ positions, indices, count, seed = 0x5eed }) {
  const triCount = indices.length / 3
  const cdf = new Float64Array(triCount)
  let acc = 0
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3]
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2]
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx
    acc += Math.hypot(cx, cy, cz) / 2
    cdf[t] = acc
  }
  const rand = makeXorshift(seed)
  const outP = new Float32Array(count * 3)
  const outN = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const pick = rand() * acc
    let lo = 0, hi = triCount - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < pick) lo = mid + 1
      else hi = mid
    }
    const [a, b, c] = [indices[lo * 3] * 3, indices[lo * 3 + 1] * 3, indices[lo * 3 + 2] * 3]
    let u = rand(), v = rand()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2]
    outP[i * 3] = positions[a] + u * abx + v * acx
    outP[i * 3 + 1] = positions[a + 1] + u * aby + v * acy
    outP[i * 3 + 2] = positions[a + 2] + u * abz + v * acz
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const nl = Math.hypot(nx, ny, nz) || 1
    outN[i * 3] = nx / nl
    outN[i * 3 + 1] = ny / nl
    outN[i * 3 + 2] = nz / nl
  }
  return { positions: outP, normals: outN }
}

/** 逐点欧拉旋转（'z90,x90' 逐项依序应用，度数任意）：修正源模型朝向——
 * 相机沿 z 看向原点，薄片类模型（卡带）薄轴必须转到 z 上，否则只见侧棱。原地修改。 */
export function rotatePoints(positions, spec) {
  if (!spec) return
  for (const step of spec.split(',')) {
    const axis = step[0]
    const rad = (Number(step.slice(1)) * Math.PI) / 180
    if (!'xyz'.includes(axis) || !Number.isFinite(rad)) throw new Error(`非法旋转项: ${step}`)
    const c = Math.cos(rad), s = Math.sin(rad)
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]]
      if (axis === 'x') { positions[i + 1] = y * c - z * s; positions[i + 2] = y * s + z * c }
      else if (axis === 'y') { positions[i] = x * c + z * s; positions[i + 2] = -x * s + z * c }
      else { positions[i] = x * c - y * s; positions[i + 1] = x * s + y * c }
    }
  }
}
