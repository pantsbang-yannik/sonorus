import * as THREE from 'three/webgpu'
import { uniform, uv, vec3, smoothstep, saturate, float, hash, instanceIndex, instancedArray } from 'three/tsl'

/**
 * 远景尘埃三层视差（虚空之镜升级）：氛围渐变职责已移交 NebulaSky 穹顶，本类只剩尘埃。
 * 远/中/近三壳不同半径与转速——镜头运动时层间相对位移=纵深；近层少量大颗粒缓慢滑过镜头
 * （亲验已被验证的「粒子滑过的空间感」，做足它）。
 * 亮度基线（亲验 fb3 提档）：albedo=deep×0.8、透明度 0.35~0.45 层间不同，另受 uDustSize/uDustBright
 * 滑杆倍率；随 uBgLevel 呼吸、沉睡压暗不变。
 */
interface Shell {
  mesh: THREE.InstancedMesh
  geo: THREE.PlaneGeometry
  mat: THREE.SpriteNodeMaterial
  speed: number // 自转速基准（rad/s 系数，方向含正负——层间反向=静止镜头也有微视差）
  fullCount: number // 上限池实例总数（构造时 seed 的全量）；密度滑杆只调 mesh.count 这个子集
}

/** makeShell 入参对象化（Task 2）：positional 参数已到 8 个、后续 volume/windAmp 还要加字段，
 * 收成 spec 一次到位，避免调用点靠位置对齐易错 */
interface ShellSpec {
  count: number
  rMin: number
  rMax: number
  sBase: number   // 粒径基准（世界单位）
  sRand: number   // 粒径随机附加
  opacity: number
  speed: number   // 自转速基准（rad/s 系数，方向含正负）
  seed: number
  volume?: boolean // true=体积均匀分布（r³ 采样，前景飘尘层）；默认球壳分布
  windAmp: number // 风搅乱流幅度（世界单位）：远层最稳、前景最狂——纵深感由风搅差异再加一笔
}

/** 亲验 fb1 修订④手感常量：转速随节奏「音浪扑面」+ 整体提速——用户反馈「感受比较强」，
 * 数值来自现场调音收敛，非理论推导 */
const DUST_KICK_GAIN = 2.5 // kickEnv(0..~1) 对自转增益的额外贡献：鼓点时星尘明显掠过
const BASE_SPEED_MUL = 1.6 // 三壳基础转速统一倍率：用户要「更强」，静息态也要感受到流动

/** 风搅乱流（亲验 fb3）：每实例伪噪声偏移的幅度包络。静息=微幅漂浮，energy 抬升，
 * kick 快 attack（max 直取）慢 release（指数衰减）——副歌连续鼓点下全场尘埃读作「被风乱搅」 */
const WIND_BASE = 0.05    // 静息底：尘埃永远是活的，但很安静
const WIND_ENERGY = 0.25  // energy(0..1) 对风场的贡献
const WIND_KICK = 0.55    // kick 包络的冲散贡献
const WIND_RELEASE = 0.9  // 冲散衰减时间常数（秒）：慢收才有「搅开再落定」的读感

const DUST_FLICK_GAIN = 0.8 // 高频包络 → 细闪幅度（形状改造④：镲片/气声=背景星尘的鸡皮疙瘩）

export class NebulaBackground {
  readonly group = new THREE.Group()

  private readonly uBgColor = uniform(new THREE.Color(0.12, 0.1, 0.4))
  private readonly uBgLevel = uniform(0.1)
  private readonly uDustSize = uniform(1)
  private readonly uDustBright = uniform(1)
  private readonly uTime = uniform(0)
  private readonly uWind = uniform(0)
  private readonly uHighFlick = uniform(0)
  private windKick = 0 // kick 冲散包络（CPU 侧：快 attack 慢 release）
  private readonly shells: Shell[] = []
  private readonly near: Shell
  private readonly fg: Shell

