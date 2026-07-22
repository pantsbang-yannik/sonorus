import { describe, it, expect } from 'vitest'
import { backgroundTargetSize, BACKGROUND_IMAGE_MAX_PX, isSupportedVideo } from '../../src/ui/background-ingest'

describe('backgroundTargetSize（背景档降采样：长边≤2560，不放大小图，等比不变形）', () => {
  it('小图原样：不放大', () => {
    expect(backgroundTargetSize(1920, 1080)).toEqual({ w: 1920, h: 1080 })
  })
  it('大图等比缩到长边 2560（横图/竖图）', () => {
    expect(backgroundTargetSize(5120, 2880)).toEqual({ w: 2560, h: 1440 })
    expect(backgroundTargetSize(3000, 6000)).toEqual({ w: 1280, h: BACKGROUND_IMAGE_MAX_PX })
  })
  it('极端小值钳到 ≥1，0 尺寸不除零', () => {
    const r = backgroundTargetSize(0, 0)
    expect(r.w).toBeGreaterThanOrEqual(1)
    expect(r.h).toBeGreaterThanOrEqual(1)
  })
})

describe('isSupportedVideo（视频背景 v2：容器白名单判别）', () => {
  it('mp4/mov/webm 扩展名或对应 MIME 均可判真（大小写不敏感）', () => {
    expect(isSupportedVideo('a.mp4', '')).toBe(true)
    expect(isSupportedVideo('a.MOV', '')).toBe(true)
    expect(isSupportedVideo('a.webm', '')).toBe(true)
    expect(isSupportedVideo('a', 'video/mp4')).toBe(true)
    expect(isSupportedVideo('a', 'video/quicktime')).toBe(true)
    expect(isSupportedVideo('a', 'video/webm')).toBe(true)
  })
  it('白名单外容器为假：avi/mkv/图片/音频', () => {
    expect(isSupportedVideo('a.avi', 'video/x-msvideo')).toBe(false)
    expect(isSupportedVideo('a.mkv', '')).toBe(false)
    expect(isSupportedVideo('a.png', 'image/png')).toBe(false)
    expect(isSupportedVideo('a.mp3', 'audio/mpeg')).toBe(false)
  })
})
