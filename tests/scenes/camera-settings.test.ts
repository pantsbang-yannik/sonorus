import { describe, it, expect } from 'vitest'
import { DEFAULT_CAMERA_SETTINGS, CAMERA_LIMITS, sanitizeCameraSettings } from '../../src/scenes/nebula/camera-types'

describe('CameraSettings sanitize（惯例同 sanitizeMotionSettings：坏数据回默认，数值钳限幅）', () => {
  it('非对象/空对象 → 全默认', () => {
    expect(sanitizeCameraSettings(null)).toEqual(DEFAULT_CAMERA_SETTINGS)
    expect(sanitizeCameraSettings({})).toEqual(DEFAULT_CAMERA_SETTINGS)
  })
  it('数值出界钳到 limits；NaN/类型错回默认', () => {
    expect(sanitizeCameraSettings({ liveliness: 99 }).liveliness).toBe(CAMERA_LIMITS.liveliness.max)
    expect(sanitizeCameraSettings({ liveliness: -1 }).liveliness).toBe(CAMERA_LIMITS.liveliness.min)
    expect(sanitizeCameraSettings({ liveliness: NaN }).liveliness).toBe(DEFAULT_CAMERA_SETTINGS.liveliness)
    expect(sanitizeCameraSettings({ liveliness: '高' }).liveliness).toBe(DEFAULT_CAMERA_SETTINGS.liveliness)
    expect(sanitizeCameraSettings({ distScale: 99 }).distScale).toBe(CAMERA_LIMITS.distScale.max)
    expect(sanitizeCameraSettings({ distScale: 0 }).distScale).toBe(CAMERA_LIMITS.distScale.min)
    expect(sanitizeCameraSettings({ distScale: '远' }).distScale).toBe(DEFAULT_CAMERA_SETTINGS.distScale)
  })
  it('合法值原样通过；缺字段各自回默认', () => {
    expect(sanitizeCameraSettings({ liveliness: 1.4, distScale: 0.8 })).toEqual({ liveliness: 1.4, distScale: 0.8 })
    // 旧存档只有 liveliness（distScale 是后加字段）：不整体回默认，缺的字段单独补默认
    expect(sanitizeCameraSettings({ liveliness: 1.4 })).toEqual({ liveliness: 1.4, distScale: DEFAULT_CAMERA_SETTINGS.distScale })
  })
})
