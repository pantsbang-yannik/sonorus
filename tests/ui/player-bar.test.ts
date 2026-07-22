import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PlayerBar, fmtTime, type PlayerBarDeps } from '../../src/ui/player-bar'

type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  textContent: string
  value: string
  max: string
  tagName: string
  attributes: Record<string, string>
  innerHTML: string
  children: FakeEl[]
  _parent: FakeEl | null
  setAttribute: (k: string, v: string) => void
  appendChild: (c: unknown) => void
  remove: () => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
  hasListener: (type: string) => boolean
}

function fakeElement(tag = 'div'): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const styleObj: Record<string, string> = {}
  const el: FakeEl = {
    get style() {
      return new Proxy(styleObj, {
        set: (target, key, value: string) => {
          if (typeof key === 'symbol') return true // style 键不会是 symbol,忽略即可
          if (key === 'cssText') {
            // 解析 cssText 并分解到各个属性
            styleObj.cssText = value
            const parts = value.split(';').filter(p => p.trim())
            for (const part of parts) {
              const [k, v] = part.split(':').map(s => s.trim())
              if (k && v) styleObj[k] = v
            }
          } else {
            target[key] = value
          }
          return true
        }
      })
    },
    textContent: '', value: '', max: '', tagName: tag.toUpperCase(),
    attributes: {}, innerHTML: '', children: [], _parent: null,
    setAttribute: (k, v) => { el.attributes[k] = v },
    appendChild: (c) => { const child = c as FakeEl; child._parent = el; el.children.push(child) },
    remove: () => {
      const p = el._parent
      if (p) { p.children = p.children.filter((c) => c !== el); el._parent = null }
    },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb) },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) },
    hasListener: (type) => (listeners[type] ?? []).length > 0
  }
  return el
}

let created: FakeEl[]

beforeEach(() => {
  created = []
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      const el = fakeElement(tag)
      created.push(el)
      return el
    }
  }
})

function makeDeps(): PlayerBarDeps & Record<
  'onToggle' | 'onSeek' | 'onClose' | 'onPrev' | 'onNext' | 'onLoopToggle' | 'onQueueSelect' | 'onQueueRemove',
  ReturnType<typeof vi.fn>
> {
  return {
    onToggle: vi.fn(() => {}), onSeek: vi.fn(() => {}), onClose: vi.fn(() => {}),
    onPrev: vi.fn(() => {}), onNext: vi.fn(() => {}), onLoopToggle: vi.fn(() => {}),
    onQueueSelect: vi.fn(() => {}), onQueueRemove: vi.fn(() => {})
  }
}

const range = (): FakeEl => created.find((el) => el.attributes['type'] === 'range')!

function findRole(el: FakeEl, role: string): FakeEl | null {
  if (el.attributes['data-role'] === role) return el
  for (const c of el.children) {
    const hit = findRole(c, role)
    if (hit) return hit
  }
  return null
}

/** 统一构造工厂:new 一个挂到假 parent 上的 PlayerBar,返回实例/其根节点(created[0])/deps 桩 */
function make(): { bar: PlayerBar; root: FakeEl; deps: ReturnType<typeof makeDeps> } {
  const deps = makeDeps()
  const bar = new PlayerBar(fakeElement() as unknown as HTMLElement, deps)
  return { bar, root: created[0], deps }
}

describe('fmtTime(时间标签格式化)', () => {
  it('秒 → m:ss', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(83)).toBe('1:23')
    expect(fmtTime(605)).toBe('10:05')
  })
  it('NaN/Infinity 兜底(duration 未知期)', () => {
    expect(fmtTime(NaN)).toBe('0:00')
    expect(fmtTime(Infinity)).toBe('0:00')
  })
})

