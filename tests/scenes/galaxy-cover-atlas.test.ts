import { describe, it, expect } from 'vitest'
import {
  assignAtlasSlots, apparentPx, coverFadeTarget, AtlasLoader,
  ATLAS_PER_PAGE, ATLAS_COLS, ATLAS_CELL, COVER_IN_PX, COVER_OUT_PX,
  type AtlasPageSurface,
} from '../../src/scenes/nebula/galaxy/cover-atlas'
import { setGalaxyArtworkFetcher } from '../../src/scenes/nebula/galaxy/covers'

describe('assignAtlasSlots', () => {
  it('按首现序去重分格；第 257 个唯一 key 翻到第 2 页', () => {
    const keys = Array.from({ length: 300 }, (_, i) => `k${i}`)
    const slots = assignAtlasSlots([...keys, 'k0', 'k1']) // 重复 key 不再占格
    expect(slots.size).toBe(300)
    expect(slots.get('k0')).toEqual({ page: 0, col: 0, row: 0 })
    expect(slots.get('k16')).toEqual({ page: 0, col: 0, row: 1 })
    expect(slots.get(`k${ATLAS_PER_PAGE}`)).toEqual({ page: 1, col: 0, row: 0 })
    expect(ATLAS_COLS * ATLAS_COLS).toBe(ATLAS_PER_PAGE)
  })
})

describe('apparentPx', () => {
  it('距离翻倍→像素减半；fov 60° 视口 1000px 时 1 世界单位@距离1 ≈ 866px', () => {
    const a = apparentPx(0.2, 1, 60, 1000)
    expect(apparentPx(0.2, 2, 60, 1000)).toBeCloseTo(a / 2, 5)
    expect(apparentPx(1, 1, 60, 1000)).toBeCloseTo(1000 / (2 * Math.tan((60 * Math.PI) / 360)), 0)
  })
})

describe('coverFadeTarget（滞回）', () => {
  it('IN 以上进、OUT 以下退、中间保持', () => {
    expect(coverFadeTarget(0, COVER_IN_PX + 1)).toBe(1)
    expect(coverFadeTarget(0, (COVER_IN_PX + COVER_OUT_PX) / 2)).toBe(0) // 中间带保持原态
    expect(coverFadeTarget(1, (COVER_IN_PX + COVER_OUT_PX) / 2)).toBe(1)
    expect(coverFadeTarget(1, COVER_OUT_PX - 1)).toBe(0)
    expect(COVER_OUT_PX).toBeLessThan(COVER_IN_PX) // 滞回带方向防呆
  })
})

const fakeBitmap = {} as ImageBitmap

function makeSurface(log: Array<{ page: number; x: number; y: number }>, page: number): AtlasPageSurface {
  return {
    draw: (_b, x, y) => { log.push({ page, x, y }) },
    markDirty: () => {},
  }
}

describe('AtlasLoader', () => {
  it('渐进就绪：逐张落格并回调 onReady；失败 key 静默跳过', async () => {
    setGalaxyArtworkFetcher(async (key) => (key === 'bad' ? null : new Uint8Array([1])))
    const log: Array<{ page: number; x: number; y: number }> = []
    const loader = new AtlasLoader({ decode: async () => fakeBitmap, concurrency: 2 })
    const readyOrder: string[] = []
    loader.onReady = (k) => readyOrder.push(k)
    loader.start(['a', 'bad', 'c'], (page) => makeSurface(log, page))
    await new Promise((r) => setTimeout(r, 20))
    expect(loader.ready.has('a')).toBe(true)
    expect(loader.ready.has('c')).toBe(true)
    expect(loader.ready.has('bad')).toBe(false)
    expect(readyOrder.sort()).toEqual(['a', 'c'])
    // 'a' 落 (0,0) 格、'bad' 占 (1,0) 格但没画、'c' 落 (2,0) 格
    expect(log.map((l) => l.x).sort((x, y) => x - y)).toEqual([0, ATLAS_CELL * 2])
  })
  it('cancel 后不再落格（烘焙中退出守卫，spec §五）', async () => {
    let release: () => void = () => {}
    setGalaxyArtworkFetcher(() => new Promise((r) => { release = () => r(new Uint8Array([1])) }))
    const log: Array<{ page: number; x: number; y: number }> = []
    const loader = new AtlasLoader({ decode: async () => fakeBitmap, concurrency: 1 })
    loader.start(['a'], (page) => makeSurface(log, page))
    loader.cancel()
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(log.length).toBe(0)
    expect(loader.ready.size).toBe(0)
  })
})
