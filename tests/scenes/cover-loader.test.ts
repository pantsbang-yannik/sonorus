import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three/webgpu'
import { CoverController, shouldClearOnCoverFail } from '../../src/scenes/nebula/cover-loader'
import type { NebulaParticles } from '../../src/scenes/nebula/particles'

// node 测试环境没有 DOM 的 Image/document：run() 在首个 await 前同步抛错，
// 恰好走进真实的 catch 失败分支——两分支（同曲保留/换歌清空）都能对真类做集成测试
function makeFakeParticles(): { particles: NebulaParticles } {
  const particles = {
    uniforms: {
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uColorC: { value: new THREE.Color() }
    }
    // 真类不再调 setTargets——不留字段，若回退到直调让测试以 TypeError 崩溃（结构性守护）
  } as unknown as NebulaParticles
  return { particles }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('shouldClearOnCoverFail', () => {
  it('换歌失败（键不同）→ 清空', () => {
    expect(shouldClearOnCoverFail('B\0artist', 'A\0artist')).toBe(true)
  })
  it('同曲重载失败（键相同）→ 保留', () => {
    expect(shouldClearOnCoverFail('A\0artist', 'A\0artist')).toBe(false)
  })
  it('当前无封面在显示（shownKey=null）→ 清空（幂等，无害）', () => {
    expect(shouldClearOnCoverFail('A\0artist', null)).toBe(true)
  })
})

describe('CoverController 失败分支', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('换歌加载失败 → clear：退化星云（cloud=null 广播），hasCover 归 false，释放溶解锁', async () => {
    const { particles } = makeFakeParticles()
    let settled = 0
    const cloudEvents: Array<unknown> = []
    const c = new CoverController(particles, 100, {
      onSettled: () => { settled++ },
      onCloudChanged: () => { cloudEvents.push(c.cloud) },
    })
    // 模拟「屏上已显示 A 曲封面」：shownKey/_hasCover 是私有内部态，测试直接注入
    Reflect.set(c, 'shownKey', 'A\0artist')
    Reflect.set(c, '_hasCover', true)

    c.loadCover('data:image/png;base64,x', null, 'B\0artist') // node 无 Image → 必然失败
    await flush()

    expect(cloudEvents).toEqual([null]) // 清空目标点云
    expect(c.cloud).toBeNull()
    expect(c.hasCover).toBe(false)
    expect(settled).toBe(1)
  })

  it('同曲重载失败 → 保持现状：不动点云与 hasCover，仅释放溶解锁', async () => {
    const { particles } = makeFakeParticles()
    let settled = 0
    const cloudEvents: Array<unknown> = []
    const c = new CoverController(particles, 100, {
      onSettled: () => { settled++ },
      onCloudChanged: () => { cloudEvents.push(c.cloud) },
    })
    Reflect.set(c, 'shownKey', 'A\0artist')
    Reflect.set(c, '_hasCover', true)

    c.loadCover('data:image/png;base64,x', null, 'A\0artist') // 同曲重试，失败
    await flush()

    expect(cloudEvents).toEqual([]) // 未清空，屏上封面本就是这首歌的
    expect(c.hasCover).toBe(true)
    expect(settled).toBe(1) // 锁必须释放，否则 morph 卡在溶解态
  })

  it('首载失败（尚无封面）→ clear 幂等收尾，hasCover 保持 false', async () => {
    const { particles } = makeFakeParticles()
    let settled = 0
    const c = new CoverController(particles, 100, {
      onSettled: () => { settled++ },
      onCloudChanged: () => {},
    })

    c.loadCover('data:image/png;base64,x', null, 'A\0artist')
    await flush()

    expect(c.hasCover).toBe(false)
    expect(settled).toBe(1)
  })

  it('降级纯生产者（Phase B1 T6）：clear 只广播 cloud=null + hasCover=false，绝不触碰 particles.setTargets', () => {
    const { particles } = makeFakeParticles()
    // fake 无 setTargets 字段：若真类回退到直调，测试以 TypeError 崩溃（结构性守护）
    const cloudEvents: Array<unknown> = []
    const c = new CoverController(particles, 100, {
      onSettled: () => {},
      onCloudChanged: () => { cloudEvents.push(c.cloud) },
    })
    c.clear(null)
    expect(cloudEvents).toEqual([null])
    expect(c.hasCover).toBe(false)
  })

  it('调色跟随曲目（spec §4.2）：clear 起 Tween 回默认 mood，与显示解耦', () => {
    const { particles } = makeFakeParticles()
    const c = new CoverController(particles, 100, { onSettled: () => {}, onCloudChanged: () => {} })
    particles.uniforms.uColorA.value.setRGB(0.9, 0.1, 0.1) // 弄脏当前色
    c.clear(null)
    c.update(10) // 大步长推完 Tween
    // 回到 DEFAULT_MOOD 的 primary（非弄脏值）——只断言已离开弄脏值且稳定，不锁具体色值
    expect(particles.uniforms.uColorA.value.r).not.toBeCloseTo(0.9, 2)
  })
})
