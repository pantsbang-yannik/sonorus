// 空状态提示 UI 壳（发布准备③ spec §2.2）：显影切换幂等 + 按钮接线（FakeEl 惯例同 player-bar）
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdleHint } from '../../src/ui/idle-hint'

type Handler = (e: unknown) => void
interface FakeEl {
  style: Record<string, string>
  textContent: string
  children: FakeEl[]
  attrs: Record<string, string>
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

beforeEach(() => {
  created = []
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el = fakeElement()
      created.push(el)
      return el
    }
  }
})

function byRole(role: string): FakeEl | undefined {
  return created.find((el) => el.attrs['data-role'] === role)
}

/** 幕容器 = 带 data-role 锚点元素的父级（构造序：teach 幕/permission 幕各自 wrapper 在其内容之前创建） */
function sceneOf(role: string): FakeEl {
  const anchor = byRole(role)!
  return created.find((el) => el.children.includes(anchor))!
}

describe('IdleHint', () => {
  it('初始 hidden：两幕都不可见', () => {
    new IdleHint(fakeElement() as unknown as HTMLElement, { openAudioPrefs: () => {}, restartCapture: () => {} })
    // makeSceneWrapper 初始 cssText 含 visibility: hidden——FakeEl 不解析 cssText，
    // 以「未被 setState 显影过（style.visibility 未显式写 visible）」为断言口径
    expect(sceneOf('idle-hint-teach').style.visibility).not.toBe('visible')
    expect(sceneOf('idle-hint-permission').style.visibility).not.toBe('visible')
  })

  it('setState(teach)/setState(permission) 互斥显影，回 hidden 全藏', () => {
    const hint = new IdleHint(fakeElement() as unknown as HTMLElement, { openAudioPrefs: () => {}, restartCapture: () => {} })
    hint.setState('teach')
    expect(sceneOf('idle-hint-teach').style.visibility).toBe('visible')
    expect(sceneOf('idle-hint-permission').style.visibility).toBe('hidden')
    hint.setState('permission')
    expect(sceneOf('idle-hint-teach').style.visibility).toBe('hidden')
    expect(sceneOf('idle-hint-permission').style.visibility).toBe('visible')
    hint.setState('hidden')
    expect(sceneOf('idle-hint-teach').style.visibility).toBe('hidden')
    expect(sceneOf('idle-hint-permission').style.visibility).toBe('hidden')
  })

  it('权限幕按钮接线：打开系统设置 / 重试各自上行', () => {
    const openAudioPrefs = vi.fn()
    const restartCapture = vi.fn()
    new IdleHint(fakeElement() as unknown as HTMLElement, { openAudioPrefs, restartCapture })
    byRole('idle-hint-open-prefs')!.dispatch('click', {})
    expect(openAudioPrefs).toHaveBeenCalledTimes(1)
    byRole('idle-hint-retry')!.dispatch('click', {})
    expect(restartCapture).toHaveBeenCalledTimes(1)
  })
})
