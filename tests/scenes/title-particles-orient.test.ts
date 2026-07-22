import { describe, it, expect } from 'vitest'
import * as THREE from 'three/webgpu'
import { TitleParticles } from '../../src/scenes/nebula/title-particles'
import { LyricsParticles } from '../../src/scenes/nebula/lyrics/lyrics-particles'

const CAM = new THREE.Vector3(4, 0, 0) // 镜头在侧面：与初始朝向（-z 视轴）呈大角度

/** group 当前朝向与「lookAt(CAM) 目标朝向」的夹角（弧度） */
function angleToTarget(group: THREE.Object3D, cam: THREE.Vector3): number {
  const target = new THREE.Object3D()
  target.position.copy(group.position)
  target.lookAt(cam)
  return group.quaternion.angleTo(target.quaternion)
}

describe('歌词/歌名朝向阻尼缓跟随（亲验 fb3 §C：推翻「出生定格看侧面」拍板）', () => {
  it('faceCamera 单帧只走部分角度（阻尼），多帧后收敛到面向镜头', () => {
    for (const p of [new TitleParticles(1_000), new LyricsParticles(1_000)]) {
      const before = angleToTarget(p.group, CAM)
      expect(before).toBeGreaterThan(0.5) // 前置：初始确实偏得很开

      p.faceCamera(CAM, 0.016)
      const after1 = angleToTarget(p.group, CAM)
      expect(after1).toBeLessThan(before)        // 在转
      expect(after1).toBeGreaterThan(before * 0.5) // 但单帧远未到位（缓，不是硬 billboard）

      for (let i = 0; i < 300; i++) p.faceCamera(CAM, 0.016)
      expect(angleToTarget(p.group, CAM)).toBeLessThan(0.02) // ~5s 后收敛
      p.dispose()
    }
  })
  it('orientTo（spawn 帧）仍瞬时对准：一步到位', () => {
    const p = new TitleParticles(1_000)
    p.orientTo(CAM)
    expect(angleToTarget(p.group, CAM)).toBeLessThan(1e-6)
    p.dispose()
  })
})
