import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DropChoice, type DropChoiceDeps } from '../../src/ui/drop-choice'

type Handler = (e: unknown) => void
interface Rect { top: number; left: number; right: number; bottom: number; width: number; height: number }
interface FakeEl {
  style: Record<string, string>
  textContent: string
  attributes: Record<string, string>
  children: FakeEl[]
  _parent: FakeEl | null
  setAttribute: (k: string, v: string) => void
  appendChild: (c: unknown) => void
  append: (...c: unknown[]) => void
  remove: () => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
  contains: (node: unknown) => boolean
  getBoundingClientRect: () => Rect
}

/** node 环境无 DOM：stub 最小 document/element 表面（照抄 shape-picker.test.ts 的 fakeElement 基建） */
function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const children: FakeEl[] = []
  const el: FakeEl = {
    style: {},
    textContent: '',
    attributes: {},
    children,
    _parent: null,
    setAttribute: (k, v) => { el.attributes[k] = v },
    appendChild: (c) => { (c as FakeEl)._parent = el; children.push(c as FakeEl) },
    append: (...cs) => { for (const c of cs) { (c as FakeEl)._parent = el; children.push(c as FakeEl) } },
    remove: () => {
      const p = el._parent
      if (p) { p.children.splice(p.children.indexOf(el), 1); el._parent = null }
    },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) },
    contains: (node) => node === el || children.some((c) => c.contains(node)),
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  }
  return el
}

/** 等一个宏任务——用于 flush 掉实现里用 setTimeout(0) 延迟注册的 pointerdown 监听器 */
function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let docListeners: Record<string, Handler[]>
let docBody: FakeEl

beforeEach(() => {
  docListeners = {}
  docBody = fakeElement()
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => fakeElement(),
    body: docBody,
    addEventListener: (type: string, cb: Handler) => { (docListeners[type] ??= []).push(cb) },
    removeEventListener: (type: string, cb: Handler) => {
      docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== cb)
    },
  }
})

/** 派发一个 document 级事件——本文件 stub 的 helper，供测试直接触发 keydown/pointerdown */
function dispatchDocEvent(type: string, e?: unknown): void {
  for (const cb of docListeners[type] ?? []) cb(e)
}

/** 当前登记在 document 上的某类型监听器数量——用于校验 dispose 摘监听不泄漏 */
function docListenerCount(type: string): number {
  return (docListeners[type] ?? []).length
}

/** 递归按 attributes[key]===value 查找第一个匹配节点（含自身）——供 data-role 反查 */
function findByAttr(el: FakeEl, key: string, value: string): FakeEl | null {
  if (el.attributes[key] === value) return el
  for (const c of el.children) {
    const found = findByAttr(c, key, value)
    if (found) return found
  }
  return null
}

/** 递归按 textContent 精确匹配查找第一个节点——供标题文案反查（照抄 shape-picker.test.ts 同名 helper） */
function findByText(el: FakeEl, text: string): FakeEl | null {
  if (el.textContent === text) return el
  for (const c of el.children) {
    const found = findByText(c, text)
    if (found) return found
  }
  return null
}

function makeFile(name = 'a.png'): File {
  return { name, type: 'image/png' } as unknown as File
}

function makeDeps(overrides: Partial<DropChoiceDeps> = {}): DropChoiceDeps {
  return {
    onShape: vi.fn(),
    onBackground: vi.fn(),
    ...overrides,
  }
}

