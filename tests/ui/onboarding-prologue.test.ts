// 序幕 UI 接线（发布准备③ spec §1.2，审②P2-8 回账）：点击推进/跳过/落幕显影/点击层失效
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runOnboarding, type OnboardingDeps } from '../../src/ui/onboarding'

type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  textContent: string
  children: FakeEl[]
  attrs: Record<string, string>
  firstElementChild: FakeEl | null
  appendChild: (c: unknown) => void
  append: (...cs: unknown[]) => void
  remove: () => void
  setAttribute: (k: string, v: string) => void
  addEventListener: (type: string, cb: Handler) => void
  dispatch: (type: string, e?: unknown) => void
}

function fakeElement(): FakeEl {
  const listeners: Record<string, Handler[]> = {}
  const children: FakeEl[] = []
  const el: FakeEl = {
    style: {},
    textContent: '',
    children,
    attrs: {},
    get firstElementChild() { return children[0] ?? null },
    appendChild: (c) => { children.push(c as FakeEl) },
    append: (...cs) => { for (const c of cs) children.push(c as FakeEl) },
    remove: () => {},
    setAttribute: (k, v) => { el.attrs[k] = v },
    addEventListener: (type, cb) => { (listeners[type] ??= []).push(cb) },
    dispatch: (type, e) => { for (const cb of listeners[type] ?? []) cb(e) }
  }
  return el
}

let created: FakeEl[]
let rafCbs: FrameRequestCallback[]

beforeEach(() => {
  vi.useFakeTimers()
  created = []
  rafCbs = []
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el = fakeElement()
      created.push(el)
      return el
    }
  }
  ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCbs.push(cb)
    return rafCbs.length
  }
  ;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {}
})

afterEach(() => {
  vi.useRealTimers()
})

function flushRaf(): void {
  const cbs = rafCbs.splice(0)
  for (const cb of cbs) cb(performance.now())
}

function byRole(role: string): FakeEl | undefined {
  return created.find((el) => el.attrs['data-role'] === role)
}

/** intro 幕容器 = textContent 为 AUDELYRA 的字标的父级 */
function introScene(): FakeEl {
  const title = created.find((el) => el.textContent === 'AUDELYRA')!
  return created.find((el) => el.children.includes(title))!
}

function makeDeps(prologue: OnboardingDeps['prologue']): OnboardingDeps {
  return {
    parent: fakeElement() as unknown as HTMLElement,
    latestHasAudio: () => false,
    hasTrack: () => false,
    restartCapture: () => {},
    openAudioPrefs: () => {},
    prologue,
    onOpenStateChanged: () => {},
    onDone: () => {}
  }
}

describe('onboarding 序幕（发布准备③）', () => {
  it('无序幕（prologue=null）：首帧 raf 后 intro 直接显影（现状行为不回归）', () => {
    const ob = runOnboarding(makeDeps(null))
    expect(byRole('onboarding-prologue-click')).toBeUndefined()
    flushRaf()
    expect(introScene().style.visibility).toBe('visible')
    ob.dispose()
  })

  it('有序幕：首帧显影序幕而非 intro；3s 后点击提示淡入，文案取自 hint()', () => {
    const ob = runOnboarding(makeDeps({ advance: vi.fn(() => false), skip: vi.fn(), hint: () => '点一下，让声音继续进化', toggleAudio: () => true }))
    flushRaf()
    expect(introScene().style.visibility).not.toBe('visible')
    const hint = byRole('onboarding-prologue-hint')!
    expect(hint.textContent).toBe('点一下，让声音继续进化')
    expect(hint.style.opacity).not.toBe('1')
    vi.advanceTimersByTime(3000)
    expect(hint.style.opacity).toBe('1')
    ob.dispose()
  })

  it('逐站换词（③亲验反馈）：点击推进后提示换成新站文案并立即显影；落幕点击不再改词', () => {
    const advance = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const hints = ['后来，它装进了口袋', '不应出现：落幕后不取词']
    let hintCalls = 0
    const ob = runOnboarding(makeDeps({ advance, skip: vi.fn(), hint: () => hints[hintCalls++] ?? '', toggleAudio: () => true }))
    flushRaf()
    const hint = byRole('onboarding-prologue-hint')!
    hintCalls = 0 // 初始化取词（首站）不计
    const clickLayer = byRole('onboarding-prologue-click')!
    clickLayer.dispatch('click', {}) // 推进到站2：换词 + 提前于 3s 定时器直接显影
    expect(hint.textContent).toBe('后来，它装进了口袋')
    expect(hint.style.opacity).toBe('1')
    clickLayer.dispatch('click', {}) // 到终点：落幕，不应再取词改文案（突变验证：advance 后无条件换词应红）
    expect(hint.textContent).toBe('后来，它装进了口袋')
    ob.dispose()
  })

  it('点击推进：未到终点续演；到终点（advance→true）落幕——intro 显影、点击层失效', () => {
    const advance = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const ob = runOnboarding(makeDeps({ advance, skip: vi.fn(), hint: () => '', toggleAudio: () => true }))
    flushRaf()
    const clickLayer = byRole('onboarding-prologue-click')!
    clickLayer.dispatch('click', {})
    expect(advance).toHaveBeenCalledTimes(1)
    expect(introScene().style.visibility).not.toBe('visible') // 还在序幕
    clickLayer.dispatch('click', {})
    expect(introScene().style.visibility).toBe('visible')
    expect(clickLayer.style.pointerEvents).toBe('none')
    expect(byRole('onboarding-prologue-skip')!.style.display).toBe('none')
    clickLayer.dispatch('click', {})
    expect(advance).toHaveBeenCalledTimes(2) // 落幕后点击层不再上行（突变验证：去掉 inPrologue 闸应红）
    ob.dispose()
  })

  it('配乐静音钮（亲验反馈轮②）：点击翻转标签并上行 toggleAudio；落幕后隐藏', () => {
    let muted = false
    const toggleAudio = vi.fn(() => { muted = !muted; return muted })
    const ob = runOnboarding(makeDeps({ advance: vi.fn(() => true), skip: vi.fn(), hint: () => '', toggleAudio }))
    flushRaf()
    const mute = byRole('onboarding-prologue-mute')!
    expect(mute.textContent).toBe('关闭音乐')
    mute.dispatch('click', {})
    expect(toggleAudio).toHaveBeenCalledTimes(1)
    expect(mute.textContent).toBe('打开音乐') // 突变验证：标签不随返回值翻转应红
    mute.dispatch('click', {})
    expect(mute.textContent).toBe('关闭音乐')
    byRole('onboarding-prologue-click')!.dispatch('click', {}) // advance→true 落幕
    expect(mute.style.display).toBe('none')
    ob.dispose()
  })

  it('跳过：skip 上行一次并直接落幕到 intro', () => {
    const skip = vi.fn()
    const ob = runOnboarding(makeDeps({ advance: vi.fn(() => false), skip, hint: () => '', toggleAudio: () => true }))
    flushRaf()
    byRole('onboarding-prologue-skip')!.dispatch('click', {})
    expect(skip).toHaveBeenCalledTimes(1)
    expect(introScene().style.visibility).toBe('visible')
    ob.dispose()
  })
})
