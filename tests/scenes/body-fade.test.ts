import { describe, it, expect } from 'vitest'
import { BODY_SLOTS, BodyCrossfade, slotOfBody } from '../../src/scenes/nebula/linework/body-fade'

describe('BodyCrossfade(图形三连:多槽主体交接)', () => {
  it('初始态:粒子 1 其余 0(与旧 bodyFade=1 行为等价)', () => {
    const x = new BodyCrossfade()
    expect(x.fadeOf('particles')).toBe(1)
    for (const s of BODY_SLOTS) if (s !== 'particles') expect(x.fadeOf(s)).toBe(0)
  })
  it('推进收敛:active=eclipse 走满 fadeSec 后 eclipse=1、particles=0', () => {
    const x = new BodyCrossfade()
    for (let i = 0; i < 40; i++) x.update(1 / 60, 'eclipse', 0.6)
    expect(x.fadeOf('eclipse')).toBe(1)
    expect(x.fadeOf('particles')).toBe(0)
  })
  it('线性速率:单帧步长=dt/fadeSec,半程换目标无跳变', () => {
    const x = new BodyCrossfade()
    x.update(0.3, 'eclipse', 0.6) // 半程
    expect(x.fadeOf('eclipse')).toBeCloseTo(0.5, 5)
    expect(x.fadeOf('particles')).toBeCloseTo(0.5, 5)
    x.update(0.3, 'particles', 0.6) // 反向半程回满
    expect(x.fadeOf('particles')).toBeCloseTo(1, 5)
  })
  it('线条↔线条互切:粒子槽恒 0 不闪现(spec 风险决策)', () => {
    const x = new BodyCrossfade()
    for (let i = 0; i < 40; i++) x.update(1 / 60, 'eclipse', 0.6)
    for (let i = 0; i < 20; i++) {
      x.update(1 / 60, 'laser', 0.6)
      expect(x.fadeOf('particles')).toBe(0)
    }
    for (let i = 0; i < 40; i++) x.update(1 / 60, 'laser', 0.6)
    expect(x.fadeOf('laser')).toBe(1)
    expect(x.fadeOf('eclipse')).toBe(0)
  })
  it('slotOfBody:spectrum/waveform 归并 linework 槽,其余原名直通', () => {
    expect(slotOfBody('particles')).toBe('particles')
    expect(slotOfBody('spectrum')).toBe('linework')
    expect(slotOfBody('waveform')).toBe('linework')
    expect(slotOfBody('eclipse')).toBe('eclipse')
    expect(slotOfBody('ledmatrix')).toBe('ledmatrix')
    expect(slotOfBody('laser')).toBe('laser')
  })
})
