import { describe, it, expect } from 'vitest'
import { awakeningParams, AwakeningDirector } from '../../src/scenes/nebula/awakening'

describe('awakeningParams', () => {
  it('安静歌缓慢苏醒，炸歌直接撕开，中段平滑过渡', () => {
    const quiet = awakeningParams(0)
    expect(quiet.durationSec).toBeCloseTo(3.5, 5)
    expect(quiet.kickStrength).toBeCloseTo(0.35, 5)
    const loud = awakeningParams(1)
    expect(loud.durationSec).toBeCloseTo(1.2, 5)
    expect(loud.kickStrength).toBeCloseTo(0.9, 5)
    const mid = awakeningParams(0.5)
    expect(mid.durationSec).toBeLessThan(3.5)
    expect(mid.durationSec).toBeGreaterThan(1.2)
    expect(mid.kickStrength).toBeGreaterThan(0.35)
    expect(mid.kickStrength).toBeLessThan(0.9)
  })
  it('越界输入被夹取', () => {
    expect(awakeningParams(-1)).toEqual(awakeningParams(0))
    expect(awakeningParams(9)).toEqual(awakeningParams(1))
  })
})

describe('AwakeningDirector（延迟决策，防边沿帧能量误判）', () => {
  const DT = 1 / 60

  it('①onEdge 返回 M2 基线（2.5s / 0.6），保底不回归', () => {
    const d = new AwakeningDirector()
    const temp = d.onEdge()
    expect(temp.durationSec).toBeCloseTo(2.5, 5)
    expect(temp.kickStrength).toBeCloseTo(0.6, 5)
  })

  it('②边沿后能量爬到 0.9，0.35s 窗口结束定稿 kick>0.8（炸歌撕开可达——旧实现读边沿帧 ~3% 能量必挂）', () => {
    const d = new AwakeningDirector(0.35)
    d.onEdge()
    let final: ReturnType<AwakeningDirector['update']> = null
    // 能量在窗口内爬升到 0.9（模拟包络起步慢、观察期已冲高）
    for (let t = 0; t < 0.4 && !final; t += DT) {
      final = d.update(DT, 0.9)
    }
    expect(final).not.toBeNull()
    expect(final!.kickStrength).toBeGreaterThan(0.8)
    expect(final!.durationSec).toBeLessThan(1.5) // 炸歌 → 快速苏醒
  })

  it('③安静歌（能量恒 0.1）定稿仍接近安静参数', () => {
    const d = new AwakeningDirector(0.35)
    d.onEdge()
    let final: ReturnType<AwakeningDirector['update']> = null
    for (let t = 0; t < 0.4 && !final; t += DT) {
      final = d.update(DT, 0.1)
    }
    expect(final).not.toBeNull()
    expect(final!.durationSec).toBeGreaterThan(3.3) // 接近 3.5 安静
    expect(final!.kickStrength).toBeLessThan(0.4) // 接近 0.35 安静
  })

  it('④定稿只发一次，窗口结束后恒返回 null', () => {
    const d = new AwakeningDirector(0.1)
    d.onEdge()
    let finals = 0
    for (let i = 0; i < 60; i++) {
      if (d.update(DT, 0.5)) finals++
    }
    expect(finals).toBe(1)
  })

  it('未 onEdge 直接 update 返回 null（未进入苏醒态不定稿）', () => {
    const d = new AwakeningDirector()
    expect(d.update(DT, 0.9)).toBeNull()
  })
})