describe('PlayerBar(本地播放控制条:文件名+播放暂停+进度+关闭)', () => {
  it('show 前不可见,show 后可见且显示文件名', () => {
    const parent = fakeElement()
    const bar = new PlayerBar(parent as unknown as HTMLElement, makeDeps())
    const root = created[0]
    expect(root.style.opacity).toBe('0')
    bar.show('我的歌')
    expect(root.style.opacity).toBe('1')
    const label = created.find((el) => el.textContent === '我的歌')
    expect(label).toBeTruthy()
    bar.dispose()
  })

  it('setTime 更新滑块与时间标签;setPlaying 切换按钮形态', () => {
    const bar = new PlayerBar(fakeElement() as unknown as HTMLElement, makeDeps())
    bar.show('a')
    bar.setTime(83, 200)
    expect(range().value).toBe('83')
    expect(range().max).toBe('200')
    const times = created.filter((el) => el.textContent === '1:23' || el.textContent === '3:20')
    expect(times.length).toBe(2)
    bar.setPlaying(true)
    bar.setPlaying(false) // 只验证不抛;形态是 SVG innerHTML,亲验覆盖
    bar.dispose()
  })

  it('拖动滑块期间 setTime 不覆盖;change 触发 onSeek 并解除抑制', () => {
    const deps = makeDeps()
    const bar = new PlayerBar(fakeElement() as unknown as HTMLElement, deps)
    bar.show('a')
    bar.setTime(10, 200)
    range().dispatch('pointerdown')
    range().value = '150'
    bar.setTime(11, 200)
    expect(range().value).toBe('150') // 拖动中,外部 setTime 不许抢
    range().dispatch('change')
    expect(deps.onSeek).toHaveBeenCalledWith(150)
    bar.setTime(151, 200)
    expect(range().value).toBe('151') // change 后恢复跟随
    bar.dispose()
  })

  it('pointerdown 后原位松手(pointerup,无 change):scrubbing 解除,后续 setTime 恢复跟随', () => {
    const bar = new PlayerBar(fakeElement() as unknown as HTMLElement, makeDeps())
    bar.show('a')
    bar.setTime(10, 200)
    range().dispatch('pointerdown')
    // 用户按住原位松手,浏览器不发 change
    range().dispatch('pointerup')
    bar.setTime(20, 200)
    expect(range().value).toBe('20') // scrubbing 已解除,setTime 恢复覆盖
    bar.dispose()
  })

  it('setSuppressed(true) 后即使 show() 也不可见;setSuppressed(false) 恢复可见;suppressed 期间 hide/show 状态语义保持', () => {
    const parent = fakeElement()
    const bar = new PlayerBar(parent as unknown as HTMLElement, makeDeps())
    const root = created[0]
    bar.show('a')
    expect(root.style.opacity).toBe('1')
    bar.setSuppressed(true)
    expect(root.style.opacity).toBe('0') // 压制期间不可见
    bar.show('b') // show() 语义仍是"shown=true",但压制未解除,不应可见
    expect(root.style.opacity).toBe('0')
    bar.setSuppressed(false)
    expect(root.style.opacity).toBe('1') // 压制解除,shown 状态保持的可见性恢复
    bar.hide()
    expect(root.style.opacity).toBe('0')
    bar.setSuppressed(true)
    bar.setSuppressed(false)
    expect(root.style.opacity).toBe('0') // hide 状态在压制期间不被 setSuppressed 悄悄翻回可见
    bar.dispose()
  })

  it('播放/关闭按钮回调转发', () => {
    const { bar, root, deps } = make()
    bar.show('a')
    findRole(root, 'toggle')!.dispatch('click')
    expect(deps.onToggle).toHaveBeenCalledTimes(1)
    findRole(root, 'close')!.dispatch('click')
    expect(deps.onClose).toHaveBeenCalledTimes(1)
    bar.dispose()
  })

  it('hide 后不可见;dispose 移除根节点', () => {
    const parent = fakeElement()
    const bar = new PlayerBar(parent as unknown as HTMLElement, makeDeps())
    const root = created[0]
    bar.show('a')
    bar.hide()
    expect(root.style.opacity).toBe('0')
    const removeSpy = vi.spyOn(root, 'remove')
    bar.dispose()
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('PlayerBar V2 控制条', () => {
  it('setNowPlaying：标题/歌手双行，无歌手时歌手行隐藏', () => {
    const { bar, root } = make()
    bar.setNowPlaying({ title: '晴天', artist: '周杰伦', coverDataUrl: null })
    expect(findRole(root, 'title')!.textContent).toBe('晴天')
    expect(findRole(root, 'artist')!.textContent).toBe('周杰伦')
    expect(findRole(root, 'artist')!.style.display).toBe('')
    bar.setNowPlaying({ title: 'demo', artist: null, coverDataUrl: null })
    expect(findRole(root, 'artist')!.style.display).toBe('none')
  })

  it('封面：有 dataUrl 显示，无则隐藏', () => {
    const { bar, root } = make()
    bar.setNowPlaying({ title: 'a', artist: 'b', coverDataUrl: 'data:image/png;base64,SGk=' })
    expect(findRole(root, 'cover')!.style.display).toBe('')
    bar.setNowPlaying({ title: 'a', artist: 'b', coverDataUrl: null })
    expect(findRole(root, 'cover')!.style.display).toBe('none')
  })

  it('prev/next/loop 点击回调', () => {
    const { deps, root } = make()
    findRole(root, 'prev')!.dispatch('click')
    findRole(root, 'next')!.dispatch('click')
    findRole(root, 'loop')!.dispatch('click')
    expect(deps.onPrev).toHaveBeenCalledTimes(1)
    expect(deps.onNext).toHaveBeenCalledTimes(1)
    expect(deps.onLoopToggle).toHaveBeenCalledTimes(1)
  })

  it('setLoop 状态落 data-on', () => {
    const { bar, root } = make()
    bar.setLoop(true)
    expect(findRole(root, 'loop')!.attributes['data-on']).toBe('1')
    bar.setLoop(false)
    expect(findRole(root, 'loop')!.attributes['data-on']).toBe('0')
  })

  it('show(文件名) 走 setNowPlaying 兜底：只有标题行', () => {
    const { bar, root } = make()
    bar.show('demo-track')
    expect(findRole(root, 'title')!.textContent).toBe('demo-track')
    expect(findRole(root, 'artist')!.style.display).toBe('none')
  })
})

describe('PlayerBar 队列列表', () => {
  it('queue-toggle 开合列表', () => {
    const { root } = make()
    expect(findRole(root, 'queue-list')!.style.display).toBe('none')
    findRole(root, 'queue-toggle')!.dispatch('click')
    expect(findRole(root, 'queue-list')!.style.display).toBe('block')
    findRole(root, 'queue-toggle')!.dispatch('click')
    expect(findRole(root, 'queue-list')!.style.display).toBe('none')
  })

  it('setQueue 渲染行：数量/data-id/data-active/重复调用全量重建', () => {
    const { bar, root } = make()
    bar.setQueue([
      { id: 1, title: '晴天', artist: '周杰伦', active: true },
      { id: 2, title: 'demo', artist: null, active: false }
    ])
    const list = findRole(root, 'queue-list')!
    const rows = list.children.filter((c) => c.attributes['data-role'] === 'queue-row')
    expect(rows.length).toBe(2)
    expect(rows[0]!.attributes['data-active']).toBe('1')
    expect(rows[1]!.attributes['data-id']).toBe('2')
    bar.setQueue([{ id: 2, title: 'demo', artist: null, active: true }])
    expect(list.children.filter((c) => c.attributes['data-role'] === 'queue-row').length).toBe(1)
  })

  it('行点击→onQueueSelect；行内×→onQueueRemove 且不触发 select', () => {
    const { bar, root, deps } = make()
    bar.setQueue([{ id: 7, title: 'a', artist: null, active: false }])
    const row = findRole(root, 'queue-row')!
    row.dispatch('click')
    expect(deps.onQueueSelect).toHaveBeenCalledWith(7)
    findRole(row, 'row-remove')!.dispatch('click')
    expect(deps.onQueueRemove).toHaveBeenCalledWith(7)
    expect(deps.onQueueSelect).toHaveBeenCalledTimes(1) // FakeEl 无冒泡，×只触发自己
  })

  it('hide() 收起列表', () => {
    const { bar, root } = make()
    findRole(root, 'queue-toggle')!.dispatch('click')
    bar.hide()
    expect(findRole(root, 'queue-list')!.style.display).toBe('none')
  })
})
