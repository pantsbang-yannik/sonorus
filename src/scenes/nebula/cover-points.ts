// 粒子目标点云的类型契约。
// 注：Task 6 需要 ShapePointCloud 类型来定义 NebulaParticles.setTargets；本文件先落地类型契约，
// sampleCoverPoints 的实现与测试归 Task 8（计划②）。类型签名与计划文档一致，Task 8 直接补实现即可。

/** 最小像素源接口（兼容 DOM ImageData，测试可手工构造） */
export interface PixelSource {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** 粒子吸附目标点云（Phase B1 改名：封面从「特殊逻辑」归位为形状层的一个来源）。
 * colors 可选：封面带像素色；几何形状只产 positions（颜色走情绪三色，spec §4.2） */
export interface ShapePointCloud {
  positions: Float32Array // xyz 交错，长度 = count*3
  colors?: Float32Array // rgb 交错（线性空间 0..1）；缺失 = 无色点云
  aux?: Float32Array // vec4/点 交错（xyz=方向类：表面法线/棱方向；w=标量：棱相位/环编号），缺失=全 0
}

const srgbToLinear = (v: number): number => Math.pow(v / 255, 2.2)

/** 经典 GLSL 哈希（评审修订：`(i*127.1)%1` 是周期 10 的斜坡，会产生网格条纹）——title-points 复用同源 */
export const hash01 = (n: number): number => {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

export function sampleCoverPoints(
  img: PixelSource, count: number, opts: { depth?: number } = {}
): ShapePointCloud {
  const depth = opts.depth ?? 0.35
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const aspect = img.width / img.height
  const sx = aspect >= 1 ? 1 : aspect       // 保纵横比缩放
  const sy = aspect >= 1 ? 1 / aspect : 1
  const cols = Math.ceil(Math.sqrt(count * aspect))
  const rows = Math.ceil(count / cols)

  for (let i = 0; i < count; i++) {
    const gx = (i % cols + 0.5) / cols
    const gy = (Math.floor(i / cols) % rows + 0.5) / rows
    // 网格 + 轻抖动（确定性伪随机，同一封面重采样结果稳定）
    const jx = hash01(i * 127.1) / cols
    const jy = hash01(i * 311.7) / rows
    const u = Math.min(gx + jx * 0.8, 0.9999)
    const v = Math.min(gy + jy * 0.8, 0.9999)
    const px = Math.floor(u * img.width)
    const py = Math.floor(v * img.height)
    const o = (py * img.width + px) * 4
    const r = srgbToLinear(img.data[o])
    const g = srgbToLinear(img.data[o + 1])
    const b = srgbToLinear(img.data[o + 2])
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    positions[i * 3] = (u * 2 - 1) * sx
    positions[i * 3 + 1] = (1 - v * 2) * sy   // 图像 y 向下 → 世界 y 向上
    positions[i * 3 + 2] = (lum - 0.5) * depth
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  return { positions, colors }
}
