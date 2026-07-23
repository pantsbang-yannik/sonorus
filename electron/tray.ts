// 托盘常驻胶水（M4 设计第 4 节）。图标是模板图（黑+alpha 的声环），菜单栏自动适配深浅色。
import { Tray, Menu, nativeImage } from 'electron'
import type { WindowMode } from './windows'
import { buildTrayMenuTemplate, type TrayActions } from './tray-menu'

// 16×16 / 32×32 圆环模板图（纯黑 + alpha 抗锯齿圆环，生成脚本见计划文档）
const ICON_1X =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgklEQVR4nGNgoAGQBeIOIL4MxL+g+DJUTJaQ5hSohv848C+oGpyakRXvBeI2KN6LJodhiCySzZ+A2AeLBT5QOZhLULzTgWQ6Ns3IhsDUdSBLXEZyNiEA885lZEGY89uIMKCNAeEN6hlAsRcoDkSKoxEEKEpIyIaQnZSRvUN2ZiIZAACDi1qV5qFm3gAAAABJRU5ErkJggg=='
const ICON_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABDElEQVR4nO2X3wmEMAzGC52kKziAT85wLy7gMt3FIXz03Rm6g3CXYgQpXzT+gRzH/eB7kTRJ07S2zv05R0OKpIGUSDMr8bfINo/TkSbSW6mJx9ymcsvMtIFLDezjEi+3lPdq8FUz+zod/G7gUuokqoOZ96SWFEieFfhbf1AJ1XJIaz6SasX4mm2lntilEwbmmXlN9ox3cjV2dwfaauPJ4NskUCUmaUAjZKwpu0Qt+ISHVQSG/Y3gK2gpIjJEzdc+kEAL/MJmTMAwPJBAAH4TMkR7/0rzlXjgd/7KBMyXwLwJzbeh+UGUMT2KM+Y/o4zp7zhjfiHJmF7JtkmYXUpXTK/lW8weJiVmT7Pf5QN3TWecxPxZKAAAAABJRU5ErkJggg=='

export function createTray(
  getMode: () => WindowMode,
  actions: TrayActions
): { refresh: () => void; destroy: () => void } {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_1X}`)
  icon.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${ICON_2X}` })
  icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip('Audelyra')
  const refresh = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(getMode(), actions)))
  }
  refresh()
  return { refresh, destroy: () => tray.destroy() }
}