  constructor(dustCount: number, nearDust: boolean) {
    // 远 55% [5,7] 小颗粒 / 中 45% [3.5,5] 标准颗粒——这是上限池全量，实际绘制量由 setDustDensity 收窄
    // 近 300 颗 [2.2,3.2] 大颗粒：点缀不参与密度滑杆，只受 nearDust 开关
    // 可见度基线提档（亲验 fb3 起点值，最终滑杆收敛）：粒径 ≈×2.5、透明度上调
    const farCount = Math.floor(dustCount * 0.55)
    const midCount = dustCount - farCount
    this.shells.push(this.makeShell({ count: farCount, rMin: 5.0, rMax: 7.0, sBase: 0.010, sRand: 0.014, opacity: 0.40, speed: 0.003 * BASE_SPEED_MUL, seed: 0x2545f491, windAmp: 0.15 }))
    this.shells.push(this.makeShell({ count: midCount, rMin: 3.5, rMax: 5.0, sBase: 0.016, sRand: 0.020, opacity: 0.45, speed: -0.0045 * BASE_SPEED_MUL, seed: 0x8f3a11c7, windAmp: 0.30 }))
    this.near = this.makeShell({ count: 300, rMin: 2.2, rMax: 3.2, sBase: 0.035, sRand: 0.025, opacity: 0.35, speed: 0.008 * BASE_SPEED_MUL, seed: 0x51ab33ef, windAmp: 0.60 })
    this.shells.push(this.near)
    this.near.mesh.visible = nearDust
    // 前景飘尘（亲验 fb3）：~200 大颗粒体积分布覆盖镜头轨道 dist∈[1.6,4.6]——总有颗粒从眼前滑过，
    // 大粒径低透明度软边=虚焦光斑。点缀层同近壳：不受密度滑杆控，归 nearDust 降级开关
    this.fg = this.makeShell({ count: 200, rMin: 1.0, rMax: 4.6, sBase: 0.06, sRand: 0.05, opacity: 0.15, speed: -0.006 * BASE_SPEED_MUL, seed: 0x7c31d9a3, volume: true, windAmp: 0.90 })
    this.shells.push(this.fg)
    this.fg.mesh.visible = nearDust
    for (const s of this.shells) this.group.add(s.mesh)
  }

  /** 球壳静态分布（CPU 一次性 seed 无 compute，纪律沿用旧版）；seed 各层不同防重叠纹样 */
  private makeShell(spec: ShellSpec): Shell {
    const positions = instancedArray(spec.count, 'vec3')
    const arr = positions.value.array as Float32Array
    let seed = spec.seed >>> 0
    const rand = (): number => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      return (seed >>> 0) / 0xffffffff
    }
    for (let i = 0; i < spec.count; i++) {
      const a = rand() * Math.PI * 2
      const z = rand() * 2 - 1
      // 体积分布（前景飘尘层）：r³ 均匀 → 空间密度均匀，镜头轨道内外都有颗粒
      const r = spec.volume
        ? Math.cbrt(spec.rMin ** 3 + rand() * (spec.rMax ** 3 - spec.rMin ** 3))
        : spec.rMin + rand() * (spec.rMax - spec.rMin)
      const s = Math.sqrt(Math.max(0, 1 - z * z))
      arr[i * 3] = s * Math.cos(a) * r
      arr[i * 3 + 1] = s * Math.sin(a) * r
      arr[i * 3 + 2] = z * r
    }
    positions.value.needsUpdate = true

