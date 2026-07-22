import { describe, it, expect } from 'vitest'
import { SectionTracker } from '../../src/scenes/nebula/section-tracker'

function feed(st: SectionTracker, energy: number, sec: number): number {
  let edges = 0
  for (let i = 0; i < Math.round(sec * 60); i++) if (st.update(energy, 1 / 60)) edges++
  return edges
}

describe('SectionTracker', () => {
  it('平稳段落不触发；能量台阶触发一次边沿', () => {
    const st = new SectionTracker()
    expect(feed(st, 0.3, 20)).toBe(0)      // 平稳主歌
    expect(feed(st, 0.75, 6)).toBe(1)      // 副歌进入：一次边沿，不重复报
  })
  it('最小段落间隔内不重复触发（防抖动歌来回切机位）', () => {
    const st = new SectionTracker({ minSectionSec: 12 })
    feed(st, 0.3, 15)
    expect(feed(st, 0.8, 3)).toBe(1)
    expect(feed(st, 0.25, 5)).toBe(0)      // 距上次边沿 <12s，跌落不触发
    expect(feed(st, 0.8, 13)).toBe(1)      // 间隔够了，再次台阶可触发
  })
  it('缓慢渐强不触发（段落是台阶不是斜坡）', () => {
    const st = new SectionTracker()
    let edges = 0
    for (let i = 0; i < 60 * 60; i++) {
      if (st.update(0.2 + (i / (60 * 60)) * 0.6, 1 / 60)) edges++ // 60s 线性渐强
    }
    expect(edges).toBe(0)
  })
})
