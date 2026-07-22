// src/scenes/nebula/mapping/types.test.ts
import { describe, it, expect } from 'vitest'
import { VISUAL_TARGETS, AUDIO_FEATURES, ALLOWED_SOURCES } from './types'

describe('mapping types 常量', () => {
  it('五类视觉目标齐全', () => {
    expect(VISUAL_TARGETS).toEqual(['speed', 'density', 'space', 'brightness', 'thickness'])
  })
  it('十类音频特征齐全', () => {
    expect(AUDIO_FEATURES).toEqual(['beat', 'downbeat', 'low', 'mid', 'high', 'energy', 'drop', 'loudness', 'silence', 'tempo'])
  })
  it('每个目标的白名单只含合法特征，且与 spec §5.4 一致', () => {
    expect(ALLOWED_SOURCES).toEqual({
      speed: ['tempo', 'loudness', 'energy', 'beat', 'drop'],
      density: ['energy', 'loudness', 'silence', 'drop'],
      space: ['beat', 'downbeat', 'energy', 'drop', 'low'],
      brightness: ['high', 'beat', 'drop', 'energy', 'loudness'],
      thickness: ['low', 'energy', 'drop', 'tempo'],
    })
    for (const t of VISUAL_TARGETS)
      for (const f of ALLOWED_SOURCES[t]) expect(AUDIO_FEATURES).toContain(f)
  })
})
