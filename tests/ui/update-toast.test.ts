import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UpdateNotice, type UpdateNoticeDeps, type UpdateStatusMsg, type UpdateManifestView } from '../../src/ui/update-toast'

// FakeEl 桩（模板见 player-bar.test.ts；node 环境无 jsdom，被测显隐样式全为显式属性写）
type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  textContent: string
  tagName: string
  attributes: Record<string, string>
  children: FakeEl[]
  _parent: FakeEl | null
  setAttribute: (k: string, v: string) => void
  appendChild: (c: unknown) => void
  addEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
}

function fakeElement(tag = 'div'): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const styleObj: Record<string, string> = {}
  const el: FakeEl = {
    style: styleObj,
    textContent: '', tagName: tag.toUpperCase(), attributes: {}, children: [], _parent: null,
    setAttribute: (k, v) => { el.attributes[k] = v },
    appendChild: (c) => { const child = c as FakeEl; child._parent = el; el.children.push(child) },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) }
  }
  return el
}

/** 深度优先按 data-role 找元素 */
function byRole(root: FakeEl, role: string): FakeEl | null {
  if (root.attributes['data-role'] === role) return root
  for (const c of root.children) {
    const hit = byRole(c, role)
    if (hit) return hit
  }
  return null
}

let parent: FakeEl

beforeEach(() => {
  parent = fakeElement()
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => fakeElement(tag)
  }
})

function makeDeps() {
  return {
    openDownload: vi.fn((_url: string) => {}),
    skip: vi.fn((_version: string) => {}),
    showMessage: vi.fn((_text: string) => {}),
    setModal: vi.fn((_open: boolean) => {})
  } satisfies UpdateNoticeDeps
}

function view(over: Partial<UpdateManifestView> = {}): UpdateManifestView {
  return {
    version: '0.2.0', minVersion: '0.1.0', publishedAt: '2026-08-01', notes: '新增激光形态',
    downloadUrl: 'https://dl.example.com/a.dmg', mirrorUrl: null, ...over
  }
}

function notice(deps = makeDeps()): { n: UpdateNotice; deps: ReturnType<typeof makeDeps> } {
  return { n: new UpdateNotice(parent as unknown as HTMLElement, deps), deps }
}

describe('UpdateNotice 可选更新卡', () => {
  it('初始双层都不可见', () => {
    notice()
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
    expect(byRole(parent, 'update-forced')!.style.visibility).toBe('hidden')
  })
  it('optional：卡显影，标题带版本号，notes 上屏；forced 层保持隐藏', () => {
    const { n } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view() })
    const card = byRole(parent, 'update-card')!
    expect(card.style.opacity).toBe('1')
    expect(card.style.pointerEvents).toBe('auto')
    expect(byRole(parent, 'update-card-title')!.textContent).toBe('Sonorus 0.2.0 已发布')
    expect(byRole(parent, 'update-card-notes')!.textContent).toBe('新增激光形态')
    expect(byRole(parent, 'update-forced')!.style.visibility).toBe('hidden')
  })
  it('notes 为空隐藏说明行；mirrorUrl 为空隐藏镜像按钮', () => {
    const { n } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view({ notes: null }) })
    expect(byRole(parent, 'update-card-notes')!.style.display).toBe('none')
    expect(byRole(parent, 'update-btn-mirror')!.style.display).toBe('none')
  })
  it('mirrorUrl 非空显示镜像按钮，点击走镜像地址', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view({ mirrorUrl: 'https://cn.example.com/a.dmg' }) })
    const mirror = byRole(parent, 'update-btn-mirror')!
    expect(mirror.style.display).toBe('inline')
    mirror.dispatch('click')
    expect(deps.openDownload).toHaveBeenCalledWith('https://cn.example.com/a.dmg')
  })
  it('下载按钮上行 downloadUrl；稍后收起卡但不 skip', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view() })
    byRole(parent, 'update-btn-download')!.dispatch('click')
    expect(deps.openDownload).toHaveBeenCalledWith('https://dl.example.com/a.dmg')
    byRole(parent, 'update-btn-later')!.dispatch('click')
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
    expect(byRole(parent, 'update-card')!.style.pointerEvents).toBe('none')
    expect(deps.skip).not.toHaveBeenCalled()
  })
  it('跳过此版本：上行版本号并收起', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view() })
    byRole(parent, 'update-btn-skip')!.dispatch('click')
    expect(deps.skip).toHaveBeenCalledWith('0.2.0')
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
  })
})

describe('UpdateNotice 强更阻断层', () => {
  it('forced：阻断层显影 + setModal(true)，卡被收起', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'optional', manual: false, manifest: view() })
    n.handleStatus({ kind: 'forced', manual: false, manifest: view({ version: '0.3.0' }) })
    const forced = byRole(parent, 'update-forced')!
    expect(forced.style.visibility).toBe('visible')
    expect(forced.style.pointerEvents).toBe('auto')
    expect(byRole(parent, 'update-forced-title')!.textContent).toContain('0.3.0')
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
    expect(deps.setModal).toHaveBeenCalledWith(true)
  })
  it('forced 重复到达（renderer:ready 补发）幂等：setModal 只报一次', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'forced', manual: false, manifest: view() })
    n.handleStatus({ kind: 'forced', manual: false, manifest: view() })
    expect(deps.setModal).toHaveBeenCalledTimes(1)
  })
  it('阻断层在场时后续 optional 被忽略', () => {
    const { n } = notice()
    n.handleStatus({ kind: 'forced', manual: false, manifest: view() })
    n.handleStatus({ kind: 'optional', manual: false, manifest: view() })
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
  })
  it('前往下载上行 downloadUrl', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'forced', manual: false, manifest: view() })
    byRole(parent, 'update-forced-download')!.dispatch('click')
    expect(deps.openDownload).toHaveBeenCalledWith('https://dl.example.com/a.dmg')
  })
})

describe('UpdateNotice 手动检查回音', () => {
  it('none → 已是最新；unreachable → 检查失败（文案区分，断网不谎报最新）', () => {
    const { n, deps } = notice()
    n.handleStatus({ kind: 'none', manual: true } as UpdateStatusMsg)
    expect(deps.showMessage).toHaveBeenCalledWith('已是最新版本')
    n.handleStatus({ kind: 'unreachable', manual: true } as UpdateStatusMsg)
    expect(deps.showMessage).toHaveBeenCalledWith('检查更新失败，请稍后再试')
    expect(byRole(parent, 'update-card')!.style.opacity).toBe('0')
  })
})
