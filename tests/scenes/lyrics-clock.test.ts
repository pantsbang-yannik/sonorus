import { describe, it, expect } from 'vitest'
import { PlaybackClock } from '../../src/scenes/nebula/lyrics/clock'

describe('PlaybackClock', () => {
  it('未 mark → null；mark 后按 dt×rate 外插', () => {
    const c = new PlaybackClock()
    expect(c.position()).toBeNull()
    c.mark({ elapsedTime: 10, playbackRate: 1, playing: true })
    c.advance(0.5)
    c.advance(0.5)
    expect(c.position()).toBeCloseTo(11)
  })
  it('暂停冻结；恢复播放继续', () => {
    const c = new PlaybackClock()
    c.mark({ elapsedTime: 10, playbackRate: 1, playing: false })
    c.advance(5)
    expect(c.position()).toBe(10)
    c.mark({ elapsedTime: 10, playbackRate: 1, playing: true })
    c.advance(1)
    expect(c.position()).toBeCloseTo(11)
  })
  it('倍速外插；新 mark 覆盖基准（seek/轮询校准）', () => {
    const c = new PlaybackClock()
    c.mark({ elapsedTime: 0, playbackRate: 2, playing: true })
    c.advance(1)
    expect(c.position()).toBeCloseTo(2)
    c.mark({ elapsedTime: 100, playbackRate: 1, playing: true })
    expect(c.position()).toBe(100)
  })
  it('reset 回 null', () => {
    const c = new PlaybackClock()
    c.mark({ elapsedTime: 10, playbackRate: 1, playing: true })
    c.reset()
    expect(c.position()).toBeNull()
  })
})
