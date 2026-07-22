import { describe, it, expect, beforeEach } from 'vitest'
import { makeInfoIcon } from '../../src/ui/info-icon'

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

/** node 环境无 DOM：同 tooltip.test.ts 的 fakeElement 惯例——info-icon 内部会造 tooltip 节点，
 * 需要 setAttribute/children/getBoundingClientRect 桩 */
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
    createElementNS: () => fakeElement(),
    body
  }
})

function tooltipsInBody(): FakeEl[] {
  return body.children.filter((c) => 'data-tooltip' in c.attributes)
}

describe('makeInfoIcon', () => {
  it('返回 { el, dispose }，el 内含 info 图形（span + svg）', () => {
    const icon = makeInfoIcon('这是解释文字')
    const el = icon.el as unknown as FakeEl & { innerHTML: string }
    expect(el).toBeTruthy()
    expect(el.innerHTML).toContain('svg')
    expect(typeof icon.dispose).toBe('function')
  })

  it('hover 出现含指定文字的 tooltip（朝上弹出）', () => {
    const el = makeInfoIcon('速度·全场速度感').el as unknown as FakeEl
    el.dispatch('mouseenter')
    const tips = tooltipsInBody()
    expect(tips.length).toBe(1)
    expect(tips[0].textContent).toBe('速度·全场速度感')
    expect(tips[0].style.transform).toBe('translate(-50%, -100%)')
  })

  it('hover 进入提亮、离开回暗（低调气质，默认弱存在感）', () => {
    const el = makeInfoIcon('文字').el as unknown as FakeEl
    expect(el.style.color).toBe('rgba(255, 255, 255, 0.28)')
    el.dispatch('mouseenter')
    expect(el.style.color).toBe('rgba(255, 255, 255, 0.6)')
    el.dispatch('mouseleave')
    expect(el.style.color).toBe('rgba(255, 255, 255, 0.28)')
  })

  it('dispose 摘除 tooltip 节点、卸掉提亮监听（防面板重建时孤儿化 tooltip）', () => {
    const icon = makeInfoIcon('解释')
    const el = icon.el as unknown as FakeEl
    el.dispatch('mouseenter')
    expect(tooltipsInBody().length).toBe(1)
    icon.dispose()
    // tooltip 节点被摘除
    expect(tooltipsInBody().length).toBe(0)
    // 提亮监听已卸——再 hover 不改色、也不再造 tooltip 节点
    el.style.color = 'sentinel'
    el.dispatch('mouseenter')
    expect(el.style.color).toBe('sentinel')
    expect(tooltipsInBody().length).toBe(0)
  })
})
