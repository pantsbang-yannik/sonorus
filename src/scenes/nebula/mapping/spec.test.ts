import { describe, it, expect } from 'vitest'
import { MAPPING_SPEC, defaultRhythmPreset, sanitizeMappingValues, GAIN_MAX, SMOOTHING_MAX_MS } from './spec'
import { VISUAL_TARGETS, ALLOWED_SOURCES } from './types'

describe('MAPPING_SPEC', () => {
  it('每个目标都有 primary slot，其 default.source 在白名单内', () => {
    for (const t of VISUAL_TARGETS) {
      const slot = MAPPING_SPEC[t]
      expect(slot.primary).toBeDefined()
      expect(ALLOWED_SOURCES[t]).toContain(slot.primary.default.source)
      if (slot.secondary) expect(ALLOWED_SOURCES[t]).toContain(slot.secondary.default.source)
    }
  })
})

describe('defaultRhythmPreset', () => {
  it('version=1 且五类目标齐全', () => {
    const p = defaultRhythmPreset()
    expect(p.version).toBe(1)
    expect(Object.keys(p.targets).sort()).toEqual([...VISUAL_TARGETS].sort())
  })
  it('承接 spec §5.6 默认接线', () => {
    const p = defaultRhythmPreset()
    expect(p.targets.space.primary.source).toBe('beat')
    expect(p.targets.brightness.primary.source).toBe('beat')
    expect(p.targets.density.primary.source).toBe('energy')
    expect(p.targets.thickness.primary.source).toBe('low')
    expect(p.targets.speed.primary.source).toBe('tempo')
  })
})

describe('sanitizeMappingValues', () => {
  it('null/垃圾输入回退默认预设', () => {
    expect(sanitizeMappingValues(null)).toEqual(defaultRhythmPreset())
    expect(sanitizeMappingValues('nope')).toEqual(defaultRhythmPreset())
  })
  it('非法 source（不在白名单）回退该 slot 默认', () => {
    const bad = defaultRhythmPreset()
    bad.targets.thickness.primary.source = 'high' // high 不在 thickness 白名单
    const clean = sanitizeMappingValues(bad)
    expect(clean.targets.thickness.primary.source).toBe('low') // 回退默认
  })
  it('gain / smoothingMs 被 clamp 到安全范围', () => {
    const bad = defaultRhythmPreset()
    bad.targets.space.primary.gain = 9999
    bad.targets.space.primary.smoothingMs = -50
    const clean = sanitizeMappingValues(bad)
    expect(clean.targets.space.primary.gain).toBeLessThanOrEqual(GAIN_MAX)
    expect(clean.targets.space.primary.smoothingMs).toBeGreaterThanOrEqual(0)
    expect(clean.targets.space.primary.smoothingMs).toBeLessThanOrEqual(SMOOTHING_MAX_MS)
  })
  it('缺失 target 按默认补齐', () => {
    const partial = { version: 1, targets: { space: defaultRhythmPreset().targets.space } }
    const clean = sanitizeMappingValues(partial)
    expect(clean.targets.thickness.primary.source).toBe('low')
  })
  it('只保留已知字段（不夹带 spec 元数据 label）', () => {
    const clean = sanitizeMappingValues(defaultRhythmPreset())
    expect((clean.targets.space.primary as unknown as Record<string, unknown>).label).toBeUndefined()
  })
  it('sanitize 对默认预设是幂等的（往返不腐蚀任何字段）', () => {
    expect(sanitizeMappingValues(defaultRhythmPreset())).toEqual(defaultRhythmPreset())
  })
  it('给无 secondary 槽的目标（density/thickness/speed）塞 secondary 会被丢弃', () => {
    const bad: any = defaultRhythmPreset()
    bad.targets.density.secondary = { enabled: true, source: 'energy', gain: 1, curve: 'linear', smoothingMs: 100, inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1 }
    const clean = sanitizeMappingValues(bad)
    expect(clean.targets.density.secondary).toBeUndefined()
  })
})
