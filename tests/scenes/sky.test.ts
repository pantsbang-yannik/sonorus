import { describe, it, expect } from 'vitest'
import * as THREE from 'three/webgpu'
import { NebulaSky } from '../../src/scenes/nebula/sky'

const base = {
  primary: new THREE.Color(0.5, 0.5, 1), deep: new THREE.Color(0.1, 0.1, 0.3),
  energy: 0, drop: 0, sleep: 0, flowMul: 1, level: 1, low: 0, mid: 0,
}

describe('NebulaSky（亮度纪律+流速积分）', () => {
  it('level 峰值钳 ≤0.5（黑是奢侈品）：energy=1+drop=1 也不过线', () => {
    const sky = new NebulaSky('full')
    sky.update(0.016, { ...base, energy: 1, drop: 1 })
    expect(sky.stateForTest.level).toBeLessThanOrEqual(0.5)
    sky.dispose()
  })
  it('沉睡压暗 ×0.15；滑杆 level=0 天空归零', () => {
    const sky = new NebulaSky('full')
    sky.update(0.016, { ...base, energy: 0.5, sleep: 1 })
    const slept = sky.stateForTest.level
    sky.update(0.016, { ...base, energy: 0.5, sleep: 0 })
    expect(slept).toBeCloseTo(sky.stateForTest.level * 0.15, 5)
    sky.update(0.016, { ...base, level: 0 })
    expect(sky.stateForTest.level).toBe(0)
    sky.dispose()
  })
  it('流速积分：flowMul=2 的时间推进是 1 的两倍（副歌加速语义）', () => {
    const a = new NebulaSky('full'); const b = new NebulaSky('full')
    for (let i = 0; i < 10; i++) {
      a.update(0.1, { ...base, flowMul: 1 })
      b.update(0.1, { ...base, flowMul: 2 })
    }
    expect(b.stateForTest.time).toBeCloseTo(a.stateForTest.time * 2, 5)
    a.dispose(); b.dispose()
  })
  it('频段接线（spec §四层①）：uLow→涡旋幅度、uMid→细波纹强度', () => {
    const sky = new NebulaSky('full')
    sky.update(0.016, { ...base, low: 0.8, mid: 0.6 })
    expect(sky.stateForTest.low).toBeCloseTo(0.8)
    expect(sky.stateForTest.mid).toBeCloseTo(0.6)
    sky.dispose()
  })
  it('simple 档同样可构造（降级路径）', () => {
    const sky = new NebulaSky('simple')
    expect(sky.mesh).toBeInstanceOf(THREE.Mesh)
    sky.dispose()
  })
})
