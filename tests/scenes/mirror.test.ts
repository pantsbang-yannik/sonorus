import { describe, it, expect } from 'vitest'
import * as THREE from 'three/webgpu'
import { NebulaMirror } from '../../src/scenes/nebula/mirror'
import { MIRROR_Y } from '../../src/scenes/nebula/background-types'

const frame = (over: Record<string, unknown> = {}) => ({
  primary: new THREE.Color(0.5, 0.5, 1), energy: 0.5, sleep: 0, ripples: [], ...over,
})

describe('NebulaMirror（虚空之镜：亲验 fb1 修订①②——倒影退役，镜面上移贴模型）', () => {
  it('镜面平面位于 MIRROR_Y', () => {
    const m = new NebulaMirror({ ripple: true })
    const plane = m.group.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh
    expect(plane.position.y).toBeCloseTo(MIRROR_Y)
    m.dispose()
  })
  it('涟漪打包：RippleState[] 进 uniform（age/strength 逐通道），空位是哨兵 9/0', () => {
    const m = new NebulaMirror({ ripple: true })
    m.update(0.016, frame({ ripples: [{ age: 0.5, strength: 0.9 }, { age: 1.0, strength: 0.8 }] }))
    const s = m.stateForTest
    expect(s.rippleAge.x).toBeCloseTo(0.5)
    expect(s.rippleStrength.y).toBeCloseTo(0.8)
    expect(s.rippleAge.z).toBe(9) // 哨兵：无涟漪
    expect(s.rippleStrength.z).toBe(0)
    m.dispose()
  })
  it('沉睡压暗：sleepDim = 1 − sleep×0.85（涟漪环唯一的亮度纪律，倒影滑杆已随之退役）', () => {
    const m = new NebulaMirror({ ripple: true })
    m.update(0.016, frame({ sleep: 0 }))
    expect(m.stateForTest.sleepDim).toBeCloseTo(1)
    m.update(0.016, frame({ sleep: 1 }))
    expect(m.stateForTest.sleepDim).toBeCloseTo(0.15)
    m.dispose()
  })
  it('可构造更新（无 sky 参数——倒影解析天空/主粒子二次 draw 已整体退役）', () => {
    const m = new NebulaMirror({ ripple: false })
    m.update(0.016, frame())
    m.dispose()
  })
  it('caps.ripple=false：涟漪支路不入节点图（省 shader 成本，评审 P1），update 传涟漪也安全', () => {
    const m = new NebulaMirror({ ripple: false })
    expect(m.stateForTest.rippleEnabled).toBe(false)
    m.update(0.016, frame({ ripples: [{ age: 0.5, strength: 0.9 }] }))
    m.dispose()
  })
  it('caps.ripple=true：rippleEnabled 标记为真', () => {
    const m = new NebulaMirror({ ripple: true })
    expect(m.stateForTest.rippleEnabled).toBe(true)
    m.dispose()
  })
})
