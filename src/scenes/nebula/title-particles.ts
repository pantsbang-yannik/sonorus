// 切歌拼字渲染类（spec §5.1）：独立于主池的小粒子系统，无 compute kernel——
// 位置 = 目标点 + 每粒固定散射向量 × uSpread，动画全靠 CPU（TitleFxProgram）驱动两枚 uniform。
// 模板 = background.ts 尘埃层（instancedArray CPU 一次性写入 + SpriteNodeMaterial additive）。
import * as THREE from 'three/webgpu'
import { uniform, uv, vec3, mix, smoothstep, saturate, float, hash, instanceIndex, instancedArray } from 'three/tsl'
import type { ShapePointCloud } from './cover-points'
import { POS_Y_PRESET } from './title-fx'

const SCATTER_DIST = 1.2 // uSpread=1 时的最大散布半径（世界单位）
const VISIBLE_EPS = 0.002
/** 朝向缓跟随时间常数（秒）：亲验 fb3 §C 推翻「出生定格看侧面」拍板——镜头环绕大角度后
 * 文字读作斜线切过画面。0.8s 阻尼=永远基本面向镜头，又保留轻微角度漂移的空间感（非硬 billboard） */
const ORIENT_TAU = 0.8

export class TitleParticles {
  readonly group = new THREE.Group()
  readonly capacity: number

  private readonly uSpread = uniform(1)
  private readonly uFade = uniform(0)
  private readonly uScale = uniform(1) // 整体大小倍率（设置「歌名大小」）：布局与粒径同乘，热调不重采样
  private readonly uBrightness = uniform(1) // 亮度倍率（设置「亮度」）：只乘 colorNode（additive 下色强即亮度），不动 opacity 的软边形状
  private readonly uColorMain = uniform(new THREE.Color(0.9, 0.9, 1.0))
  private readonly uColorHi = uniform(new THREE.Color(1.0, 1.0, 1.0))
  private readonly targets: THREE.StorageBufferNode<'vec3'> // 类型对齐 particles.ts:97 惯例
  private readonly mesh: THREE.InstancedMesh
  private readonly geo: THREE.PlaneGeometry
  private readonly mat: THREE.SpriteNodeMaterial

  constructor(capacity: number) {
    this.capacity = capacity
    // 节点引用保持同作用域内联（particles.ts:109 惯例，M2-conclusions ③）
    const targets = instancedArray(capacity, 'vec3')
    this.targets = targets

    this.mat = new THREE.SpriteNodeMaterial({
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    })
    // 每粒固定散射向量（立方体内均匀 → 归一意义不大，字形收拢时视觉自然）＋ 每粒距离系数 0.6..1.4：
    // 同一 uSpread 下各粒散布半径不同，汇聚/消散自带参差感，不需逐粒相位
    const dir = vec3(
      hash(instanceIndex.add(17)).sub(0.5),
      hash(instanceIndex.add(31)).sub(0.5),
      hash(instanceIndex.add(47)).sub(0.5)
    ).mul(2)
    const dist = hash(instanceIndex.add(7)).mul(0.8).add(0.6)
    // 整段局部坐标（目标点+散射位移）统一乘 uScale：字形/散布/粒径等比缩放，观感一致
    this.mat.positionNode = targets.element(instanceIndex)
      .add(dir.mul(this.uSpread).mul(dist).mul(float(SCATTER_DIST)))
      .mul(this.uScale)
    this.mat.scaleNode = float(0.008).add(hash(instanceIndex.add(11)).mul(0.006)).mul(this.uScale)
    // 圆形软边 sprite × 整体 fade × 每粒静态明暗差（0.55..1，字面有细闪质感而非平板）
    const disc = saturate(smoothstep(0.0, 0.5, uv().sub(0.5).length()).oneMinus()).pow(1.5)
    this.mat.opacityNode = disc.mul(this.uFade).mul(hash(instanceIndex.add(3)).mul(0.45).add(0.55))
    // 主色/高光按粒子哈希混合，×1.6 让 additive + bloom 有发光余量；低档无 bloom 也够亮。
    // 再乘 uBrightness（用户亮度档位，默认 1=原观感）
    this.mat.colorNode = mix(vec3(this.uColorMain), vec3(this.uColorHi), hash(instanceIndex.add(23)))
      .mul(1.6).mul(this.uBrightness)

    this.geo = new THREE.PlaneGeometry(1, 1)
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity)
    this.mesh.frustumCulled = false
    // 文字层压过日食黑盘(renderOrder 1)——additive 层间加法可交换,提序对其余画面零变化（图形三连终审 I-1）
    this.mesh.renderOrder = 2
    this.group.add(this.mesh)
    this.group.position.set(0, POS_Y_PRESET.top, 0)
    this.group.visible = false
  }

  /** 契约：cloud.positions 长度必须 ≥ capacity*3（调用方以 capacity 为 count 采样保证）。
   * subarray 只防超长不防偏短——偏短会残留上一首的尾巴点。二期歌词复用本类前先加护栏。 */
  setCloud(cloud: ShapePointCloud): void {
    const arr = this.targets.value.array as Float32Array
    arr.set(cloud.positions.subarray(0, this.capacity * 3))
    this.targets.value.needsUpdate = true
  }

  setFrame(spread: number, fade: number, dim: number): void {
    this.uSpread.value = spread
    this.uFade.value = fade * dim
    this.group.visible = this.uFade.value > VISIBLE_EPS
  }

  setPalette(primary: THREE.Color, highlight: THREE.Color): void {
    this.uColorMain.value.copy(primary)
    this.uColorHi.value.copy(highlight)
  }

  setScale(k: number): void {
    this.uScale.value = k
  }

  setBrightness(k: number): void {
    this.uBrightness.value = k
  }

  /** 悬浮高度（歌词位置滑块）：滑块连续值直接落 y，三档表退役 */
  setAnchorY(y: number): void {
    this.group.position.y = y
  }

  orientTo(camPos: THREE.Vector3): void {
    this.group.lookAt(camPos)
  }

  private readonly orientTmp = new THREE.Object3D()

  /** 每帧阻尼缓跟随镜头（spawn 帧仍走 orientTo 瞬时对准，本方法只负责此后的持续追随） */
  faceCamera(camPos: THREE.Vector3, dt: number): void {
    this.orientTmp.position.copy(this.group.position)
    this.orientTmp.lookAt(camPos)
    this.group.quaternion.slerp(this.orientTmp.quaternion, 1 - Math.exp(-dt / ORIENT_TAU))
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
