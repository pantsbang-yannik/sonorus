// 托盘菜单模板（纯函数，零 electron 依赖以便单测）。TrayMenuItem 与
// Electron MenuItemConstructorOptions 结构兼容，胶水侧直接喂 Menu.buildFromTemplate。
import type { WindowMode } from './windows'

export interface TrayActions {
  onShowHide: () => void
  onFullscreen: () => void
  onWindowed: () => void
  onSettings: () => void
  onCheckUpdate: () => void
  onQuit: () => void
}

export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  click?: () => void
  enabled?: boolean
}

export function buildTrayMenuTemplate(mode: WindowMode, a: TrayActions): TrayMenuItem[] {
  return [
    { label: '显示 / 隐藏', click: a.onShowHide },
    { type: 'separator' },
    { label: '全屏', click: a.onFullscreen, enabled: mode !== 'fullscreen' },
    { label: '退出全屏', click: a.onWindowed, enabled: mode === 'fullscreen' },
    { type: 'separator' },
    { label: '设置…', click: a.onSettings },
    { label: '检查更新…', click: a.onCheckUpdate },
    { type: 'separator' },
    { label: '退出 Audelyra', click: a.onQuit }
  ]
}
