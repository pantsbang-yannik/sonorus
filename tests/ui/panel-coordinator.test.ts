import { describe, it, expect, vi } from 'vitest'
import { PanelCoordinator, type PanelLike, type UiStageLike } from '../../src/ui/panel-coordinator'
import type { UiFocusProfile } from '../../src/scenes/types'

/** 轻量假面板——协调器只依赖 retreatProfile/onOpenChange/close()，不需要真实 DOM。
 * open()/close() 模拟 BasePanel 的幂等守卫（已开再 open 不重复广播） */
class FakePanel implements PanelLike {
  onOpenChange: ((open: boolean) => void) | null = null
  ignoreOutsideClickWithin: HTMLElement[] = []
  private open_ = false
  constructor(readonly retreatProfile: UiFocusProfile) {}
  get isOpen(): boolean { return this.open_ }
  open(): void {
    if (this.open_) return
    this.open_ = true
    this.onOpenChange?.(true)
  }
  close(): void {
    if (!this.open_) return
    this.open_ = false
    this.onOpenChange?.(false)
  }
}

type UiStageCall = { type: 'push' } | { type: 'pop' } | { type: 'profile'; profile: UiFocusProfile }

class FakeUiStage implements UiStageLike {
  calls: UiStageCall[] = []
  push(): void { this.calls.push({ type: 'push' }) }
  pop(): void { this.calls.push({ type: 'pop' }) }
  setProfile(profile: UiFocusProfile): void { this.calls.push({ type: 'profile', profile }) }
}

describe('PanelCoordinator（面板协调器，Phase A2 T2）', () => {
  it('open A → uiStage.push 且 profile=A.profile', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('full')
    coordinator.register(a, 'full')

    a.open()

    expect(uiStage.calls).toEqual([{ type: 'profile', profile: 'full' }, { type: 'push' }])
    expect(setModal).toHaveBeenCalledWith(true)
  })

  it('open B（A 已开）→ A 自动 close、仍只一次净 push、profile 切 B', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('full')
    const b = new FakePanel('camera')
    coordinator.register(a, 'full')
    coordinator.register(b, 'camera')

    a.open()
    uiStage.calls = [] // 只看 open B 这一步的增量
    setModal.mockClear()

    b.open()

    expect(a.isOpen).toBe(false) // 互斥：A 自动关闭
    expect(b.isOpen).toBe(true)
    expect(uiStage.calls).toEqual([{ type: 'profile', profile: 'camera' }]) // 没有多余的 pop/push
    expect(setModal).not.toHaveBeenCalled() // 模态状态没变（一直是「有面板打开」）
  })

  it('全部 close → pop', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('full')
    const b = new FakePanel('camera')
    coordinator.register(a, 'full')
    coordinator.register(b, 'camera')

    a.open()
    b.open() // 互斥切到 B
    uiStage.calls = []
    setModal.mockClear()

    b.close()

    expect(b.isOpen).toBe(false)
    expect(uiStage.calls).toEqual([{ type: 'pop' }])
    expect(setModal).toHaveBeenCalledWith(false)
  })

  it('register 不传 profile 时默认取 panel.retreatProfile', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('camera')
    coordinator.register(a) // 不传第二参

    a.open()

    expect(uiStage.calls[0]).toEqual({ type: 'profile', profile: 'camera' })
  })

  it('setTriggerContainers：回填给已注册的面板（register 先于 setTriggerContainers，同 main.ts 实际调用顺序）', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('full')
    const b = new FakePanel('camera')
    coordinator.register(a, 'full')
    coordinator.register(b, 'camera')

    const dockEl = {} as HTMLElement
    coordinator.setTriggerContainers([dockEl])

    expect(a.ignoreOutsideClickWithin).toEqual([dockEl])
    expect(b.ignoreOutsideClickWithin).toEqual([dockEl])
  })

  it('setTriggerContainers：晚注册的面板也补设（触发容器先设好，之后才 register）', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const dockEl = {} as HTMLElement
    coordinator.setTriggerContainers([dockEl])

    const a = new FakePanel('full')
    coordinator.register(a, 'full')

    expect(a.ignoreOutsideClickWithin).toEqual([dockEl])
  })

  it('dispose：断开所有已注册面板的 onOpenChange', () => {
    const uiStage = new FakeUiStage()
    const setModal = vi.fn()
    const coordinator = new PanelCoordinator({ uiStage, setModal })
    const a = new FakePanel('full')
    coordinator.register(a, 'full')

    coordinator.dispose()
    expect(a.onOpenChange).toBeNull()
  })
})
