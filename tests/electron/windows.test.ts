import { describe, it, expect } from 'vitest'
import { planFor, nextOnEsc, WindowManager, type WinAdapter } from '../../electron/windows'

describe('planFor', () => {
  it('fullscreen：全屏、不置顶、不改尺寸', () => {
    expect(planFor('fullscreen')).toEqual({ fullscreen: true, alwaysOnTop: false, resizable: true })
  })

  it('windowed：退全屏、不置顶、可调尺寸、不强改尺寸', () => {
    expect(planFor('windowed')).toEqual({ fullscreen: false, alwaysOnTop: false, resizable: true })
  })
})

describe('模式转换', () => {
  it('Esc：仅全屏 → 普通，其余不动', () => {
    expect(nextOnEsc('fullscreen')).toBe('windowed')
    expect(nextOnEsc('windowed')).toBe('windowed')
  })

})

/** 录制型假窗口：isFullScreen 跟随 setFullScreen 同步变化，但 leave/enter 事件由测试手动触发（模拟 macOS 异步过渡） */
class FakeWin implements WinAdapter {
  calls: string[] = []
  private fullscreen = true
  private visible = true
  private leaveCb: (() => void) | null = null
  private enterCb: (() => void) | null = null
  isFullScreen(): boolean { return this.fullscreen }
  setFullScreen(on: boolean): void { this.calls.push(`setFullScreen:${on}`); this.fullscreen = on }
  onLeaveFullScreen(cb: () => void): void { this.leaveCb = cb }
  emitLeaveFullScreen(): void { this.leaveCb?.() }
  onEnterFullScreen(cb: () => void): void { this.enterCb = cb }
  emitEnterFullScreen(): void { this.enterCb?.() }
  setAlwaysOnTop(on: boolean): void { this.calls.push(`alwaysOnTop:${on}`) }
  setResizable(on: boolean): void { this.calls.push(`resizable:${on}`) }
  setSize(w: number, h: number): void { this.calls.push(`size:${w}x${h}`) }
  setPosition(x: number, y: number): void { this.calls.push(`position:${x},${y}`) }
  center(): void { this.calls.push('center') }
  show(): void { this.calls.push('show'); this.visible = true }
  hide(): void { this.calls.push('hide'); this.visible = false }
  isVisible(): boolean { return this.visible }
}

type WinBounds = { x: number; y: number; width: number; height: number }

const make = (winBounds: WinBounds | null = null): { win: FakeWin; wm: WindowManager; modes: string[] } => {
  const win = new FakeWin()
  const modes: string[] = []
  const wm = new WindowManager(win, () => winBounds, (m) => modes.push(m))
  return { win, wm, modes }
}

describe('WindowManager', () => {
  it('初始为 windowed（亲验 fb7：推翻 M4「启动即全屏」拍板）', () => {
    expect(make().wm.getMode()).toBe('windowed')
  })

  it('全屏 → windowed（无记忆）：先退全屏，等 leave 事件后按默认尺寸(=启动尺寸)居中', () => {
    const { win, wm } = make()
    wm.setMode('fullscreen') // fb7 后初始即 windowed，本用例先进全屏再验回退路径
    win.calls.length = 0
    wm.setMode('windowed')
    expect(win.calls).toEqual(['setFullScreen:false']) // 还没动置顶/尺寸
    win.emitLeaveFullScreen()
    expect(win.calls).toContain('alwaysOnTop:false')
    expect(win.calls).toContain('resizable:true')
    expect(win.calls).toContain('size:1280x800')
    expect(win.calls).toContain('center')
  })

  it('全屏 → windowed（有记忆）：按记忆的 bounds 恢复大小与位置，不 center', () => {
    const { win, wm } = make({ x: 100, y: 50, width: 500, height: 320 })
    wm.setMode('fullscreen') // 同上：先进全屏再验回退
    win.calls.length = 0
    wm.setMode('windowed')
    win.emitLeaveFullScreen()
    expect(win.calls).toContain('size:500x320')
    expect(win.calls).toContain('position:100,50')
    expect(win.calls).not.toContain('center')
  })

  it('handleEsc 只在全屏态生效；onModeChanged 逐次上报', () => {
    const { wm, modes, win } = make()
    wm.setMode('fullscreen') // fb7：初始已是 windowed，先进全屏验 Esc 路径
    wm.handleEsc()
    expect(wm.getMode()).toBe('windowed')
    wm.handleEsc()
    expect(wm.getMode()).toBe('windowed') // 不重复触发
    expect(modes).toEqual(['fullscreen', 'windowed'])
    void win
  })

  it('toggleFullscreen：全屏 → 普通', () => {
    const { win, wm } = make()
    wm.setMode('fullscreen')
    win.calls.length = 0
    wm.toggleFullscreen()
    expect(wm.getMode()).toBe('windowed')
    expect(win.calls).toContain('setFullScreen:false')
  })

  it('toggleFullscreen：普通 → 全屏（初始态即普通，fb7）', () => {
    const { win, wm } = make()
    wm.toggleFullscreen()
    expect(wm.getMode()).toBe('fullscreen')
    expect(win.calls).toContain('setFullScreen:true')
  })

  it('toggleVisible 显↔隐', () => {
    const { win, wm } = make()
    wm.toggleVisible()
    expect(win.calls).toContain('hide')
    wm.toggleVisible()
    expect(win.calls).toContain('show')
  })

  it('setMode 相同模式为 no-op', () => {
    const { win, wm, modes } = make()
    wm.setMode('windowed') // fb7：初始即 windowed
    expect(win.calls).toEqual([])
    expect(modes).toEqual([])
  })
})

describe('外部全屏切换同步（计划②T1）', () => {
  it('外部退全屏（无挂起目标）：mode 同步到 windowed 并广播', () => {
    const { win, wm, modes } = make()
    wm.setMode('fullscreen') // fb7：先进全屏才有「外部退全屏」可验
    modes.length = 0
    win.setFullScreen(false) // 模拟系统/菜单路径直接改窗口
    win.emitLeaveFullScreen()
    expect(wm.getMode()).toBe('windowed')
    expect(modes).toEqual(['windowed'])
    expect(win.calls).toContain('alwaysOnTop:false')
  })

  it('外部进全屏：mode 同步到 fullscreen 并广播；内部 setMode 路径不双播', () => {
    const { win, wm, modes } = make()
    modes.length = 0
    win.setFullScreen(true) // 外部路径
    win.emitEnterFullScreen()
    expect(wm.getMode()).toBe('fullscreen')
    expect(modes).toEqual(['fullscreen'])
    // 内部路径：mode 已是 fullscreen，enter 事件不再触发广播
    win.emitEnterFullScreen()
    expect(modes).toEqual(['fullscreen'])
  })
})
