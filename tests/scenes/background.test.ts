import { describe, it, expect } from 'vitest'
import * as THREE from 'three/webgpu'
import { NebulaBackground } from '../../src/scenes/nebula/background'

const sig = { deep: new THREE.Color(0.1, 0.1, 0.3), energy: 0.5, drop: 0, sleep: 0, kick: 0, high: 0 }

describe('NebulaBackground 三层视差尘埃', () => {
  it('远/中两层瓜分 dustCount，近层固定小量且受 nearDust 开关控制', () => {
    const bg = new NebulaBackground(15_000, true)
    const L = bg.layersForTest
    expect(L.farCount + L.midCount).toBe(15_000)
    expect(L.nearCount).toBeGreaterThan(0)
    expect(L.nearCount).toBeLessThan(1_000) // 近层是点缀不是幕布
    expect(L.nearVisible).toBe(true)
    bg.dispose()
  })
  it('nearDust=false 构造：近层不可见；setNearDust 可运行时关闭（降级）', () => {
    const off = new NebulaBackground(6_000, false)
    expect(off.layersForTest.nearVisible).toBe(false)
    off.dispose()
    const on = new NebulaBackground(6_000, true)
    on.setNearDust(false)
    expect(on.layersForTest.nearVisible).toBe(false)
    on.dispose()
  })
  it('update 可run（自转推进不抛错），渐变平面已移除（group 无 PlaneGeometry 大平面）', () => {
    const bg = new NebulaBackground(6_000, true)
    bg.update(0.016, sig)
    const bigPlanes = bg.group.children.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    )
    expect(bigPlanes).toHaveLength(0)
    bg.dispose()
  })
})

describe('NebulaBackground 尘埃密度/节奏提速（亲验 fb1 修订④）', () => {
  it('setDustDensity(0.5)：远/中两壳绘制量≈上限池一半，近壳不受影响', () => {
    const bg = new NebulaBackground(10_000, true)
    const before = bg.layersForTest
    bg.setDustDensity(0.5)
    const after = bg.layersForTest
    expect(after.farDrawn).toBe(Math.floor(before.farCount * 0.5))
    expect(after.midDrawn).toBe(Math.floor(before.midCount * 0.5))
    expect(after.nearCount).toBe(before.nearCount) // 近壳绘制量不随密度变
    bg.dispose()
  })

  it('setDustDensity(0) 下限钳 ≥1（避免 count=0）', () => {
    const bg = new NebulaBackground(10_000, true)
    bg.setDustDensity(0)
    const L = bg.layersForTest
    expect(L.farDrawn).toBeGreaterThanOrEqual(1)
    expect(L.midDrawn).toBeGreaterThanOrEqual(1)
    bg.dispose()
  })

  it('kick 包络顶转速：同 dt 下 kick=1 比 kick=0 转角更大（音浪扑面）', () => {
    const kickOff = new NebulaBackground(1_000, false)
    const kickOn = new NebulaBackground(1_000, false)
    kickOff.update(0.1, { ...sig, kick: 0 })
    kickOn.update(0.1, { ...sig, kick: 1 })
    const farOff = kickOff.group.children[0].rotation.y
    const farOn = kickOn.group.children[0].rotation.y
    expect(Math.abs(farOn)).toBeGreaterThan(Math.abs(farOff))
    kickOff.dispose()
    kickOn.dispose()
  })
})

describe('NebulaBackground 尘埃观感（亲验 fb3：尺寸/亮度 uniform）', () => {
  it('setDustLook 写入 uniform：拖动零重建（实例对象引用不变）', () => {
    const bg = new NebulaBackground(1_000, true)
    const meshBefore = bg.group.children[0]
    bg.setDustLook(2, 1.5)
    expect(bg.lookForTest).toEqual({ size: 2, bright: 1.5 })
    expect(bg.group.children[0]).toBe(meshBefore) // 无重建
    bg.dispose()
  })
})

describe('NebulaBackground 前景飘尘层（亲验 fb3：覆盖镜头轨道 [1.0,4.6]）', () => {
  it('前景层是点缀（不受密度滑杆控），随 nearDust 开关与近壳同命运', () => {
    const bg = new NebulaBackground(2_000, true)
    const L1 = bg.layersForTest
    expect(L1.fgCount).toBeGreaterThan(0)
    expect(L1.fgCount).toBeLessThan(500) // 点缀不是幕布
    expect(L1.fgVisible).toBe(true)
    bg.setDustDensity(0.1)
    expect(bg.layersForTest.fgCount).toBe(L1.fgCount) // 密度滑杆不碰前景层
    bg.setNearDust(false)
    expect(bg.layersForTest.fgVisible).toBe(false)
    expect(bg.layersForTest.nearVisible).toBe(false)
    bg.dispose()
  })
  it('nearDust=false 构造：前景层与近壳一同不可见（mid/low 档零成本）', () => {
    const bg = new NebulaBackground(2_000, false)
    expect(bg.layersForTest.fgVisible).toBe(false)
    bg.dispose()
  })
})

describe('NebulaBackground 风搅乱流（亲验 fb3：鼓点冲散、快起慢收）', () => {
  it('kick=1 单帧冲高 uWind；随后 kick=0 连续帧单调衰减但不低于静息底', () => {
    const bg = new NebulaBackground(1_000, true)
    bg.update(0.016, { ...sig, kick: 0 })
    const rest = bg.windForTest
    bg.update(0.016, { ...sig, kick: 1 })
    const peak = bg.windForTest
    expect(peak).toBeGreaterThan(rest * 2) // 冲击显著
    let prev = peak
    for (let i = 0; i < 30; i++) {
      bg.update(0.05, { ...sig, kick: 0 })
      expect(bg.windForTest).toBeLessThanOrEqual(prev) // 单调回落
      prev = bg.windForTest
    }
    expect(prev).toBeGreaterThan(0) // 静息仍有微幅漂浮（尘埃永远是活的）
    bg.dispose()
  })
  it('沉睡压暗风场：sleep=1 时 uWind 显著低于清醒同参', () => {
    const awake = new NebulaBackground(1_000, true)
    const asleep = new NebulaBackground(1_000, true)
    awake.update(0.016, { ...sig, kick: 0.5, sleep: 0 })
    asleep.update(0.016, { ...sig, kick: 0.5, sleep: 1 })
    expect(asleep.windForTest).toBeLessThan(awake.windForTest * 0.3)
    awake.dispose(); asleep.dispose()
  })

  it('高频细闪（形状改造④）：update 传 high → uHighFlick=high×增益；无 high 帧回零', () => {
    const bg = new NebulaBackground(100, true)
    bg.update(1 / 60, { deep: new THREE.Color(0, 0, 0.4), energy: 0.5, drop: 0, sleep: 0, kick: 0, high: 1 })
    const peak = bg.flickForTest
    expect(peak).toBeGreaterThan(0.3)
    bg.update(1 / 60, { deep: new THREE.Color(0, 0, 0.4), energy: 0.5, drop: 0, sleep: 0, kick: 0, high: 0 })
    expect(bg.flickForTest).toBe(0)
  })
})
