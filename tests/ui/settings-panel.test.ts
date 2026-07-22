import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SettingsPanel, type PanelSettings, type PanelDeps } from '../../src/ui/settings-panel'

type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  textContent: string
  children: FakeEl[]
  attrs: Record<string, string>
  appendChild: (c: unknown) => void
  remove: () => void
  setAttribute: (k: string, v: string) => void
  addEventListener: (type: string, cb: Handler) => void
  removeEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
  contains: (node: unknown) => boolean
}

/** node 环境无 DOM：stub 最小 document/element 表面（同 tuning-panel.test.ts 模式）。
 * 收敛到 BasePanel 后设置面板也需要 contains（点外部关）与 children（内容区行断言） */
function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const children: FakeEl[] = []
  const el: FakeEl = {
    style: {},
    textContent: '',
    children,
    attrs: {},
    appendChild: (c) => { children.push(c as FakeEl) },
    remove: () => {},
    setAttribute: (k, v) => { el.attrs[k] = v },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) },
    contains: (node) => node === el || children.some((c) => c.contains(node))
  }
  return el
}

let created: FakeEl[]
let docListeners: Record<string, Handler[]>
let docBody: FakeEl

beforeEach(() => {
  created = []
  docListeners = {}
  docBody = fakeElement()
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el = fakeElement()
      created.push(el)
      return el
    },
    addEventListener: (type: string, cb: Handler) => { (docListeners[type] ??= []).push(cb) },
    removeEventListener: (type: string, cb: Handler) => {
      docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== cb)
    }
  }
})

function makeSettings(patch: Partial<PanelSettings> = {}): PanelSettings {
  return {
    tier: 'auto',
    launchAtLogin: false,
    preventSleep: false,
    onboarded: true,
    updateCheck: { enabled: true, skippedVersion: null },
    ...patch
  }
}

function makeDeps(seed: PanelSettings = makeSettings()): PanelDeps & { setSettings: ReturnType<typeof vi.fn>; onCheckUpdate: ReturnType<typeof vi.fn>; onExportDiagnostics: ReturnType<typeof vi.fn>; changedCbs: Array<(s: PanelSettings) => void> } {
  const changedCbs: Array<(s: PanelSettings) => void> = []
  return {
    getSettings: () => Promise.resolve(seed),
    setSettings: vi.fn((_p: Partial<PanelSettings>) => {}),
    onSettingsChanged: (cb) => { changedCbs.push(cb) },
    getVersion: () => Promise.resolve('0.1.0'),
    onCheckUpdate: vi.fn(() => {}),
    onExportDiagnostics: vi.fn(() => {}),
    changedCbs
  }
}

/** 等一个宏任务——用于 flush 掉实现里用 setTimeout(0) 延迟注册的监听器 */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** 从树里递归查找首个 textContent 完全匹配的节点 */
function findByText(root: FakeEl, text: string): FakeEl | null {
  if (root.textContent === text) return root
  for (const c of root.children) {
    const hit = findByText(c, text)
    if (hit) return hit
  }
  return null
}

describe('SettingsPanel（设置面板，收敛到 BasePanel，Phase A2 T2）', () => {
  it('顶部固定标题「设置」+ retreatProfile=full（收敛到 BasePanel 的外壳）', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    expect(panel.retreatProfile).toBe('full')
    const header = created[0].children[0]
    expect(header.textContent).toBe('设置')
    panel.dispose()
  })

  it('toggle 开合切换 isOpen + pointerEvents（显影收尾）', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    const container = created[0] // constructor 第一个 createElement 是面板根容器
    panel.toggle()
    expect(panel.isOpen).toBe(true)
    expect(container.style.pointerEvents).toBe('auto')
    panel.toggle()
    expect(panel.isOpen).toBe(false)
    expect(container.style.pointerEvents).toBe('none') // 淡出期同刻收，不等 hideTimer 才关
    panel.dispose()
  })

  it('点选项调用 setSettings 正确 patch（性能行点「低」→ {tier:"low"}）', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    const lowSpan = created.find((el) => el.textContent === '低')
    expect(lowSpan).toBeTruthy()
    lowSpan!.dispatch('click', {})
    expect(deps.setSettings).toHaveBeenCalledWith({ tier: 'low' })
    panel.dispose()
  })

  it('自动检查更新点「关」：函数型 patch 整对象回写且保留 skippedVersion（发布准备②）', async () => {
    const deps = makeDeps(makeSettings({ updateCheck: { enabled: true, skippedVersion: '0.2.0' } }))
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    await flush() // 等 getSettings 播种落地（函数型 patch 依赖 latest 快照）
    const row = created.filter((el) => el.textContent === '关')
    expect(row.length).toBe(3) // 开机自启/防休眠/自动检查更新各一
    row[2]!.dispatch('click', {})
    expect(deps.setSettings).toHaveBeenCalledWith({ updateCheck: { enabled: false, skippedVersion: '0.2.0' } })
    panel.dispose()
  })

  it('版本行（fb1）：版本号异步上屏；点「检查更新」上行 onCheckUpdate 且不碰 setSettings', async () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    await flush() // 等 getVersion 落地
    expect(created.some((el) => el.textContent === '0.1.0')).toBe(true)
    const checkEl = created.find((el) => el.textContent === '检查更新')
    expect(checkEl).toBeTruthy()
    checkEl!.dispatch('click', {})
    expect(deps.onCheckUpdate).toHaveBeenCalledTimes(1)
    expect(deps.setSettings).not.toHaveBeenCalled() // 动作不走单向环
    panel.dispose()
  })

  it('诊断行（发布准备③）：点「导出报告」上行 onExportDiagnostics 且不碰 setSettings', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    const exportEl = created.find((el) => el.attrs['data-role'] === 'export-diagnostics')
    expect(exportEl).toBeTruthy()
    expect(exportEl!.textContent).toBe('导出报告')
    exportEl!.dispatch('click', {})
    expect(deps.onExportDiagnostics).toHaveBeenCalledTimes(1)
    expect(deps.setSettings).not.toHaveBeenCalled() // 动作不走单向环
    panel.dispose()
  })

  it('onSettingsChanged 回流刷新选中态不再回写 setSettings（防回声）', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    const callsBefore = deps.setSettings.mock.calls.length
    for (const cb of deps.changedCbs) cb(makeSettings({ tier: 'low' }))
    expect(deps.setSettings.mock.calls.length).toBe(callsBefore)
    panel.dispose()
  })

  it('Esc keydown 在 open 态关面板并 stopPropagation', () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(fakeElement() as unknown as HTMLElement, deps)
    panel.toggle() // 打开
    const stopPropagation = vi.fn()
    for (const cb of docListeners['keydown'] ?? []) cb({ key: 'Escape', stopPropagation })
    expect(stopPropagation).toHaveBeenCalled()
    expect(panel.isOpen).toBe(false)
    panel.dispose()
  })

  it('瘦身（批2 搬家）：不再渲染「粒子歌名」「歌词」分组及其行（迁入调音台）', async () => {
    const deps = makeDeps()
    const panel = new SettingsPanel(docBody as unknown as HTMLElement, deps)
    await flush()
    for (const gone of ['粒子歌名', '歌词', '展示', '节奏动态', '常驻']) {
      expect(findByText(docBody, gone)).toBeNull()
    }
    for (const kept of ['性能', '开机自启', '防休眠']) {
      expect(findByText(docBody, kept)).toBeTruthy()
    }
    panel.dispose()
  })
})
