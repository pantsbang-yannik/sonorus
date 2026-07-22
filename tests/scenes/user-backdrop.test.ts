import { describe, it, expect, vi, afterEach } from 'vitest'
import * as THREE from 'three/webgpu'
import { UserBackdrop, coverUv, setCustomBackgroundFetcher, backdropBrightness } from '../../src/scenes/nebula/user-backdrop'

/** node 下无 createImageBitmap：桩一个假 bitmap（sky.test 同款 node 可构造 CanvasTexture 环境） */
const fakeBitmap = (): ImageBitmap => ({ width: 10, height: 10, close: () => {} }) as unknown as ImageBitmap

describe('coverUv（cover 裁切：铺满不变形，居中裁边）', () => {
  it('图与视野同比：不裁', () => {
    expect(coverUv(16 / 9, 16 / 9)).toEqual({ sx: 1, sy: 1, ox: 0, oy: 0 })
  })
  it('图比视野宽（全景图配竖窗）：横向裁边居中，sy=1', () => {
    const c = coverUv(2, 1)
    expect(c.sy).toBe(1)
    expect(c.sx).toBeCloseTo(0.5)
    expect(c.ox).toBeCloseTo(0.25)
    expect(c.oy).toBe(0)
  })
  it('图比视野窄（竖图配宽窗）：纵向裁边居中，sx=1', () => {
    const c = coverUv(1, 2)
    expect(c.sx).toBe(1)
    expect(c.sy).toBeCloseTo(0.5)
    expect(c.oy).toBeCloseTo(0.25)
  })
  it('坏输入（0/负/NaN）回恒等，不除零', () => {
    expect(coverUv(0, 1.5)).toEqual({ sx: 1, sy: 1, ox: 0, oy: 0 })
    expect(coverUv(NaN, 1.5)).toEqual({ sx: 1, sy: 1, ox: 0, oy: 0 })
  })
})

describe('UserBackdrop 渲染纪律', () => {
  it('层级与穹顶同层：renderOrder -3、不写深度、不做视锥剔除；贴图就绪前不可见', () => {
    const b = new UserBackdrop()
    expect(b.mesh.renderOrder).toBe(-3)
    expect(b.mesh.frustumCulled).toBe(false)
    expect(b.mesh.visible).toBe(false)
    b.dispose()
  })
  it('未就绪时 update 不炸、亮度保持 0（visible=false 早退）', () => {
    const b = new UserBackdrop()
    const cam = new THREE.PerspectiveCamera(60, 16 / 9)
    b.update(0.016, cam, { energy: 1, sleep: 0, opacity: 1, saturation: 1, breathe: false })
    expect(b.stateForTest.bright).toBe(0)
    b.dispose()
  })
})

describe('UserBackdrop 代际守卫 + dispose 竞态（token 竞态范式同 custom-shapes.test.ts:43-52）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('连续两次 show(idA)/show(idB)，idA 晚 resolve：迟到的 idA 返回 false，不覆盖 idB', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(fakeBitmap())))
    const resolvers: Array<(v: Uint8Array) => void> = []
    setCustomBackgroundFetcher(() => new Promise((res) => { resolvers.push(res) }))
    const b = new UserBackdrop()
    const pA = b.show('idA')
    const pB = b.show('idB')
    resolvers[1](new Uint8Array([1, 2, 3])) // idB 先 resolve
    resolvers[0](new Uint8Array([4, 5, 6])) // idA 后 resolve（迟到）
    const [okA, okB] = await Promise.all([pA, pB])
    expect(okA).toBe(false)
    expect(okB).toBe(true)
    expect(b.stateForTest.visible).toBe(true)
    b.dispose()
  })

  it('show() 进行中调 dispose()：在途加载作废（resolve false，不置 visible）', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(fakeBitmap())))
    let resolveFetch: (v: Uint8Array) => void = () => {}
    setCustomBackgroundFetcher(() => new Promise((res) => { resolveFetch = res }))
    const b = new UserBackdrop()
    const p = b.show('id1')
    b.dispose()
    resolveFetch(new Uint8Array([1, 2, 3]))
    const ok = await p
    expect(ok).toBe(false)
    expect(b.stateForTest.visible).toBe(false)
  })
})

describe('backdropBrightness（v2 亮度合成：透明度×呼吸×沉睡×淡入）', () => {
  it('呼吸开：spec 公式 opacity×(0.85+0.2×energy)×(1-sleep×0.35)×fade', () => {
    expect(backdropBrightness({ opacity: 1, breathe: true, energy: 0, sleep: 0, fade: 1 })).toBeCloseTo(0.85)
    expect(backdropBrightness({ opacity: 1, breathe: true, energy: 1, sleep: 0, fade: 1 })).toBeCloseTo(1.05)
    expect(backdropBrightness({ opacity: 0.8, breathe: true, energy: 1, sleep: 0, fade: 1 })).toBeCloseTo(0.84)
  })
  it('呼吸关：呼吸因子恒 1，透明度直通', () => {
    expect(backdropBrightness({ opacity: 0.5, breathe: false, energy: 1, sleep: 0, fade: 1 })).toBeCloseTo(0.5)
  })
  it('透明度 0=全黑；沉睡压暗与淡入仍生效', () => {
    expect(backdropBrightness({ opacity: 0, breathe: true, energy: 1, sleep: 0, fade: 1 })).toBe(0)
    expect(backdropBrightness({ opacity: 1, breathe: false, energy: 0, sleep: 1, fade: 0.5 })).toBeCloseTo(0.325)
  })
})
