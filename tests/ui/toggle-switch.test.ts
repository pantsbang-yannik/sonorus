import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ToggleSwitch } from '../../src/ui/toggle-switch'

type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  children: FakeEl[]
  appendChild: (c: unknown) => void
  remove: () => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
}

/** node 环境无 DOM：stub 最小 document/element 表面（同 tuning-panel.test.ts 模式） */
function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const children: FakeEl[] = []
  const el: FakeEl = {
    style: {},
    children,
    appendChild: (c) => { children.push(c as FakeEl) },
    remove: () => {},
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) }
  }
  return el
}

beforeEach(() => {
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => fakeElement()
  }
})

describe('ToggleSwitch（iOS 风格透明白开关）', () => {
  it('点击切换态并回调 onChange(true/false)', () => {
    const parent = fakeElement()
    const onChange = vi.fn()
    const toggle = new ToggleSwitch(parent as unknown as HTMLElement, { checked: false, onChange })

    ;(toggle.el as unknown as FakeEl).dispatch('click')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(true)

    ;(toggle.el as unknown as FakeEl).dispatch('click')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('setChecked 反映视觉态（轨道底色随开/关切换）且不触发 onChange', () => {
    const parent = fakeElement()
    const onChange = vi.fn()
    const toggle = new ToggleSwitch(parent as unknown as HTMLElement, { checked: false, onChange })

    const offColor = toggle.el.style.backgroundColor

    toggle.setChecked(true)
    const onColor = toggle.el.style.backgroundColor
    expect(onColor).not.toBe(offColor)
    expect(onChange).not.toHaveBeenCalled()

    toggle.setChecked(false)
    expect(toggle.el.style.backgroundColor).toBe(offColor)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('构造时挂到 parent 上', () => {
    const parent = fakeElement()
    new ToggleSwitch(parent as unknown as HTMLElement, { checked: false, onChange: vi.fn() })
    expect(parent.children.length).toBe(1)
  })

  it('dispose 从父节点移除', () => {
    const parent = fakeElement()
    const toggle = new ToggleSwitch(parent as unknown as HTMLElement, { checked: false, onChange: vi.fn() })
    const removeSpy = vi.spyOn(toggle.el as unknown as FakeEl, 'remove')
    toggle.dispose()
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })
})
