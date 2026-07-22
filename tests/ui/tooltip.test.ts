import { describe, it, expect, beforeEach } from 'vitest'
import { attachTooltip } from '../../src/ui/tooltip'

type Handler = (e: unknown) => void
interface Rect { top: number; left: number; right: number; bottom: number; width: number; height: number }
interface FakeEl {
  style: Record<string, string>
  textContent: string
  attributes: Record<string, string>
  children: FakeEl[]
  _parent: FakeEl | null
  setAttribute: (k: string, v: string) => void
  appendChild: (c: FakeEl) => void
  remove: () => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
  getBoundingClientRect: () => Rect
}

/** node 环境无 DOM：stub 最小 document/element 表面（同 tests/ui/control-dock.test.ts 模式），
 * 额外补 setAttribute/children/getBoundingClientRect —— tooltip.ts 会造节点、打 data-tooltip 标记、读定位 */
function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const el: FakeEl = {
    style: {},
    textContent: '',
    attributes: {},
    children: [],
    _parent: null,
    setAttribute: (k, v) => { el.attributes[k] = v },
    appendChild: (c) => { c._parent = el; el.children.push(c) },
    remove: () => {
      const p = el._parent
      if (p) { p.children = p.children.filter((c) => c !== el); el._parent = null }
    },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  }
  return el
}

let body: FakeEl

beforeEach(() => {
  body = fakeElement()
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => fakeElement(),
    body
  }
})

/** 从 body 子节点里找出 tooltip 节点（带 data-tooltip 标记） */
function tooltipsInBody(): FakeEl[] {
  return body.children.filter((c) => 'data-tooltip' in c.attributes)
}

describe('attachTooltip', () => {
  it('mouseenter 后出现含指定文字的 tooltip，mouseleave 后开始淡出', () => {
    const btn = fakeElement()
    attachTooltip(btn as unknown as HTMLElement, '设置')
    btn.dispatch('mouseenter')
    const tips = tooltipsInBody()
    expect(tips.length).toBe(1)
    const tip = tips[0]
    expect(tip.textContent).toBe('设置')
    expect(tip.style.opacity).toBe('1')
    btn.dispatch('mouseleave')
    expect(tip.style.opacity).toBe('0')
  })

  it('placement=bottom 时 tooltip 定位在 target 下方（防右上角出界）', () => {
    const btn = fakeElement()
    btn.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 100, right: 120, width: 20, height: 20 })
    attachTooltip(btn as unknown as HTMLElement, 'X', 'bottom')
    btn.dispatch('mouseenter')
    const tips = tooltipsInBody()
    expect(tips.length).toBe(1)
    const tip = tips[0]
    expect(tip.style.top).toBe('38px') // rect.bottom(30) + 8
    expect(tip.style.transform).toBe('translate(-50%, 0)')
  })

  it('placement=left 时 tooltip 定位在 target 左侧、垂直居中（防右边缘面板出界）', () => {
    const btn = fakeElement()
    btn.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 100, right: 120, width: 20, height: 20 })
    attachTooltip(btn as unknown as HTMLElement, 'X', 'left')
    btn.dispatch('mouseenter')
    const tips = tooltipsInBody()
    expect(tips.length).toBe(1)
    const tip = tips[0]
    expect(tip.style.left).toBe('92px') // rect.left(100) - 8
    expect(tip.style.top).toBe('20px') // rect.top(10) + rect.height/2(10)
    expect(tip.style.transform).toBe('translate(-100%, -50%)')
  })

  it('placement 默认（不传第三参）仍是 top，定位在 target 上方（既有行为不变）', () => {
    const btn = fakeElement()
    btn.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 100, right: 120, width: 20, height: 20 })
    attachTooltip(btn as unknown as HTMLElement, 'X')
    btn.dispatch('mouseenter')
    const tip = tooltipsInBody()[0]
    expect(tip.style.top).toBe('2px') // rect.top(10) - 8
    expect(tip.style.transform).toBe('translate(-50%, -100%)')
  })

  it('清理函数移除监听与 tooltip 节点', () => {
    const btn = fakeElement()
    const cleanup = attachTooltip(btn as unknown as HTMLElement, 'X')
    btn.dispatch('mouseenter')
    expect(tooltipsInBody().length).toBe(1)
    cleanup()
    expect(tooltipsInBody().length).toBe(0)
    // 清理后再 hover 不应再造节点
    btn.dispatch('mouseenter')
    expect(tooltipsInBody().length).toBe(0)
  })

  it('第四参 shortcut：tooltip 内出现弱化的快捷键后缀 span（功能名+快捷键规范）', () => {
    const btn = fakeElement()
    attachTooltip(btn as unknown as HTMLElement, '全屏', 'bottom', '⌃⌘F')
    btn.dispatch('mouseenter')
    const tip = tooltipsInBody()[0]
    expect(tip.textContent).toBe('全屏') // 主文字不含快捷键（快捷键在子 span 里）
    expect(tip.children.length).toBe(1)
    expect(tip.children[0].textContent).toBe('⌃⌘F')
    expect(tip.children[0].style.cssText).toContain('opacity: 0.55')
  })

  it('不传 shortcut：tooltip 无子节点（既有行为不变）', () => {
    const btn = fakeElement()
    attachTooltip(btn as unknown as HTMLElement, '星系图鉴')
    btn.dispatch('mouseenter')
    expect(tooltipsInBody()[0].children.length).toBe(0)
  })
})
