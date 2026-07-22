import { describe, it, expect } from 'vitest'
import { DialectConductor, type DialectUniforms } from '../../src/scenes/nebula/motion/dialects'
import { DEFAULT_MOTION_SETTINGS } from '../../src/scenes/nebula/motion/types'
import type { MotionInputs } from '../../src/scenes/nebula/motion/nebula-program'

function makeUniforms(): DialectUniforms {
  return {
    uDialContour: { value: 0 }, uDialHeart: { value: 0 },
    uDialCrystal: { value: 0 },
    uHeartPulse: { value: 0 }, uPointBeat: { value: 1 },
  }
}
const quiet: MotionInputs = {
  narrative: { phase: 'steady', progress: 0 } as MotionInputs['narrative'],
  low: 0, mid: 0, high: 0, kickEnv: 0, dropPulse: 0, kickStrength: 0, energy: 0,
  mapSpeed: 0, mapDensity: 0,
}
const s = { ...DEFAULT_MOTION_SETTINGS }

describe('DialectConductor 家族权重', () => {
  it('setFamily 矩阵：heart 含 contour 约束（法线浮雕+泵动），其余一对一；uPointBeat 仅 none=1（点源打击语法只留给星云/星球/封面）', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('heart')
    expect([u.uDialContour.value, u.uDialHeart.value, u.uPointBeat.value]).toEqual([1, 1, 0])
    c.setFamily('contour')
    expect([u.uDialContour.value, u.uDialHeart.value, u.uPointBeat.value]).toEqual([1, 0, 0])
    c.setFamily('none')
    expect([u.uDialContour.value, u.uDialHeart.value, u.uPointBeat.value]).toEqual([0, 0, 1])
  })

  it('批2 家族：crystal 门控开启且点源打击退役（uPointBeat=0）', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('crystal')
    expect(u.uDialCrystal.value).toBe(1)
    expect(u.uPointBeat.value).toBe(0)
    c.setFamily('none')
    expect(u.uDialCrystal.value).toBe(0)
    expect(u.uPointBeat.value).toBe(1)
  })
})

describe('心跳（用户拍板：音乐为主+静态微搏）', () => {
  it('鼓点帧触发收缩包络，随后衰减', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('heart')
    c.update(1 / 60, { ...quiet, kickStrength: 1 }, s)
    const peak = u.uHeartPulse.value
    expect(peak).toBeGreaterThan(0.5)
    for (let i = 0; i < 30; i++) c.update(1 / 60, quiet, s)
    expect(u.uHeartPulse.value).toBeLessThan(peak * 0.3)
  })
  it('无鼓点静默 → 60bpm 自主微搏接管：3s 静默期内出现 ≥2 次幅度 ≈0.22×bomb 的脉冲', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('heart')
    let maxSeen = 0
    let pulses = 0
    let prev = 0
    for (let i = 0; i < 180; i++) { // 3s @60fps；初始 sinceKick=∞ → 自主心跳立即活跃
      c.update(1 / 60, quiet, s)
      const v = u.uHeartPulse.value
      if (v > prev + 0.05) pulses++
      maxSeen = Math.max(maxSeen, v)
      prev = v
    }
    expect(pulses).toBeGreaterThanOrEqual(2)
    expect(maxSeen).toBeLessThan(0.3) // 微搏不抢戏：远低于满搏
  })
  it('鼓点回来 → 自主心跳让位（重置节拍器与静默计时）', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('heart')
    for (let i = 0; i < 120; i++) c.update(1 / 60, quiet, s) // 自主心跳已活跃
    c.update(1 / 60, { ...quiet, kickStrength: 0.9 }, s)     // 鼓点接管
    // 之后 1.4s（< HEART_IDLE_AFTER_SEC=1.5）内不得出现自主触发：包络只衰减
    let rising = false
    let prev = u.uHeartPulse.value
    for (let i = 0; i < 84; i++) {
      c.update(1 / 60, quiet, s)
      if (u.uHeartPulse.value > prev + 0.01) rising = true
      prev = u.uHeartPulse.value
    }
    expect(rising).toBe(false)
  })
  it('bombIntensity=0 → 方言可静音（uHeartPulse 恒 0）', () => {
    const u = makeUniforms()
    const c = new DialectConductor(u)
    c.setFamily('heart')
    c.update(1 / 60, { ...quiet, kickStrength: 1 }, { ...s, bombIntensity: 0 })
    expect(u.uHeartPulse.value).toBe(0)
  })
})

