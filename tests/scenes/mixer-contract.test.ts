import { describe, it, expect } from 'vitest'
import { BODY_MIXER_GROUPS, mixerGroupsFor } from '../../src/scenes/nebula/shapes/mixer-contract'
import { DEFAULT_MOTION_SETTINGS, MOTION_LIMITS } from '../../src/scenes/nebula/motion/types'
import type { BodyKind } from '../../src/scenes/nebula/shapes/types'

const BODIES: BodyKind[] = ['particles', 'spectrum', 'waveform', 'eclipse', 'ledmatrix', 'laser']

describe('调音台契约声明表（调音台规范化：形状即模块）', () => {
  it('每个主体类分组非空，且组内旋钮非空', () => {
    for (const b of BODIES) {
      const groups = mixerGroupsFor(b)
      expect(groups.length).toBeGreaterThan(0)
      for (const g of groups) expect(g.knobs.length).toBeGreaterThan(0)
    }
  })
  it('旋钮键全部在 MOTION_LIMITS 内（量程单一事实源，契约只引用不复制）', () => {
    for (const b of BODIES) for (const g of mixerGroupsFor(b)) for (const k of g.knobs) {
      expect(MOTION_LIMITS[k.key]).toBeDefined()
    }
  })
  it('toggle 键指向 MotionSettings 的 boolean 字段', () => {
    for (const b of BODIES) for (const g of mixerGroupsFor(b)) for (const t of g.toggles ?? []) {
      expect(typeof DEFAULT_MOTION_SETTINGS[t.key]).toBe('boolean')
    }
  })
  it('现状文案锚：粒子体=运动组常驻无线条组；线条体=运动组改题+线条组', () => {
    const p = mixerGroupsFor('particles')
    expect(p.map((g) => g.title)).toEqual(['运动（封面/星云）'])
    for (const b of ['spectrum', 'waveform'] as const) {
      const titles = mixerGroupsFor(b).map((g) => g.title)
      expect(titles).toEqual(['运动（封面接管时生效）', '线条（频谱环/波形线）'])
    }
    const trioTitles: Record<string, string> = { eclipse: '线条（日食）', ledmatrix: '线条（点阵）', laser: '线条（激光）' }
    for (const b of ['eclipse', 'ledmatrix', 'laser'] as const) {
      expect(mixerGroupsFor(b).map((g) => g.title)).toEqual(['运动（封面接管时生效）', trioTitles[b]])
    }
  })
  it('线条组两旋钮=lineBrightness/lineBarHeight；运动组五旋钮+频闪 toggle（渲染逐项一致的锚）', () => {
    const line = mixerGroupsFor('spectrum')[1]
    expect(line.knobs.map((k) => k.key)).toEqual(['lineBrightness', 'lineBarHeight'])
    const motion = mixerGroupsFor('particles')[0]
    expect(motion.knobs.map((k) => k.key)).toEqual(['bombIntensity', 'detailDensity', 'waveSpeed', 'buildDepth', 'climaxBrightness'])
    expect((motion.toggles ?? []).map((t) => t.key)).toEqual(['strobeEnabled'])
  })
  it('三连图形类专属旋钮组(fb1):亮度共享+各三专属', () => {
    const expects: Record<string, string[]> = {
      eclipse: ['lineBrightness', 'eclipseWaveLen', 'eclipseWaveGap', 'eclipseCorona'],
      ledmatrix: ['lineBrightness', 'ledDensity', 'ledWaveSpeed', 'ledCross'],
      laser: ['lineBrightness', 'laserMaxCount', 'laserSpread', 'laserSpeed', 'laserChaos'],
    }
    for (const b of ['eclipse', 'ledmatrix', 'laser'] as const) {
      expect(mixerGroupsFor(b)[1].knobs.map((k) => k.key)).toEqual(expects[b])
    }
  })
  it('scope 全部合法（本期只有 class 真实存在；shape 为占位语义），且 BODY_MIXER_GROUPS 与 mixerGroupsFor 同源', () => {
    for (const b of BODIES) {
      expect(mixerGroupsFor(b)).toBe(BODY_MIXER_GROUPS[b])
      for (const g of mixerGroupsFor(b)) expect(['class', 'shape']).toContain(g.scope)
    }
  })
})
