import { describe, it, expect } from 'vitest'
import { buildTrayMenuTemplate, type TrayActions } from '../../electron/tray-menu'

const noop = (): void => {}
const actions: TrayActions = { onShowHide: noop, onFullscreen: noop, onWindowed: noop, onSettings: noop, onCheckUpdate: noop, onQuit: noop }

describe('buildTrayMenuTemplate', () => {
  it('包含全部菜单项：显隐/全屏/退出全屏/设置/检查更新/退出', () => {
    const labels = buildTrayMenuTemplate('fullscreen', actions).filter((i) => i.label).map((i) => i.label)
    expect(labels).toEqual(['显示 / 隐藏', '全屏', '退出全屏', '设置…', '检查更新…', '退出 Audelyra'])
  })

  it('当前模式对应项禁用（全屏态禁全屏项启用退出全屏项，普通窗反之）', () => {
    const at = (mode: 'fullscreen' | 'windowed', label: string): boolean | undefined =>
      buildTrayMenuTemplate(mode, actions).find((i) => i.label === label)?.enabled
    expect(at('fullscreen', '全屏')).toBe(false)
    expect(at('fullscreen', '退出全屏')).toBe(true)
    expect(at('windowed', '退出全屏')).toBe(false)
    expect(at('windowed', '全屏')).toBe(true)
  })

  it('点击项转发到对应 action', () => {
    let hit = ''
    const spy: TrayActions = {
      onShowHide: () => { hit = 'showHide' },
      onFullscreen: noop, onWindowed: noop, onSettings: noop, onCheckUpdate: noop, onQuit: noop
    }
    buildTrayMenuTemplate('fullscreen', spy).find((i) => i.label === '显示 / 隐藏')?.click?.()
    expect(hit).toBe('showHide')
  })

  it('「退出全屏」点击转发到 onWindowed', () => {
    let hit = false
    const spy: TrayActions = {
      onShowHide: noop, onFullscreen: noop, onSettings: noop, onCheckUpdate: noop, onQuit: noop,
      onWindowed: () => { hit = true }
    }
    buildTrayMenuTemplate('fullscreen', spy).find((i) => i.label === '退出全屏')?.click?.()
    expect(hit).toBe(true)
  })

  it('「检查更新…」点击转发到 onCheckUpdate（发布准备②）', () => {
    let hit = false
    const spy: TrayActions = {
      onShowHide: noop, onFullscreen: noop, onWindowed: noop, onSettings: noop, onQuit: noop,
      onCheckUpdate: () => { hit = true }
    }
    buildTrayMenuTemplate('windowed', spy).find((i) => i.label === '检查更新…')?.click?.()
    expect(hit).toBe(true)
  })
})
