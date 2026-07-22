// 星系点缀层（spec §六/§七 T8）：正在播放脉动 / hover 微亮 / 选中封面浮现 / 新星诞生微光。
// 辉光类效果（脉动/hover/诞生）共用光点星同款贴图（fb2：旧纯白径向渐变糙团退役，辉光与星同一质感）；
// 选中封面走独立 billboard 材质（含 map）。（全量近处封面已迁至 cover-atlas 图集）
import * as THREE from 'three/webgpu'
import { starTexture } from './star-sprites'

// ===== 亲验旋钮 =====
const PULSE_PERIOD = 1.6         // s，正在播放呼吸周期（spec 字面值）
const PULSE_AMPLITUDE = 0.25     // scale/opacity 呼吸幅度（spec 字面值）
const PULSE_SCALE = 0.17         // 世界单位，正在播放辉光基准尺寸（fb2：0.30 糙大球收敛为精致微光）
const PULSE_OPACITY = 0.6
const HOVER_SCALE = 0.10         // 小号辉光（fb2：随脉动同比例收敛）
const HOVER_OPACITY = 0.5
const ACCENT_FADE_RATE = 8       // hover/pulse 淡入淡出指数趋近速率
const COVER_SIZE = 0.22          // PlaneGeometry 边长（spec 字面值）
const COVER_TARGET_IN = 0.92     // 封面在场目标 opacity（spec 字面值）
const COVER_FADE_RATE = 6        // 封面淡入淡出指数趋近速率
const BIRTH_DURATION = 2.0       // s，诞生辉光总时长（spec："约 2s"）
const BIRTH_SCALE = 0.30         // fb2：随辉光家族整体收敛

/** 指数趋近一步：current 沿 rate 速率趋向 target（惯例同 camera.ts FOCUS_LERP 用法） */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

function makeGlowSprite(scale: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: starTexture(), color: 0xffffff, opacity, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(scale)
  sprite.visible = false
  return sprite
}

function makeCoverMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(COVER_SIZE, COVER_SIZE)
  const mat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, opacity: 0 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  return mesh
}

interface BirthGlow { sprite: THREE.Sprite; t: number }

export class GalaxyAccents {
  readonly group = new THREE.Group()

  private readonly pulseSprite = makeGlowSprite(PULSE_SCALE, PULSE_OPACITY)
  private pulseTarget: THREE.Vector3 | null = null
  private pulseAmount = 0 // 0..1 淡入淡出进度

  private readonly hoverSprite = makeGlowSprite(HOVER_SCALE, HOVER_OPACITY)
  private hoverTarget: THREE.Vector3 | null = null
  private hoverAmount = 0

  private readonly selectedMesh = makeCoverMesh()
  private selectedHasTex = false

  private birthGlows: BirthGlow[] = []
  private phase = 0 // 呼吸相位累计时间

  constructor() {
    this.group.add(this.pulseSprite, this.hoverSprite, this.selectedMesh)
  }

  setPulse(center: THREE.Vector3 | null): void {
    this.pulseTarget = center
    if (center) this.pulseSprite.position.copy(center)
  }

  setHover(center: THREE.Vector3 | null): void {
    this.hoverTarget = center
    if (center) this.hoverSprite.position.copy(center)
  }

  setSelected(center: THREE.Vector3 | null, tex: THREE.Texture | null): void {
    this.selectedHasTex = !!(center && tex)
    if (center) this.selectedMesh.position.copy(center)
    if (center && tex) {
      const mat = this.selectedMesh.material as THREE.MeshBasicMaterial
      mat.map = tex
      mat.needsUpdate = true
    }
  }

  /** 新星诞生辉光（spec §六）：director 对每颗新星调一次，0→峰值→消隐自行收尾，不占公开状态位 */
  spawnBirth(center: THREE.Vector3): void {
    const sprite = makeGlowSprite(BIRTH_SCALE, 0)
    sprite.position.copy(center)
    sprite.visible = true
    this.group.add(sprite)
    this.birthGlows.push({ sprite, t: 0 })
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.phase += dt
    const breathe = Math.sin((2 * Math.PI * this.phase) / PULSE_PERIOD)

    this.pulseAmount = approach(this.pulseAmount, this.pulseTarget ? 1 : 0, ACCENT_FADE_RATE, dt)
    this.pulseSprite.visible = this.pulseAmount > 0.002
    if (this.pulseSprite.visible) {
      const env = (1 + PULSE_AMPLITUDE * breathe) * this.pulseAmount
      this.pulseSprite.scale.setScalar(PULSE_SCALE * env)
      ;(this.pulseSprite.material as THREE.SpriteMaterial).opacity = PULSE_OPACITY * env
    }

    this.hoverAmount = approach(this.hoverAmount, this.hoverTarget ? 1 : 0, ACCENT_FADE_RATE, dt)
    this.hoverSprite.visible = this.hoverAmount > 0.002
    if (this.hoverSprite.visible) {
      this.hoverSprite.scale.setScalar(HOVER_SCALE * this.hoverAmount)
      ;(this.hoverSprite.material as THREE.SpriteMaterial).opacity = HOVER_OPACITY * this.hoverAmount
    }

    this.updateCoverMesh(this.selectedMesh, this.selectedHasTex, dt, camera)

    for (let i = this.birthGlows.length - 1; i >= 0; i--) {
      const b = this.birthGlows[i]
      b.t += dt
      const u = b.t / BIRTH_DURATION
      if (u >= 1) {
        this.group.remove(b.sprite)
        ;(b.sprite.material as THREE.SpriteMaterial).dispose()
        this.birthGlows.splice(i, 1)
        continue
      }
      const env = Math.sin(Math.PI * u) // 0→1→0，单峰渐亮渐隐
      ;(b.sprite.material as THREE.SpriteMaterial).opacity = env * PULSE_OPACITY
      b.sprite.scale.setScalar(BIRTH_SCALE * (0.7 + 0.3 * env))
    }
  }

  /** 封面 billboard 公共步进：朝相机 + opacity 指数趋近（在场 0.92 / 离场 0），到 0 收 visible（spec 字面值） */
  private updateCoverMesh(mesh: THREE.Mesh, shouldShow: boolean, dt: number, camera: THREE.PerspectiveCamera): void {
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = approach(mat.opacity, shouldShow ? COVER_TARGET_IN : 0, COVER_FADE_RATE, dt)
    mesh.quaternion.copy(camera.quaternion) // 每帧朝相机（spec 字面值），与可见性无关，避免刚淡入的首帧朝向滞后
    if (mat.opacity < 0.004) {
      mat.opacity = 0
      mesh.visible = false
    } else {
      mesh.visible = true
    }
  }

  dispose(): void {
    for (const b of this.birthGlows) { this.group.remove(b.sprite); (b.sprite.material as THREE.SpriteMaterial).dispose() }
    this.birthGlows = []
    ;(this.pulseSprite.material as THREE.SpriteMaterial).dispose()
    ;(this.hoverSprite.material as THREE.SpriteMaterial).dispose()
    this.selectedMesh.geometry.dispose()
    ;(this.selectedMesh.material as THREE.MeshBasicMaterial).dispose()
    // 共享辉光贴图不在此 dispose：模块级单例随进程存活，非本实例私产
  }
}
