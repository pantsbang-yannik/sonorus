// 预烘焙管线（spec §4.2）：GLB → 旋转修姿(可选) → 归一化(居中/半径1.3) → 面积加权采样 450k 点+法线 → .bin+meta。
// 用法：node scripts/bake-shape-points.mjs <输入.glb|.gltf> <输出前缀> <source-url> <license> [点数] [旋转如 z90,x90]
// 重跑=确定性同输出（同输入文件同 .bin）。换模型/加题材只需重跑本脚本。
import { NodeIO } from '@gltf-transform/core'
import { writeFileSync } from 'node:fs'
import { sampleSurface, normalizePoints, transformPoint, rotatePoints } from './bake-lib.mjs'

const TARGET_RADIUS = 1.3
const [, , input, outPrefix, source = '', license = '', countArg = '', rotArg = ''] = process.argv
// 缺省 450k = quality ultra 档粒子数；序幕形体传 150000 降档瘦包（发布准备③）。低档取前缀仍均匀（采样顺序随机）
const COUNT = countArg ? Number(countArg) : 450_000
if (!input || !outPrefix || !Number.isInteger(COUNT) || COUNT <= 0) {
  console.error('用法: node scripts/bake-shape-points.mjs <in.glb> <out前缀> <source> <license> [点数]')
  process.exit(1)
}

const doc = await new NodeIO().read(input)
// 收集全场景三角面（应用节点世界变换；无 indices 的 primitive 按顺序三连补索引）
let vertBase = 0
const allPos = []
const allIdx = []
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const world = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue // 只收 TRIANGLES
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const arr = pos.getArray()
    for (let i = 0; i < arr.length; i += 3) {
      const [x, y, z] = transformPoint(world, arr[i], arr[i + 1], arr[i + 2])
      allPos.push(x, y, z)
    }
    const idx = prim.getIndices()
    const n = arr.length / 3
    if (idx) {
      const ia = idx.getArray()
      for (let i = 0; i < ia.length; i++) allIdx.push(vertBase + ia[i])
    } else {
      for (let i = 0; i < n; i++) allIdx.push(vertBase + i)
    }
    vertBase += n
  }
}
if (!allIdx.length) {
  console.error('未找到三角网格')
  process.exit(1)
}
const positions = new Float32Array(allPos)
const indices = new Uint32Array(allIdx)
rotatePoints(positions, rotArg)
const { center, scale } = normalizePoints(positions, TARGET_RADIUS)
const sampled = sampleSurface({ positions, indices, count: COUNT, seed: 0x50e2b0de })

const bin = Buffer.concat([Buffer.from(sampled.positions.buffer), Buffer.from(sampled.normals.buffer)])
writeFileSync(`${outPrefix}.bin`, bin)
writeFileSync(
  `${outPrefix}.meta.json`,
  JSON.stringify({ version: 1, count: COUNT, layout: 'pos3f32+norm3f32', targetRadius: TARGET_RADIUS, center, scale, ...(rotArg ? { rot: rotArg } : {}), source, license, bakedAt: new Date().toISOString() }, null, 2),
)
console.log(`baked ${outPrefix}.bin: ${COUNT} pts, ${(bin.length / 1e6).toFixed(1)}MB, 源三角 ${indices.length / 3}`)