    const mat = new THREE.SpriteNodeMaterial({
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    })
    // 风搅乱流（亲验 fb3）：每实例相位/频率互异的三频正弦叠合=伪噪声偏移，三轴不同相；
    // 纯常驻表达式无分支无 compute，运行时只写 uTime/uWind 两个 uniform
    const phase = hash(instanceIndex.add(37)).mul(6.2832)
    const freq = hash(instanceIndex.add(53)).mul(0.7).add(0.6) // 每颗粒子频率 0.6~1.3 互异
    const sway = vec3(
      this.uTime.mul(freq).add(phase).sin(),
      this.uTime.mul(freq.mul(0.83)).add(phase.mul(1.7)).sin(),
      this.uTime.mul(freq.mul(1.19)).add(phase.mul(2.3)).sin(),
    ).mul(this.uWind.mul(spec.windAmp))
    mat.positionNode = positions.element(instanceIndex).add(sway)
    mat.scaleNode = float(spec.sBase).add(hash(instanceIndex.add(11)).mul(spec.sRand)).mul(this.uDustSize)
    mat.opacityNode = saturate(smoothstep(0.0, 0.5, uv().sub(0.5).length()).oneMinus()).pow(1.5).mul(spec.opacity)
    // 高频细闪（形状改造④）：逐实例相位/速率去相关+pow 尖化，镜像主粒子 twinkle 手法——
    // additive 混合下亮度须折进 colorNode（M2/M3 坑清单惯例），故乘进颜色而非叠加透明度
    const flickRate = hash(instanceIndex.add(71)).mul(7).add(5) // 5..12Hz 逐颗互异
    const flickPhase = hash(instanceIndex.add(83)).mul(6.2832)
    const flick = this.uTime.mul(flickRate).add(flickPhase).sin().mul(0.5).add(0.5).pow(3)
    mat.colorNode = vec3(this.uBgColor.mul(0.8).mul(this.uBgLevel.mul(2).add(0.3)).mul(this.uDustBright))
      .mul(flick.mul(this.uHighFlick).add(1))
    const geo = new THREE.PlaneGeometry(1, 1)
    const mesh = new THREE.InstancedMesh(geo, mat, spec.count)
    mesh.frustumCulled = false
    return { mesh, geo, mat, speed: spec.speed, fullCount: spec.count }
  }

  /** 每帧同步：deep 色 + 能量呼吸 + drop 增亮 + 沉睡压暗（公式沿用旧版）；三层各按自转速推进，
   * kick（uKickEnv 包络 0..~1）额外顶转速——鼓点时星尘明显掠过=「音浪扑面」（亲验 fb1 修订④） */
  update(dt: number, s: { deep: THREE.Color; energy: number; drop: number; sleep: number; kick: number; high: number }): void {
    this.uBgColor.value.copy(s.deep)
    const level = 0.1 + s.energy * 0.12 + s.drop * 0.3
    this.uBgLevel.value = Math.min(0.5, level) * (1 - s.sleep * 0.85)
    const gain = 0.35 + 0.65 * s.energy + s.kick * DUST_KICK_GAIN // 安静段落背景也安静（T5 纪律沿用）
    for (const sh of this.shells) sh.mesh.rotation.y += dt * sh.speed * gain
    // 风搅包络：kick 快 attack（max 直取）慢 release（指数衰减）；uTime 随风加速——搅得越狂相位跑得越快
    this.windKick = Math.max(this.windKick * Math.exp(-dt / WIND_RELEASE), s.kick)
    this.uWind.value = (WIND_BASE + WIND_ENERGY * s.energy + WIND_KICK * this.windKick) * (1 - s.sleep * 0.85)
    this.uTime.value += dt * (1 + this.windKick * 2)
    // 高频细闪（形状改造④）：人声让位后高频接管背景尘埃鸡皮疙瘩，沉睡压暗同风场纪律
    this.uHighFlick.value = s.high * DUST_FLICK_GAIN * (1 - s.sleep * 0.85)
  }

  /** 降级路径（dropBgRipple 连带，亲验 fb1 修订①合并自已退役的 dropBgReflection）：近层隐藏，不重建 */
  setNearDust(on: boolean): void {
    this.near.mesh.visible = on
    this.fg.mesh.visible = on
  }

  /** 尘埃密度滑杆（亲验 fb1 修订④）：far/mid 两壳只调 InstancedMesh.count 收窄绘制子集——
   * 全量池已在构造时 seed 好，运行时改 count 是真省实例成本的先例做法（无需重建/重 seed）。
   * 近壳是点缀不受密度影响，仍单独归 setNearDust 管。下限钳 1，避免 count=0 触发绘制异常。 */
  setDustDensity(d: number): void {
    const far = this.shells[0]
    const mid = this.shells[1]
    far.mesh.count = Math.max(1, Math.floor(far.fullCount * d))
    mid.mesh.count = Math.max(1, Math.floor(mid.fullCount * d))
  }

  /** 尘埃粒径/亮度倍率（亲验 fb3）：纯 uniform 写入，拖动零重建零重编译 */
  setDustLook(size: number, bright: number): void {
    this.uDustSize.value = size
    this.uDustBright.value = bright
  }

  get lookForTest(): { size: number; bright: number } {
    return { size: this.uDustSize.value, bright: this.uDustBright.value }
  }

  get windForTest(): number {
    return this.uWind.value
  }

  get flickForTest(): number {
    return this.uHighFlick.value
  }

  get layersForTest(): {
    farCount: number; midCount: number; nearCount: number; nearVisible: boolean
    farDrawn: number; midDrawn: number
    fgCount: number; fgVisible: boolean
  } {
    return {
      farCount: this.shells[0].fullCount,
      midCount: this.shells[1].fullCount,
      nearCount: this.near.mesh.count,
      nearVisible: this.near.mesh.visible,
      farDrawn: this.shells[0].mesh.count,
      midDrawn: this.shells[1].mesh.count,
      fgCount: this.fg.mesh.count,
      fgVisible: this.fg.mesh.visible,
    }
  }

  dispose(): void {
    for (const sh of this.shells) { sh.geo.dispose(); sh.mat.dispose() }
  }
}
