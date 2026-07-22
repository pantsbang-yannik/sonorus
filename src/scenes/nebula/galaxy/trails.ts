// 光轨（spec T9）：筛选命中星按聆听序连成一条渐变光带——首→尾亮度 0.15→1.0，
// 加色混合下暗端自然隐没＝「长曝光渐入」。director 只在 filterView 变化时调 setTrail 一次，非逐帧（spec §十一）。
import * as THREE from 'three/webgpu'

// ===== 亲验旋钮 =====
const TRAIL_TINT: [number, number, number] = [0.75, 0.85, 1.0] // 固定光轨色（spec 字面值，RGB 惯例同 star-sprites DEFAULT_TINT）
const TRAIL_BRIGHT_MIN = 0.15  // 首端亮度（spec 字面值）
const TRAIL_BRIGHT_MAX = 1.0   // 尾端亮度（spec 字面值）

export class GalaxyTrails {
  readonly group = new THREE.Group()
  private line: THREE.Line | null = null

  /** 重建光轨：先销毁旧 Line（geometry/material dispose），空数组只清除不新建 */
  setTrail(points: THREE.Vector3[]): void {
    this.clear()
    if (points.length === 0) return
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const n = points.length
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 1 // 单点退化：直接给尾端亮度，避免除零
      const bright = TRAIL_BRIGHT_MIN + (TRAIL_BRIGHT_MAX - TRAIL_BRIGHT_MIN) * u
      colors[i * 3] = TRAIL_TINT[0] * bright
      colors[i * 3 + 1] = TRAIL_TINT[1] * bright
      colors[i * 3 + 2] = TRAIL_TINT[2] * bright
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    })
    this.line = new THREE.Line(geometry, material)
    this.group.add(this.line)
  }

  private clear(): void {
    if (!this.line) return
    this.group.remove(this.line)
    this.line.geometry.dispose()
    ;(this.line.material as THREE.LineBasicMaterial).dispose()
    this.line = null
  }

  dispose(): void {
    this.clear()
  }
}
