// 星系运镜（spec §七）：缓慢环绕自动漫游 + 拖拽/滚轮介入（静置恢复）+ 选中星推近。
// 独立于 CameraDirector（galaxy 期 director 不 update、其 manual 输入经 setManualEnabled(false) 关断）。
import * as THREE from 'three/webgpu'
import { MIRROR_Y } from '../background-types'

const AUTO_YAW_SPEED = 0.02        // rad/s，一圈 ~5 分钟（屏保气质）
const RESUME_SECONDS = 5           // 手动介入静置多久恢复自动
const DRAG_SENS = 0.005
const WHEEL_SENS = 0.002
const PITCH_BASE = 0.34            // 默认俯视角
const PITCH_LIMIT = 1.2
const DIST_MIN_SCALE = 0.45        // 相对 baseDist 的推拉窗口
const DIST_MAX_SCALE = 1.9
const FOCUS_DIST = 0.85            // 选中星推近距离
const FOCUS_LERP = 2.5             // 推近/回位的指数趋近速率
const CLICK_MAX_PX = 5
const CAM_HARD_FLOOR_Y = MIRROR_Y + 0.15

export class GalaxyCamera {
  private yaw = 0
  private pitch = PITCH_BASE
  private baseDist = 3
  private distOffset = 0
  private idle = RESUME_SECONDS    // 起始即自动
  private dragging = false
  private lastX = 0; private lastY = 0
  private downX = 0; private downY = 0
  private click: { x: number; y: number } | null = null
  private pointer: { x: number; y: number } | null = null // 最近一次 pointermove 坐标（不限拖拽中），T8 hover 拾取消费
  private focus: THREE.Vector3 | null = null
  private lookAt = new THREE.Vector3(0, 0, 0)  // 当前注视点（原点↔选中星 指数趋近）
  private exitHome: THREE.Vector3 | null = null // 退出过渡目标（评审 P1：restore 期把镜头送回 HOME，消相位落地硬跳）
  private attached = false

  constructor(private dom: HTMLElement) {}

  private onDown = (e: PointerEvent): void => {
    this.dragging = true
    this.lastX = this.downX = e.clientX
    this.lastY = this.downY = e.clientY
  }
  private onMove = (e: PointerEvent): void => {
    this.pointer = { x: e.clientX, y: e.clientY }
    if (!this.dragging) return
    this.yaw -= (e.clientX - this.lastX) * DRAG_SENS
    this.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, this.pitch + (e.clientY - this.lastY) * DRAG_SENS))
    this.lastX = e.clientX; this.lastY = e.clientY
    this.idle = 0
  }
  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < CLICK_MAX_PX) {
      this.click = { x: e.clientX, y: e.clientY } // 点击（非拖拽）：Task 9 拾取消费
    }
  }
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const lo = this.baseDist * (DIST_MIN_SCALE - 1), hi = this.baseDist * (DIST_MAX_SCALE - 1)
    this.distOffset = Math.min(hi, Math.max(lo, this.distOffset + e.deltaY * WHEEL_SENS))
    this.idle = 0
  }

  attach(): void {
    this.exitHome = null // 重挂即回星系语义：restore→再进入路径 attach 时相机未曾 detach,exitHome 清零必须在幂等守卫之前(审查抓漏:守卫早退会把镜头钉死在 HOME)
    if (this.attached) return
    this.attached = true
    this.dom.addEventListener('pointerdown', this.onDown)
    this.dom.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    this.dom.addEventListener('wheel', this.onWheel, { passive: false })
  }
  detach(): void {
    if (!this.attached) return
    this.attached = false
    this.dom.removeEventListener('pointerdown', this.onDown)
    this.dom.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    this.dom.removeEventListener('wheel', this.onWheel)
    this.dragging = false
    this.pointer = null // 脱手即清：re-attach 前不留幽灵 hover 坐标
  }
  /** hover 拾取消费（T8）：CSS px（e.clientX/Y），director 换算画布本地坐标后喂 pickStar */
  get lastPointer(): { x: number; y: number } | null { return this.pointer }
  setBaseDist(d: number): void { this.baseDist = d }
  setFocus(t: THREE.Vector3 | null): void { this.focus = t ? t.clone() : null }
  /** 退出过渡（评审 P1）：restore 相位继续调 update，镜头指数趋近 live 的 HOME 机位——
   * 相位落地时 CameraDirector 接管的合成位与此几乎重合，无单帧硬跳 */
  beginExit(home: THREE.Vector3): void { this.focus = null; this.exitHome = home.clone() }
  consumeClick(): { x: number; y: number } | null { const c = this.click; this.click = null; return c }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.idle += dt
    if (this.idle >= RESUME_SECONDS && !this.dragging) this.yaw += AUTO_YAW_SPEED * dt
    // 注视点与距离：选中星推近，否则回原点全景（指数趋近，无 tween 依赖）
    const targetLook = this.exitHome ? new THREE.Vector3(0, 0, 0) : (this.focus ?? new THREE.Vector3(0, 0, 0))
    const k = 1 - Math.exp(-FOCUS_LERP * dt)
    this.lookAt.lerp(targetLook, k)
    const targetDist = (this.focus ? FOCUS_DIST : this.baseDist) + this.distOffset
    const pos = this.exitHome
      ? this.exitHome.clone() // 退出过渡：直奔 HOME 机位
      : new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)
      ).multiplyScalar(targetDist).add(this.lookAt)
    if (pos.y < CAM_HARD_FLOOR_Y) pos.y = CAM_HARD_FLOOR_Y // 虚空之镜防穿面（硬钳，同 director 兜底）
    camera.position.lerp(pos, k) // 位置同速趋近：进出星系/选中切换都平滑
    camera.lookAt(this.lookAt)
  }
  dispose(): void { this.detach() }
}
