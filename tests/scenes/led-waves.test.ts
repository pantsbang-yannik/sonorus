import { describe, it, expect } from 'vitest'
import { LedWaves, LED_SLOTS, LED_WAVE_MAX_R, LED_DROP_AMP, LED_WAVE_SPEED } from '../../src/scenes/nebula/linework/led-waves'

const quiet = { onBeat: false, strength: 0, dropEdge: false, silence: false, sleeping: false, energy: 0.5, rateMul: 1 }
const beat = { ...quiet, onBeat: true, strength: 0.9 }

describe('LedWaves(图形三连:点阵环波 4 槽队列)', () => {
  it('初始全空槽(radii=MAX_R、amps=0)', () => {
    const w = new LedWaves()
    for (let i = 0; i < LED_SLOTS; i++) {
      expect(w.radii[i]).toBe(LED_WAVE_MAX_R)
      expect(w.amps[i]).toBe(0)
    }
  })
  it('beat 起环:占一槽 radius 归 0,amp 随 strength 落 (0.55,1]', () => {
    const w = new LedWaves()
    w.update(1 / 60, beat)
    const slot = w.radii.findIndex((r) => r < 1)
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(w.amps[slot]).toBeGreaterThan(0.55)
    expect(w.amps[slot]).toBeLessThanOrEqual(1)
  })
  it('冷却期阻双发:连续两帧 beat 只起一环', () => {
    const w = new LedWaves()
    w.update(1 / 60, beat)
    w.update(1 / 60, beat)
    expect(w.radii.filter((r) => r < 1).length).toBe(1)
  })
  it('行进单调外扩,rateMul=2 走两倍远', () => {
    const a = new LedWaves(); const b = new LedWaves()
    a.update(1 / 60, beat); b.update(1 / 60, beat)
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, quiet)
      b.update(1 / 60, { ...quiet, rateMul: 2 })
    }
    const ra = Math.min(...a.radii); const rb = Math.min(...b.radii)
    expect(ra).toBeGreaterThan(0)
    expect(rb).toBeCloseTo(ra * 2, 1)
  })
  it('满槽抢最旧(最大半径槽被复用),槽数恒 4', () => {
    const w = new LedWaves()
    for (let k = 0; k < 6; k++) {
      w.update(0.3, beat) // 0.3s > 冷却,每次都放行
    }
    expect(w.radii.length).toBe(LED_SLOTS)
    expect(w.radii.filter((r) => r < LED_WAVE_MAX_R).length).toBe(LED_SLOTS)
  })
  it('silence/sleeping 不起新环,已有环继续行进', () => {
    const w = new LedWaves()
    w.update(1 / 60, beat)
    w.update(0.3, quiet) // 越过冷却,排除冷却干扰
    const r0 = Math.min(...w.radii)
    w.update(1 / 60, { ...beat, silence: true })
    expect(w.radii.filter((r) => r < LED_WAVE_MAX_R).length).toBe(1) // 无新环
    expect(Math.min(...w.radii)).toBeGreaterThan(r0) // 旧环仍走
    w.update(1 / 60, { ...beat, sleeping: true })
    expect(w.radii.filter((r) => r < LED_WAVE_MAX_R).length).toBe(1)
  })
  it('dropEdge 大环:amp=LED_DROP_AMP,无视冷却', () => {
    const w = new LedWaves()
    w.update(1 / 60, beat)
    w.update(1 / 60, { ...quiet, dropEdge: true })
    expect(Math.max(...w.amps)).toBeCloseTo(LED_DROP_AMP, 5)
  })
  it('出界回收清幅:波前走满 MAX_R 后 amp 归零(防画板角落幽灵光斑)', () => {
    const w = new LedWaves()
    w.update(1 / 60, beat)
    const slot = w.radii.findIndex((r) => r < 1)
    w.update(LED_WAVE_MAX_R / LED_WAVE_SPEED + 1, quiet) // 一大步走满出界
    expect(w.radii[slot]).toBe(LED_WAVE_MAX_R)
    expect(w.amps[slot]).toBe(0)
  })
})
