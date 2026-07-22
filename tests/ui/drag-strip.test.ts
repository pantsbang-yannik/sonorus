import { describe, it, expect, beforeAll } from 'vitest'
import { DragStrip } from '../../src/ui/drag-strip'

/** node 环境无 DOM：仅 stub DragStrip 构造所需的最小 document/parent 表面（同 track-badge.test.ts 模式） */
function fakeElement(): { style: Record<string, string>; appendChild: () => void; remove: () => void } {
  return { style: {}, appendChild: () => {}, remove: () => {} }
}

let created: ReturnType<typeof fakeElement>[]

beforeAll(() => {
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el = fakeElement()
      created.push(el)
      return el
    }
  }
})

describe('DragStrip（顶部 28px 隐形拖拽条）', () => {
  it('windowed：显示（display block）', () => {
    created = []
    const strip = new DragStrip(fakeElement() as unknown as HTMLElement)
    strip.setMode('windowed')
    expect(created[0].style.display).toBe('block')
    strip.dispose()
  })

  it('fullscreen：隐藏（display none）', () => {
    created = []
    const strip = new DragStrip(fakeElement() as unknown as HTMLElement)
    strip.setMode('fullscreen')
    expect(created[0].style.display).toBe('none')
    strip.dispose()
  })

  it('dispose：容器从父节点移除', () => {
    created = []
    const parent = fakeElement()
    const strip = new DragStrip(parent as unknown as HTMLElement)
    const removed: string[] = []
    created[0].remove = () => removed.push('removed')
    strip.dispose()
    expect(removed).toEqual(['removed'])
  })
})
