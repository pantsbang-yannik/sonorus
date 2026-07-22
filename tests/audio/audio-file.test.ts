import { describe, it, expect } from 'vitest'
import { isSupportedAudio, displayName } from '../../src/audio/audio-file'

describe('isSupportedAudio(拖放/选文件的音频识别:MIME 优先,扩展名兜底)', () => {
  it('audio/* MIME 直接认', () => {
    expect(isSupportedAudio('song.mp3', 'audio/mpeg')).toBe(true)
    expect(isSupportedAudio('弄啥.m4a', 'audio/x-m4a')).toBe(true)
  })
  it('MIME 缺失时扩展名兜底(Finder 拖入偶发空 MIME)', () => {
    expect(isSupportedAudio('song.flac', '')).toBe(true)
    expect(isSupportedAudio('SONG.MP3', '')).toBe(true) // 大小写不敏感
    expect(isSupportedAudio('track.opus', '')).toBe(true)
  })
  it('非音频拒绝(图片走自定义形状通道,不误吞)', () => {
    expect(isSupportedAudio('pic.png', 'image/png')).toBe(false)
    expect(isSupportedAudio('note.txt', 'text/plain')).toBe(false)
    expect(isSupportedAudio('noext', '')).toBe(false)
  })
})

describe('displayName(控制条/海报落款用的展示名)', () => {
  it('去掉扩展名', () => { expect(displayName('我的歌.mp3')).toBe('我的歌') })
  it('无扩展名原样返回', () => { expect(displayName('demo')).toBe('demo') })
  it('隐藏文件式命名不切成空串', () => { expect(displayName('.hidden')).toBe('.hidden') })
})
