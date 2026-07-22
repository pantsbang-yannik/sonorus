// 虚空之镜（spec §四层结构④ / 亲验 fb1 修订①②，用户拍板）：倒影三件套——①天空解析倒影
// ②主粒子镜像二次 draw ③星辰倒影——整体退役：默认机位（y≈0.2 望向原点）下倒影本就不可见，
// 保留无意义（Task 2.5 spike「全量倒影零成本」的结论随特性一起作废）。
// 镜面现在是「暗面 + 拍点涟漪画布」：极暗底色远端融黑防地平线（防海面化①，无地平线）；
// 常驻扰动只有拍点涟漪环——环身自发光大幅上调，在抬高后的 MIRROR_Y（贴近模型）默认机位下清晰可辨。
import * as THREE from 'three/webgpu'
import { uniform, vec3, float, positionWorld, saturate, exp } from 'three/tsl'
import { MIRROR_Y } from './background-types'
import { RIPPLE_LIFE_SEC, RIPPLE_MAX, type RippleState } from './ripples'

export const RIPPLE_SPEED = 2.4 // 世界单位/秒：2.2s 生命 → 单圈最远扩到 ~5.3u
const RIPPLE_AGE_SENTINEL = 9   // 远超生命周期=该通道无涟漪（着色器里衰减权重归零）
// 涟漪环自发光增益（手感值，亲验收敛）：原倒影配方里环身只是「敲了一下」的微亮点缀（0.06），
// 倒影退役、镜面上移贴模型后，涟漪本身升格为镜面唯一的动态内容——大幅上调才能在默认机位可感。
const RING_GLOW = 0.35
/** 涟漪出生中心亮斑（fb6 兑现「晚开花」留档假说）：环要长到可见尺寸才被看见（100~200ms 感知滞后），
 * 亮斑在 age≈0 即时点亮=「先响后扩」——打击的"响"由亮斑承担，"扩"由环承担。亲验起点值。 */
const RIPPLE_FLASH_RADIUS = 0.5  // 亮斑半径（世界单位，镜面上的高斯光斑）
const RIPPLE_FLASH_LIFE = 0.25   // 亮斑寿命（秒）：环长到约可见尺寸时亮斑恰好让位
const RIPPLE_FLASH_GAIN = 1.6    // 亮斑相对环的强度倍率：「响」要果断

export class NebulaMirror {
  readonly group = new THREE.Group()

  private readonly uRippleAge = uniform(new THREE.Vector3(RIPPLE_AGE_SENTINEL, RIPPLE_AGE_SENTINEL, RIPPLE_AGE_SENTINEL))
  private readonly uRippleStrength = uniform(new THREE.Vector3(0, 0, 0))
  private readonly uPrimary = uniform(new THREE.Color(0.35, 0.42, 1.0))
  private readonly uSleepDim = uniform(1) // 沉睡压暗：1=清醒满亮，越接近 0 涟漪环越暗（同旧倒影纪律的沉睡系数）

  private readonly geo: THREE.PlaneGeometry
  private readonly mat: THREE.MeshBasicNodeMaterial
  private readonly rippleOn: boolean

  constructor(caps: { ripple: boolean }) {
    this.rippleOn = caps.ripple
    this.geo = new THREE.PlaneGeometry(160, 160)
    this.mat = new THREE.MeshBasicNodeMaterial({ depthWrite: false })

    const d = positionWorld.xz.length() // 片元到场心的镜面距离
    const fade = exp(d.mul(-0.055))     // 25u 处 ~0.25：远端融黑，无地平线（防海面化①）
    const base = this.uPrimary.mul(0.04).mul(fade) // 极暗底色：镜面本体几乎不可见，只留一丝色温

    // 涟漪支路按 caps 裁剪（评审 P1 纪律沿用）：ripple=false 时三圈高斯/uniform 整段不进节点图
    if (this.rippleOn) {
      const rip = this.rippleField(d)
      // 环内侧暗压：多环叠加时用 saturate 顶住总量，避免多圈重叠糊成一片亮斑，保持「一圈圈涟漪」的读法
      const glow = this.uPrimary.mul(saturate(rip).mul(RING_GLOW)).mul(this.uSleepDim)
      this.mat.colorNode = vec3(base.add(glow.mul(fade)))
    } else {
      this.mat.colorNode = vec3(base)
    }

    const plane = new THREE.Mesh(this.geo, this.mat)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = MIRROR_Y
    plane.renderOrder = -2 // 天空(-3)之上、主场景之下
    plane.frustumCulled = false
    this.group.add(plane)
  }

  /** 三通道高斯涟漪环之和。只在 rippleOn 时被调用；哨兵 age=9 经 life 权重自然归零 */
  private rippleField(d: ReturnType<typeof float>): ReturnType<typeof float> {
    const ring = (age: ReturnType<typeof float>, strength: ReturnType<typeof float>): ReturnType<typeof float> => {
      const r = age.mul(RIPPLE_SPEED)
      const q = d.sub(r).div(0.35)
      const life = saturate(age.div(RIPPLE_LIFE_SEC).oneMinus())
      const ringTerm = exp(q.mul(q).negate()).mul(strength).mul(life)
      // 出生中心亮斑：age→0 满亮、RIPPLE_FLASH_LIFE 内线性让位；高斯随 d 衰减
      const flashLife = saturate(age.div(RIPPLE_FLASH_LIFE).oneMinus())
      const flashTerm = exp(d.div(RIPPLE_FLASH_RADIUS).pow(2).negate())
        .mul(strength).mul(flashLife).mul(RIPPLE_FLASH_GAIN)
      return ringTerm.add(flashTerm)
    }
    return ring(float(this.uRippleAge.x), float(this.uRippleStrength.x))
      .add(ring(float(this.uRippleAge.y), float(this.uRippleStrength.y)))
      .add(ring(float(this.uRippleAge.z), float(this.uRippleStrength.z)))
  }

  /** 每帧：涟漪打包 + palette + 沉睡压暗 */
  update(dt: number, s: { primary: THREE.Color; energy: number; sleep: number; ripples: RippleState[] }): void {
    this.uPrimary.value.copy(s.primary)
    this.uSleepDim.value = 1 - s.sleep * 0.85
    const age = this.uRippleAge.value
    const str = this.uRippleStrength.value
    age.set(RIPPLE_AGE_SENTINEL, RIPPLE_AGE_SENTINEL, RIPPLE_AGE_SENTINEL)
    str.set(0, 0, 0)
    s.ripples.slice(0, RIPPLE_MAX).forEach((r, i) => {
      age.setComponent(i, r.age)
      str.setComponent(i, r.strength)
    })
  }

  get stateForTest(): { rippleAge: THREE.Vector3; rippleStrength: THREE.Vector3; sleepDim: number; rippleEnabled: boolean } {
    return {
      rippleAge: this.uRippleAge.value as THREE.Vector3,
      rippleStrength: this.uRippleStrength.value as THREE.Vector3,
      sleepDim: this.uSleepDim.value as number,
      rippleEnabled: this.rippleOn,
    }
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
