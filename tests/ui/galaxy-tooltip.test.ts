import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GalaxyTooltip } from '../../src/ui/galaxy-tooltip'

interface FakeEl {
  id: string
  style: Record<string, string> & { cssText?: string }
  textContent: string
  children: FakeEl[]
  appendChild: (c: FakeEl) => void
}

/** node 环境无 DOM：stub 最小 document/element 表面（同 tests/ui/tooltip.test.ts 模式）。
 * 铁律：fakeElement 不解析 cssText——被测样式（opacity/left/top/filter）须显式属性写才可断言 */
function fakeElement(): FakeEl {
  const el: FakeEl = {
    id: '',
    style: {},
    textContent: '',
    children: [],
    appendChild: (c) => { el.children.push(c) },
  }
  return el
}

let created: FakeEl[]
const realDocument = globalThis.document

beforeEach(() => {
  created = []
  ;(globalThis as { document: unknown }).document = {
    createElement: (): FakeEl => {
      const el = fakeElement()
      created.push(el)
      return el
    },
  }
})
afterEach(() => {
  ;(globalThis as { document: unknown }).document = realDocument
})

const parentEl = (): FakeEl => fakeElement()

describe('GalaxyTooltip', () => {
  it('show：写入歌名与「歌手 · 听过 N 次」，显影并定位到星心上方', () => {
    const parent = parentEl()
    const tip = new GalaxyTooltip(parent as unknown as HTMLElement)
    tip.show('k1', '晴天', '周杰伦', 12, 300, 200)
    const root = parent.children[0]
    const [title, meta] = root.children
    expect(title.textContent).toBe('晴天')
    expect(meta.textContent).toBe('周杰伦 · 听过 12 次')
    expect(root.style.opacity).toBe('1')
    expect(root.style.left).toBe('300px')
    expect(Number.parseFloat(root.style.top)).toBeLessThan(200) // 上方：y 减去偏移
  })

  it('同星逐帧只挪位置不重写文本；换星更新内容', () => {
    const parent = parentEl()
    const tip = new GalaxyTooltip(parent as unknown as HTMLElement)
    tip.show('k1', 'A', 'a', 1, 10, 100)
    const root = parent.children[0]
    root.children[0].textContent = '哨兵' // 若同星路径重写文本会覆盖哨兵
    tip.show('k1', 'A', 'a', 1, 50, 100)
    expect(root.children[0].textContent).toBe('哨兵')
    expect(root.style.left).toBe('50px')
    tip.show('k2', 'B', 'b', 2, 60, 100)
    expect(root.children[0].textContent).toBe('B')
  })

  it('hide 幂等：显影归零，重复调用不炸', () => {
    const parent = parentEl()
    const tip = new GalaxyTooltip(parent as unknown as HTMLElement)
    tip.show('k1', 'A', 'a', 1, 10, 100)
    tip.hide()
    tip.hide()
    expect(parent.children[0].style.opacity).toBe('0')
  })
})
