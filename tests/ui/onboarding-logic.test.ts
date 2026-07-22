// tests/ui/onboarding-logic.test.ts —— 状态机输入是采样快照，纯函数可测
import { describe, it, expect } from 'vitest'
import { OnboardingLogic } from '../../src/ui/onboarding-logic'

describe('OnboardingLogic', () => {
  it('intro → listening：start() 后进入监听', () => {
    const l = new OnboardingLogic()
    expect(l.state).toBe('intro')
    l.start()
    expect(l.state).toBe('listening')
  })

  it('listening 内检测到能量 → success（一次采样即definitive）', () => {
    const l = new OnboardingLogic()
    l.start()
    l.sample({ hasAudio: true, hasTrack: false, dt: 0.25 })
    expect(l.state).toBe('success')
  })

  it('有歌在播但持续静音 8s → denied（授权被拒判定）', () => {
    const l = new OnboardingLogic()
    l.start()
    for (let i = 0; i < 33; i++) l.sample({ hasAudio: false, hasTrack: true, dt: 0.25 })
    expect(l.state).toBe('denied')
  })

  it('无歌可判：静音累计不推进 denied，只保持 listening（提示放歌）', () => {
    const l = new OnboardingLogic()
    l.start()
    for (let i = 0; i < 60; i++) l.sample({ hasAudio: false, hasTrack: false, dt: 0.25 })
    expect(l.state).toBe('listening')
    expect(l.needsMusicHint).toBe(true) // 4s 无任何信号后置位
  })

  it('denied 后 retry() 回 listening 且静音计时清零', () => {
    const l = new OnboardingLogic()
    l.start()
    for (let i = 0; i < 33; i++) l.sample({ hasAudio: false, hasTrack: true, dt: 0.25 })
    l.retry()
    expect(l.state).toBe('listening')
    l.sample({ hasAudio: false, hasTrack: true, dt: 0.25 })
    expect(l.state).toBe('listening') // 不带旧计时直接再判 denied
  })

  it('denied 后来了能量（用户在系统设置里开了权限且 tap 已重启）→ success', () => {
    const l = new OnboardingLogic()
    l.start()
    for (let i = 0; i < 33; i++) l.sample({ hasAudio: false, hasTrack: true, dt: 0.25 })
    l.sample({ hasAudio: true, hasTrack: true, dt: 0.25 })
    expect(l.state).toBe('success')
  })
})
