// 极光天空（虚空之镜 spec §空间模型）：sampleDir(worldDirection) 共享方向场——穹顶与镜面共同调用，
// 天与倒影出自同一场，天然一致；并修掉旧渐变平面「镜头侧转背景消失」的现存缺陷（穹顶全向连续）。
// 亮度纪律沿用 background.ts：level 峰值 ≤0.5，沉睡 ×0.15，颜色只吃封面两色（primary/deep）。
// 防海面化纪律①：heightGate 让 dir.y→0 处归零——天在地平线方向融进黑，镜面远端同融（雾融无地平线）。
import * as THREE from 'three/webgpu'
import {
  uniform, vec3, float, positionWorld, cameraPosition, smoothstep, hash, fract,
  mx_fractal_noise_float, mx_noise_float,
} from 'three/tsl'

export type AuroraDetail = 'full' | 'simple'

export class NebulaSky {
  readonly mesh: THREE.Mesh
  readonly detail: AuroraDetail

  // uniform 字段禁止显式类型注解（ReturnType<typeof uniform> 塌 unknown 泛型坑，见 post.ts 注释）
  private readonly uPrimary = uniform(new THREE.Color(0.35, 0.42, 1.0))
  private readonly uDeep = uniform(new THREE.Color(0.12, 0.1, 0.4))
  private readonly uLevel = uniform(0.1)
  private readonly uStar = uniform(0.3)
  private readonly uTime = uniform(0)
  private readonly uLow = uniform(0)  // 低频→大涡旋（域扭曲幅度），spec §四层①
  private readonly uMid = uniform(0)  // 中频→细波纹（高频细噪声调制）
  private skyTime = 0
  private readonly geo: THREE.SphereGeometry
  private readonly mat: THREE.MeshBasicNodeMaterial

  constructor(detail: AuroraDetail) {
    this.detail = detail
    this.geo = new THREE.SphereGeometry(40, 32, 16)
    this.mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false })
    // 视线方向 = 片元世界坐标 − 相机（穹顶远大于运镜半径 13.8，偏心误差可忽略但保持正确性）
    const dir = positionWorld.sub(cameraPosition).normalize()
    this.mat.colorNode = this.sampleDir(dir)
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.renderOrder = -3 // 最底层：镜面 -2、尘埃默认 0、主粒子最上
    this.mesh.frustumCulled = false
    this.mesh.name = 'nebula-sky'
  }

  /** 方向场（TSL 表达式）：极光带 + 程序星野 + 地平线雾融。参数是任意 vec3 方向节点——
   * 穹顶传视线方向、镜面传镜像后的方向，同一个场保证天与倒影一致（spec §空间模型）。
   * 签名退宽松 any：TSL 节点多重载类型与 @types/three 打架，运行时鸭子类型，先保编译。 */
  sampleDir(dir: any): any {
    const t = float(this.uTime)
    // 噪声域：方向坐标 + 时间漂移；full 档叠一层域扭曲（涡旋感来源），simple 档省掉（降级）
    let p = dir.mul(2.2).add(vec3(float(0), t.mul(0.06), t.mul(0.045)))
    if (this.detail === 'full') {
      // 大涡旋（spec §四层①）：域扭曲幅度挂 uLow——低频推大结构，底噪 0.25 保「无音乐也缓涌」
      const warp = mx_noise_float(dir.mul(1.3).add(vec3(t.mul(0.03), float(0), t.mul(0.021))))
      const warpAmp = float(0.25).add(this.uLow.mul(0.45))
      p = p.add(vec3(warp.mul(warpAmp).mul(1.4), float(0), warp.mul(warpAmp)))
    }
    const octaves = this.detail === 'full' ? 3 : 2
    const n = mx_fractal_noise_float(p, octaves, 2.0, 0.55).mul(0.5).add(0.5)
    const band = n.pow(2.4) // 稀疏化：只有噪声峰隆起成光带，避免整片糊亮
    // 细波纹（spec §四层①）：高频细噪声调制光带亮度，强度挂 uMid——中频起涟漪，0 时恒等
    const fine = mx_noise_float(dir.mul(6.5).add(vec3(t.mul(0.12), t.mul(0.09), float(0)))).mul(0.5).add(0.5)
    const bandFine = band.mul(fine.sub(0.5).mul(this.uMid.mul(0.8)).add(1))
    // 雾融门：dir.y→0 归零（abs：镜面传进来的镜像方向 y>0，天空自身下半球也一致压黑）
    const heightGate = smoothstep(0.03, 0.45, dir.y.abs())
    const aurora = this.uDeep.mul(0.55).add(this.uPrimary.mul(bandFine).mul(0.85))
      .mul(this.uLevel).mul(heightGate).mul(bandFine.mul(0.7).add(0.3))
    // 程序星野：两级结构——①格哈希选「这格有没有星+多亮」，②格内到星点随机位置的距离衰减出锐利小点。
    // 坑教训：早期版本只有①（整格同亮度），pow(48) 过阈的是整块格子，投影成硬边方块（亲验 fb1-A 截图）。
    // 镜面解析复用即「镜下也是宇宙」（防海面化③），尘埃 sprite 无需真反射。hash() 只吃标量种子（repo 坑清单）
    const p2 = dir.mul(64.0)
    const cell = p2.floor()
    const f = fract(p2) // 格内坐标 0..1
    const seed = cell.x.add(cell.y.mul(57.0)).add(cell.z.mul(113.0))
    // 星点在格内的随机位置（三个派生标量哈希，仍守「hash 只吃标量」纪律）
    const starPos = vec3(hash(seed.add(1.0)), hash(seed.add(2.0)), hash(seed.add(3.0)))
    const d2 = f.sub(starPos).length()
    const point = smoothstep(float(0.22), float(0.02), d2) // 锐利小点：半径 ~0.2 格（手感值）
    const star = hash(seed).pow(48.0).mul(point).mul(this.uStar).mul(smoothstep(0.02, 0.25, dir.y.abs()))
    return vec3(aurora.add(vec3(star, star, star)))
  }

  /** 每帧：三色跟随封面 + 频段（低→涡旋/中→波纹）+ 能量呼吸 + drop 翻涌 + 沉睡压暗 + 流速档 + 滑杆 */
  update(dt: number, s: {
    primary: THREE.Color; deep: THREE.Color
    energy: number; drop: number; sleep: number
    low: number; mid: number // rig 平滑包络 uLow/uMid（spec §四层①：低频大涡旋、中频细波纹）
    flowMul: number // 叙事流速（副歌 burst≈1.6，其余 1）
    level: number   // 设置滑杆 aurora 0..1
  }): void {
    this.uPrimary.value.copy(s.primary)
    this.uDeep.value.copy(s.deep)
    const lvl = 0.1 + s.energy * 0.12 + s.drop * 0.3 // 沿用 background.ts:74 亮度公式
    this.uLevel.value = Math.min(0.5, lvl) * (1 - s.sleep * 0.85) * s.level
    this.uStar.value = 0.3 * (1 - s.sleep * 0.85)
    this.uLow.value = s.low
    this.uMid.value = s.mid
    this.skyTime += dt * (0.25 + 0.75 * s.energy) * s.flowMul // 流速积分：能量+叙事共同驱动
    this.uTime.value = this.skyTime
  }

  /** 只读测试口（惯例同 tuning-panel bodyForTest）：亮度纪律/流速积分/频段接线的判定点 */
  get stateForTest(): { level: number; time: number; low: number; mid: number } {
    return {
      level: this.uLevel.value as number, time: this.uTime.value as number,
      low: this.uLow.value as number, mid: this.uMid.value as number,
    }
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
