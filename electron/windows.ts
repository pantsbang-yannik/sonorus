// 窗口两态状态机（2026-07-06 拍板：小窗/置顶退役，只剩 全屏 ↔ 普通窗）。
// 纯逻辑与 BrowserWindow 胶水分层：本文件的纯函数与 WindowManager 均不 import electron 运行时。
import type { WinBounds } from './settings'

export type WindowMode = 'fullscreen' | 'windowed'

export interface ModePlan {
  fullscreen: boolean
  alwaysOnTop: boolean
  resizable: boolean
}

export function planFor(mode: WindowMode): ModePlan {
  switch (mode) {
    case 'fullscreen':
      return { fullscreen: true, alwaysOnTop: false, resizable: true }
    case 'windowed':
      return { fullscreen: false, alwaysOnTop: false, resizable: true }
  }
}

/** Esc 只从全屏退到普通窗口；普通窗的 Esc 不做事 */
export function nextOnEsc(mode: WindowMode): WindowMode {
  return mode === 'fullscreen' ? 'windowed' : mode
}

/** BrowserWindow 的最小门面：真实实现见 main.ts 的 createWinAdapter，测试注入 FakeWin */
export interface WinAdapter {
  isFullScreen(): boolean
  setFullScreen(on: boolean): void
  onLeaveFullScreen(cb: () => void): void
  onEnterFullScreen(cb: () => void): void
  setAlwaysOnTop(on: boolean): void
  setResizable(on: boolean): void
  setSize(w: number, h: number): void
  setPosition(x: number, y: number): void
  center(): void
  show(): void
  hide(): void
  isVisible(): boolean
}

// 普通窗从未被记忆过时的默认尺寸——与 electron/main.ts createWindow 的启动尺寸一致
const WIN_DEFAULT = { width: 1280, height: 800 }

export class WindowManager {
  private mode: WindowMode = 'windowed' // 亲验 fb7：启动改普通窗（推翻 M4「启动即全屏沉浸」拍板），⌃⌘F/操作坞随时可进全屏
  private pendingAfterLeave: Exclude<WindowMode, 'fullscreen'> | null = null

  constructor(
    private win: WinAdapter,
    private winBounds: () => WinBounds | null,
    private onModeChanged: (m: WindowMode) => void
  ) {
    this.win.onLeaveFullScreen(() => {
      if (this.pendingAfterLeave) {
        const target = this.pendingAfterLeave
        this.pendingAfterLeave = null
        this.applyNonFullscreen(target)
      } else if (this.mode === 'fullscreen') {
        // 外部路径（菜单/系统手势）退全屏：状态机没发起过转换，把 mode 拉回现实并广播
        this.mode = 'windowed'
        this.applyNonFullscreen('windowed')
        this.onModeChanged('windowed')
      }
    })
    this.win.onEnterFullScreen(() => {
      if (this.mode === 'fullscreen') return // 内部 setMode 路径已广播过
      // 外部进全屏：同步 mode
      this.mode = 'fullscreen'
      this.pendingAfterLeave = null
      this.win.setAlwaysOnTop(false)
      this.win.setResizable(true)
      this.onModeChanged('fullscreen')
    })
  }

  getMode(): WindowMode {
    return this.mode
  }

  setMode(next: WindowMode): void {
    if (next === this.mode) return
    this.mode = next
    if (next === 'fullscreen') {
      this.pendingAfterLeave = null
      this.win.setAlwaysOnTop(false)
      this.win.setResizable(true)
      this.win.setFullScreen(true)
    } else if (this.win.isFullScreen() || this.pendingAfterLeave) {
      // macOS 退全屏是异步过渡：挂起目标，等 leave-full-screen 再应用
      this.pendingAfterLeave = next
      this.win.setFullScreen(false)
    } else {
      this.applyNonFullscreen(next)
    }
    this.onModeChanged(next)
  }

  handleEsc(): void {
    this.setMode(nextOnEsc(this.mode))
  }

  /** ⌃⌘F 全屏开关：全屏↔普通 */
  toggleFullscreen(): void {
    this.setMode(this.mode === 'fullscreen' ? 'windowed' : 'fullscreen')
  }

  /** 托盘「显示 / 隐藏」 */
  toggleVisible(): void {
    if (this.win.isVisible()) this.win.hide()
    else this.win.show()
  }

  private applyNonFullscreen(mode: Exclude<WindowMode, 'fullscreen'>): void {
    const plan = planFor(mode)
    this.win.setAlwaysOnTop(plan.alwaysOnTop)
    this.win.setResizable(plan.resizable)
    // 有记忆恢复上次大小/位置；无记忆用默认尺寸（=启动尺寸）居中
    const b = this.winBounds()
    if (b) {
      this.win.setSize(b.width, b.height)
      this.win.setPosition(b.x, b.y)
    } else {
      this.win.setSize(WIN_DEFAULT.width, WIN_DEFAULT.height)
      this.win.center()
    }
  }
}
