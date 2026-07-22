import { describe, it, expect, beforeAll } from 'vitest'
import { BadgeVisibility, TrackBadge } from '../../src/ui/track-badge'

describe('BadgeVisibility（显隐状态机）', () => {
  it('默认隐藏；活动即显示；静止 3s 隐去；再活动再显示', () => {
    const v = new BadgeVisibility(3)
    expect(v.visible).toBe(false)
    v.poke()
    expect(v.visible).toBe(true)
    for (let i = 0; i < 60 * 2.9; i++) v.update(1 / 60)
    expect(v.visible).toBe(true)  // 2.9s 还在
    for (let i = 0; i < 60 * 0.2; i++) v.update(1 / 60)
    expect(v.visible).toBe(false) // 过 3s 隐去
    v.poke()
    expect(v.visible).toBe(true)
  })
  it('无曲目时 poke 也不显示', () => {
    const v = new BadgeVisibility(3)
    v.setHasContent(false)
    v.poke()
    expect(v.visible).toBe(false)
    v.setHasContent(true)
    v.poke()
    expect(v.visible).toBe(true)
  })
})

/** node 环境无 DOM：仅 stub TrackBadge 构造所需的最小 document/parent 表面（同 drag-strip.test.ts 模式） */
function fakeElement(): { style: Record<string, string>; textContent: string; appendChild: () => void; remove: () => void } {
  return { style: {}, textContent: '', appendChild: () => {}, remove: () => {} }
}

beforeAll(() => {
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => fakeElement()
  }
})

describe('TrackBadge.setEnabled（角标开关，M4 计划②T8）', () => {
  it('setEnabled(false) 后 poke+setTrack(change) 仍不可见', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.setEnabled(false)
    badge.pokeActivity()
    badge.setTrack({ kind: 'change', title: 'a', artist: 'b', artworkDataUrl: null })
    expect(badge.visible).toBe(false)
  })

  it('setEnabled(true) 恢复既有行为', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.setEnabled(false)
    badge.setEnabled(true)
    badge.pokeActivity()
    badge.setTrack({ kind: 'change', title: 'a', artist: 'b', artworkDataUrl: null })
    expect(badge.visible).toBe(true)
  })

  it('enabled 与 hasContent 互不覆盖：unknown 时 enabled 也不可见', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.setEnabled(true)
    badge.pokeActivity()
    badge.setTrack({ kind: 'unknown' })
    expect(badge.visible).toBe(false)
  })
})

describe('TrackBadge.setSuppressed（前台层压制，B2 亲验反馈①）', () => {
  it('setSuppressed(true) 后即使 enabled/hasContent/活动全真仍不可见', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.setEnabled(true)
    badge.pokeActivity()
    badge.setTrack({ kind: 'change', title: 'a', artist: 'b', artworkDataUrl: null })
    expect(badge.visible).toBe(true)
    badge.setSuppressed(true)
    expect(badge.visible).toBe(false)
  })

  it('setSuppressed(false) 恢复既有可见状态', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.setEnabled(true)
    badge.pokeActivity()
    badge.setTrack({ kind: 'change', title: 'a', artist: 'b', artworkDataUrl: null })
    badge.setSuppressed(true)
    badge.setSuppressed(false)
    expect(badge.visible).toBe(true)
  })

  it('与 setEnabled 正交：suppressed 恢复后 enabled=false 仍隐藏', () => {
    const badge = new TrackBadge(fakeElement() as unknown as HTMLElement)
    badge.pokeActivity()
    badge.setTrack({ kind: 'change', title: 'a', artist: 'b', artworkDataUrl: null })
    badge.setEnabled(false)
    badge.setSuppressed(true)
    badge.setSuppressed(false)
    expect(badge.visible).toBe(false) // enabled 语义未被 suppressed 恢复覆盖
  })
})
