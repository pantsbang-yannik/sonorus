import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CornerCluster, type CornerClusterDeps } from '../../src/ui/corner-cluster'

type Handler = (e: unknown) => void
interface Rect { top: number; left: number; right: number; bottom: number; width: number; height: number }
interface FakeEl {
  style: Record<string, string>
  textContent: string
  attributes: Record<string, string>
  innerHTML: string
  children: FakeEl[]
  _parent: FakeEl | null
  setAttribute: (k: string, v: string) => void
  appendChild: (c: unknown) => void
  remove: () => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  hasListener: (type: string) => boolean
  dispatch: (type: string, e?: unknown) => void
  getBoundingClientRect: () => Rect
}

/** node 环境无 DOM：stub 最小 document/element 表面（同 control-dock.test.ts 模式） */
function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const el: FakeEl = {
    style: {},
    textContent: '',
    attributes: {},
    innerHTML: '',
    children: [],
    _parent: null,
    setAttribute: (k, v) => { el.attributes[k] = v },
    appendChild: (c) => { const child = c as FakeEl; child._parent = el; el.children.push(child) },
    remove: () => {
      const p = el._parent
      if (p) { p.children = p.children.filter((c) => c !== el); el._parent = null }
    },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    hasListener: (type) => (listeners[type] ?? []).length > 0,
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  }
  return el
}

let created: FakeEl[]
let docBody: FakeEl

beforeEach(() => {
  created = []
  docBody = fakeElement()
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el = fakeElement()
      created.push(el)
      return el
    },
    body: docBody
  }
})

/** 按钮不再有原生 title：触发每个按钮的 mouseenter，读它造出的自定义 tooltip 节点文字反查身份 */
function buttonsByTitle(): Record<string, FakeEl> {
  const map: Record<string, FakeEl> = {}
  const buttons = created.filter((el) => el.hasListener('click'))
  for (const btn of buttons) {
    btn.dispatch('mouseenter')
    const tip = docBody.children.find((c) => 'data-tooltip' in c.attributes)
    if (tip) { map[tip.textContent] = btn; tip.remove() }
  }
  return map
}

function makeDeps(): CornerClusterDeps & {
  setWindowMode: ReturnType<typeof vi.fn>
  toggleGalaxy: ReturnType<typeof vi.fn>
  toggleSettings: ReturnType<typeof vi.fn>
} {
  return { setWindowMode: vi.fn(() => {}), toggleGalaxy: vi.fn(() => {}), toggleSettings: vi.fn(() => {}) }
}

describe('CornerCluster（右上模式/系统角：设置 ｜ 星系图鉴 · 全屏）', () => {
  it('含三枚按钮，DOM 序从内到角落 = [设置, 星系图鉴, 全屏]', () => {
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, makeDeps())
    const buttons = created.filter((el) => el.hasListener('click'))
    const titles = buttons.map((btn) => {
      btn.dispatch('mouseenter')
      const tip = docBody.children.find((c) => 'data-tooltip' in c.attributes)
      const text = tip?.textContent ?? ''
      tip?.remove()
      return text
    })
    expect(titles).toEqual(['设置', '星系图鉴', '全屏'])
    cc.dispose()
  })

  it('容器结构：两组（系统组 1 枚 + 模式组 2 枚），组间靠容器 gap 34px', () => {
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, makeDeps())
    const container = created[0]
    expect(container.children.length).toBe(2)
    expect(container.children[0].children.length).toBe(1) // 设置
    expect(container.children[1].children.length).toBe(2) // 星系 · 全屏
    expect(container.style.cssText).toContain('gap: 34px')
    cc.dispose()
  })

  it('点击转发：全屏→setWindowMode("fullscreen")，星系→toggleGalaxy，设置→toggleSettings', () => {
    const deps = makeDeps()
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, deps)
    const btns = buttonsByTitle()
    btns['全屏'].dispatch('click')
    expect(deps.setWindowMode).toHaveBeenCalledWith('fullscreen')
    btns['星系图鉴'].dispatch('click')
    expect(deps.toggleGalaxy).toHaveBeenCalledTimes(1)
    btns['设置'].dispatch('click')
    expect(deps.toggleSettings).toHaveBeenCalledTimes(1)
    cc.dispose()
  })

  it('fullscreen 态：仅全屏枚 display:none，容器 poke 后仍可见（星系/设置可用）', () => {
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, makeDeps())
    const container = created[0]
    const fsBtn = container.children[1].children[1]
    cc.setMode('fullscreen')
    cc.pokeActivity()
    cc.update(0)
    expect(fsBtn.style.display).toBe('none')
    expect(container.style.opacity).toBe('1')
    cc.setMode('windowed')
    expect(fsBtn.style.display).toBe('')
    cc.dispose()
  })

  it('setEnabled(false)：引导期 poke 也不显；恢复后可显（同 dock 语义）', () => {
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, makeDeps())
    const container = created[0]
    cc.setEnabled(false)
    cc.pokeActivity()
    cc.update(0)
    expect(container.style.opacity).toBe('0')
    cc.setEnabled(true)
    cc.pokeActivity()
    cc.update(0)
    expect(container.style.opacity).toBe('1')
    cc.dispose()
  })

  it('tooltip 快捷键后缀：设置 ⌘, / 星系图鉴无 / 全屏 ⌃⌘F', () => {
    const cc = new CornerCluster(fakeElement() as unknown as HTMLElement, makeDeps())
    const buttons = created.filter((el) => el.hasListener('click'))
    const pairs = buttons.map((btn) => {
      btn.dispatch('mouseenter')
      const tip = docBody.children.find((c) => 'data-tooltip' in c.attributes)
      const pair = [tip?.textContent ?? '', tip?.children[0]?.textContent ?? '']
      tip?.remove()
      return pair
    })
    expect(pairs).toEqual([
      ['设置', '⌘,'], ['星系图鉴', ''], ['全屏', '⌃⌘F']
    ])
    cc.dispose()
  })

  it('element 返回容器（触发忽略区登记用）；dispose 摘除容器', () => {
    const parent = fakeElement()
    const cc = new CornerCluster(parent as unknown as HTMLElement, makeDeps())
    const container = created[0]
    expect(cc.element).toBe(container as unknown as HTMLElement)
    const removeSpy = vi.spyOn(container, 'remove')
    cc.dispose()
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })
})
