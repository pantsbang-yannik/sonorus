import { describe, it, expect } from 'vitest'
import { SceneHost } from './host'
import { registerScene } from './registry'
import type { Scene, QualityTier } from './types'
import type { TitleSettings } from './nebula/title-fx'
import { defaultRhythmPreset } from './nebula/mapping/spec'

function makeFakeScene() {
  const applied: unknown[] = []
  const scene: Scene & { applied: unknown[] } = {
    applied,
    init: () => {}, // 同步成功 → start 不会回退 placeholder
    update: () => {},
    onTrackChange: () => {},
    dispose: () => {},
    applyMapping: (m) => { applied.push(m) },
  }
  return scene
}

const QUALITY: QualityTier = { name: 'high', particles: 1000, dprCap: 2, bloom: false, background: { auroraDetail: 'full', ripple: true, nearDust: true } }
const NOOP_RAF = { raf: () => 0, caf: () => {} } // 帧循环不真跑，避免碰 bus/renderer
const FAKE_BUS = { takeFrame: () => null } as any
const FAKE_CANVAS = {} as HTMLCanvasElement

describe('SceneHost.applyMapping 转发与重放', () => {
  it('applyMapping 转发给当前运行场景', async () => {
    const scene = makeFakeScene()
    registerScene('fake-fwd', () => scene)
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-fwd', QUALITY)
    const preset = defaultRhythmPreset()
    host.applyMapping(preset)
    expect(scene.applied).toContain(preset)
    host.stop()
  })

  it('start 重建后把缓存的 mapping 重放给新场景实例', async () => {
    let latest = makeFakeScene()
    registerScene('fake-replay', () => { latest = makeFakeScene(); return latest })
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-replay', QUALITY)
    const preset = defaultRhythmPreset()
    host.applyMapping(preset)
    const first = latest
    await host.start('fake-replay', QUALITY) // 重建 → 新实例应收到缓存重放
    expect(latest).not.toBe(first)
    expect(latest.applied).toContain(preset)
    host.stop()
  })
})

describe('SceneHost.applyTitle 转发与重放', () => {
  function makeTitleScene() {
    const calls: TitleSettings[] = []
    const scene: Scene & { calls: TitleSettings[] } = {
      calls,
      init: () => {},
      update: () => {},
      onTrackChange: () => {},
      dispose: () => {},
      applyTitle: (t) => { calls.push(t) },
    }
    return scene
  }

  it('applyTitle 转发给当前运行场景', async () => {
    const scene = makeTitleScene()
    registerScene('fake-title-fwd', () => scene)
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-title-fwd', QUALITY)
    host.applyTitle({ mode: 'always', position: 0, scale: 1.4, brightness: 0.6 })
    expect(scene.calls).toEqual([{ mode: 'always', position: 0, scale: 1.4, brightness: 0.6 }])
    host.stop()
  })

  it('未设置过不重放；设置过则重建场景重放（同 applyCamera 语义）', async () => {
    let latest = makeTitleScene()
    registerScene('fake-title-replay', () => { latest = makeTitleScene(); return latest })
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-title-replay', QUALITY)
    expect(latest.calls).toEqual([]) // 从未 applyTitle：无重放
    host.applyTitle({ mode: 'off', position: 1.35, scale: 0.7, brightness: 1 })
    await host.start('fake-title-replay', QUALITY) // 重建 → 新实例收到缓存重放
    expect(latest.calls).toEqual([{ mode: 'off', position: 1.35, scale: 0.7, brightness: 1 }])
    host.stop()
  })
})

describe('SceneHost.snapshot 委派（idea #6 fb1）', () => {
  it('场景无 snapshot：返回 null 不炸', async () => {
    const scene = makeFakeScene()
    registerScene('fake-no-snap', () => scene)
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-no-snap', QUALITY)
    expect(await host.snapshot()).toBeNull()
    host.stop()
  })

  it('场景有 snapshot：透传其返回值', async () => {
    const fake = { width: 2, height: 1 } as unknown as ImageData
    const scene = Object.assign(makeFakeScene(), { snapshot: () => Promise.resolve(fake) })
    registerScene('fake-snap', () => scene)
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, NOOP_RAF)
    await host.start('fake-snap', QUALITY)
    expect(await host.snapshot()).toBe(fake)
    host.stop()
  })
})

describe('SceneHost.afterFrame 渲染后钩子（idea #8 录制捕获点）', () => {
  it('每帧 update 之后同任务调用，且拿到 rAF 时间戳', async () => {
    const order: string[] = []
    const scene: Scene = {
      init: () => {},
      update: () => { order.push('update') },
      onTrackChange: () => {},
      dispose: () => {},
    }
    registerScene('fake-after-frame', () => scene)
    let frameCb: FrameRequestCallback | null = null
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, {
      raf: (cb) => { frameCb = cb; return 1 },
      caf: () => {},
      afterFrame: (now) => { order.push(`after:${now}`) },
    })
    await host.start('fake-after-frame', QUALITY)
    frameCb!(1234)
    expect(order).toEqual(['update', 'after:1234'])
    host.stop()
  })

  it('未传 afterFrame 时帧循环照常（可选参数不破坏既有路径）', async () => {
    registerScene('fake-no-hook', () => makeFakeScene())
    let frameCb: FrameRequestCallback | null = null
    const host = new SceneHost(FAKE_CANVAS, FAKE_BUS, { raf: (cb) => { frameCb = cb; return 1 }, caf: () => {} })
    await host.start('fake-no-hook', QUALITY)
    expect(() => frameCb!(16)).not.toThrow()
    host.stop()
  })
})