describe('DropChoice（拖图松手后的用途选择条）', () => {
  it('ask() 前隐藏；ask() 后可见 + setModalOpen(true)', () => {
    const parent = fakeElement()
    const setModalOpen = vi.fn()
    const dc = new DropChoice(parent as unknown as HTMLElement, makeDeps({ setModalOpen }))
    const container = findByAttr(parent, 'data-role', 'drop-choice')!
    expect(container.style.display).toBe('none')
    // 亲验实锤回归锚：#sonorus-overlay 根容器 pointer-events:none，浮层必须显式开回 auto——
    // 漏掉=点击穿透到画布触发点外部关闭，回调静默失效但外观像"选择成功"
    expect(container.style.pointerEvents).toBe('auto')
    dc.ask(makeFile())
    expect(container.style.display).toBe('flex')
    expect(dc.isOpen).toBe(true)
    expect(setModalOpen).toHaveBeenCalledWith(true)
  })

  it('点「拼成图形」→ onShape(file) 恰一次 + 关闭 + setModalOpen(false)', () => {
    const parent = fakeElement()
    const setModalOpen = vi.fn()
    const deps = makeDeps({ setModalOpen })
    const dc = new DropChoice(parent as unknown as HTMLElement, deps)
    const file = makeFile()
    dc.ask(file)
    const shapeBtn = findByAttr(parent, 'data-role', 'drop-choice-shape')!
    shapeBtn.dispatch('click')
    expect(deps.onShape).toHaveBeenCalledTimes(1)
    expect(deps.onShape).toHaveBeenCalledWith(file)
    expect(deps.onBackground).not.toHaveBeenCalled()
    expect(dc.isOpen).toBe(false)
    expect(setModalOpen).toHaveBeenLastCalledWith(false)
    const container = findByAttr(parent, 'data-role', 'drop-choice')!
    expect(container.style.display).toBe('none')
  })

  it('点「铺成背景」→ onBackground(file) 恰一次 + 关闭', () => {
    const parent = fakeElement()
    const deps = makeDeps()
    const dc = new DropChoice(parent as unknown as HTMLElement, deps)
    const file = makeFile()
    dc.ask(file)
    const bgBtn = findByAttr(parent, 'data-role', 'drop-choice-background')!
    bgBtn.dispatch('click')
    expect(deps.onBackground).toHaveBeenCalledTimes(1)
    expect(deps.onBackground).toHaveBeenCalledWith(file)
    expect(deps.onShape).not.toHaveBeenCalled()
    expect(dc.isOpen).toBe(false)
  })

  it('Esc 取消：不回调任何一侧，关闭', () => {
    const parent = fakeElement()
    const deps = makeDeps()
    const dc = new DropChoice(parent as unknown as HTMLElement, deps)
    dc.ask(makeFile())
    dispatchDocEvent('keydown', { key: 'Escape', stopPropagation: () => {} })
    expect(dc.isOpen).toBe(false)
    expect(deps.onShape).not.toHaveBeenCalled()
    expect(deps.onBackground).not.toHaveBeenCalled()
  })

  it('点外部取消（pointerdown capture，setTimeout 0 后注册——用 flushMacrotask）', async () => {
    const parent = fakeElement()
    const dc = new DropChoice(parent as unknown as HTMLElement, makeDeps())
    dc.ask(makeFile())
    await flushMacrotask()
    const container = findByAttr(parent, 'data-role', 'drop-choice')!
    // 点容器内不关
    dispatchDocEvent('pointerdown', { target: container })
    expect(dc.isOpen).toBe(true)
    // 点外部关
    dispatchDocEvent('pointerdown', { target: fakeElement() })
    expect(dc.isOpen).toBe(false)
  })

  it('连续两次 ask：第二个 file 覆盖第一个（后选按钮拿到的是第二个 file）', () => {
    const parent = fakeElement()
    const deps = makeDeps()
    const dc = new DropChoice(parent as unknown as HTMLElement, deps)
    const file1 = makeFile('a.png')
    const file2 = makeFile('b.png')
    dc.ask(file1)
    dc.ask(file2)
    const shapeBtn = findByAttr(parent, 'data-role', 'drop-choice-shape')!
    shapeBtn.dispatch('click')
    expect(deps.onShape).toHaveBeenCalledTimes(1)
    expect(deps.onShape).toHaveBeenCalledWith(file2)
  })

  it('dispose 摘监听器不炸', async () => {
    const parent = fakeElement()
    const dc = new DropChoice(parent as unknown as HTMLElement, makeDeps())
    dc.ask(makeFile())
    await flushMacrotask()
    expect(() => dc.dispose()).not.toThrow()
    expect(docListenerCount('keydown')).toBe(0)
    expect(docListenerCount('pointerdown')).toBe(0)
  })
})

describe('选择条视频模式（v2：视频只能铺成背景）', () => {
  it('ask backgroundOnly：拼成图形按钮隐藏，标题换视频文案', () => {
    const parent = fakeElement()
    const dc = new DropChoice(parent as unknown as HTMLElement, makeDeps())
    dc.ask(makeFile('a.mp4'), { backgroundOnly: true })
    const shapeBtn = findByAttr(parent, 'data-role', 'drop-choice-shape')!
    expect(shapeBtn.style.display).toBe('none')
    const title = findByText(parent, '这个视频想怎么用？')
    expect(title).not.toBeNull()
  })

  it('普通 ask 复原：两按钮都在，标题回图片文案（backgroundOnly 不粘连）', () => {
    const parent = fakeElement()
    const dc = new DropChoice(parent as unknown as HTMLElement, makeDeps())
    dc.ask(makeFile('a.mp4'), { backgroundOnly: true })
    dc.close()
    dc.ask(makeFile('b.png'))
    const shapeBtn = findByAttr(parent, 'data-role', 'drop-choice-shape')!
    expect(shapeBtn.style.display).toBe('')
    expect(findByText(parent, '这张图想怎么用？')).not.toBeNull()
  })
})
