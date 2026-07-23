import { describe, it, expect } from 'vitest'
import {
  POSTER_W,
  POSTER_H,
  IMAGE_MAX_H,
  layoutPoster,
  posterFilename,
  formatPosterDate,
  wrapTitleLines,
  truncateToFit,
  EnergyRibbon,
  RIBBON_CAPACITY,
  RIBBON_BUCKET_MS
} from '../../src/ui/poster'

describe('wrapTitleLines 歌名断行（fb4：最多两行）', () => {
  // 注入宽度判定：按 code point 数模拟（≤n 个字符算放得下）
  const fitsUpTo = (n: number) => (s: string) => [...s].length <= n

  it('放得下：单行原样', () => {
    expect(wrapTitleLines('雾里', fitsUpTo(10))).toEqual(['雾里'])
  })

  it('超一行：断成两行', () => {
    expect(wrapTitleLines('好想爱这个世界啊', fitsUpTo(5))).toEqual(['好想爱这个', '世界啊'])
  })

  it('超两行：第二行截断加省略号', () => {
    const lines = wrapTitleLines('一二三四五六七八九十一二三四五', fitsUpTo(5))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('一二三四五')
    expect(lines[1]).toBe('六七八九…')
    expect([...lines[1]].length).toBeLessThanOrEqual(5)
  })

  it('英文优先在空格断词，第二行去头空格', () => {
    expect(wrapTitleLines('Bohemian Rhapsody', fitsUpTo(12))).toEqual(['Bohemian', 'Rhapsody'])
  })

  it('空格太靠前（<40% 位置）不硬断词：回退逐字断', () => {
    expect(wrapTitleLines('a verylongword', fitsUpTo(10))).toEqual(['a verylong', 'word'])
  })

  it('emoji 不被切成孤立代理项', () => {
    const lines = wrapTitleLines('🎵🎵🎵🎵🎵🎵', fitsUpTo(4))
    for (const l of lines) expect(l).not.toContain('�')
    expect(lines[0]).toBe('🎵🎵🎵🎵')
  })
})

describe('truncateToFit 单行超长截断（亲验 fb①：歌手多人串顶版式边缘）', () => {
  const fitsUpTo = (n: number) => (s: string) => [...s].length <= n

  it('放得下：原样返回', () => {
    expect(truncateToFit('雾里', fitsUpTo(10))).toBe('雾里')
  })

  it('超长：逐字符截断加省略号', () => {
    const long = 'Bassjackers/Lucas & Steve/Caroline Pennell'
    const r = truncateToFit(long, fitsUpTo(20))
    expect(r.endsWith('…')).toBe(true)
    expect([...r].length).toBeLessThanOrEqual(20)
  })

  it('空串：量得下原样返回空串', () => {
    expect(truncateToFit('', fitsUpTo(10))).toBe('')
  })
})

describe('layoutPoster 排版几何（fb1：主图=屏幕原样，比例随窗口）', () => {
  // 横窗 16:10（常规）与竖窗 0.6（极端）两个代表比例都要成版
  for (const [label, aspect] of [['横窗 16:10', 16 / 10], ['竖窗 0.6', 0.6]] as const) {
    it(`${label}：全部区块在画布内且自上而下无重叠`, () => {
      const L = layoutPoster(aspect)
      const zones = [L.image, L.title, L.meta, L.ribbon, L.brand]
      for (const z of zones) {
        expect(z.x).toBeGreaterThanOrEqual(0)
        expect(z.y).toBeGreaterThanOrEqual(0)
        expect(z.x + z.w).toBeLessThanOrEqual(POSTER_W)
        expect(z.y + z.h).toBeLessThanOrEqual(POSTER_H)
      }
      for (let i = 1; i < zones.length; i++) {
        expect(zones[i].y).toBeGreaterThanOrEqual(zones[i - 1].y + zones[i - 1].h)
      }
    })
  }

  it('横窗：主图通栏铺满宽、高按比例', () => {
    const L = layoutPoster(16 / 10)
    expect(L.image).toMatchObject({ x: 0, y: 0, w: POSTER_W, h: Math.round(POSTER_W / (16 / 10)) })
  })

  it('竖窗：主图高封顶 IMAGE_MAX_H、等比缩宽居中', () => {
    const L = layoutPoster(0.6)
    expect(L.image.h).toBe(IMAGE_MAX_H)
    expect(L.image.w).toBe(Math.round(IMAGE_MAX_H * 0.6))
    expect(L.image.x).toBe(Math.round((POSTER_W - L.image.w) / 2))
  })

  it('脏比例（0/NaN/负）回默认 16:10 不炸', () => {
    for (const bad of [0, NaN, -2, Infinity]) {
      const L = layoutPoster(bad)
      expect(L.image.w).toBeGreaterThan(0)
      expect(L.image.h).toBeGreaterThan(0)
      expect(L.image.h).toBeLessThanOrEqual(IMAGE_MAX_H)
    }
  })

  it('brand 钉底（主图高度浮动不影响底部版式）', () => {
    expect(layoutPoster(16 / 10).brand.y).toBe(layoutPoster(0.6).brand.y)
  })

  it('两行歌名：title 区高翻倍，竖窗极端（IMAGE_MAX_H+两行）仍不与字标重叠', () => {
    expect(layoutPoster(16 / 10, 2).title.h).toBe(layoutPoster(16 / 10, 1).title.h * 2)
    const L = layoutPoster(0.6, 2) // 最挤组合
    expect(L.ribbon.y + L.ribbon.h).toBeLessThanOrEqual(L.brand.y)
  })

  it('两行落款（亲验 fb①：歌手+日期）：meta 区高翻倍，最挤组合（竖窗极端+两行歌名+两行落款）仍不与字标重叠', () => {
    expect(layoutPoster(16 / 10, 1, 2).meta.h).toBe(layoutPoster(16 / 10, 1, 1).meta.h * 2)
    const L = layoutPoster(0.6, 2, 2) // 最挤组合：主图封顶 + 歌名两行 + 落款两行
    expect(L.ribbon.y + L.ribbon.h).toBeLessThanOrEqual(L.brand.y)
  })

  it('宽屏(16:9)：文字栈在主图与字标间近似居中（聚焦审#4 头重脚轻修复）', () => {
    const L = layoutPoster(16 / 9)
    const above = L.title.y - L.image.h
    const below = L.brand.y - (L.ribbon.y + L.ribbon.h)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
  })
})

describe('posterFilename', () => {
  const now = new Date(2026, 6, 14, 15, 42, 7) // 本地时 2026-07-14 15:42:07

  it('常规歌名 + 紧凑时间戳', () => {
    expect(posterFilename('雾里', now)).toBe('Audelyra-雾里-20260714-154207.png')
  })

  it('清洗文件系统非法字符', () => {
    expect(posterFilename('AC/DC: "Back" <in> Black?*|\\', now)).toBe(
      'Audelyra-AC_DC_ _Back_ _in_ Black____-20260714-154207.png'
    )
  })

  it('空/全非法歌名兜底 untitled（unknown 态）', () => {
    expect(posterFilename('', now)).toBe('Audelyra-untitled-20260714-154207.png')
    expect(posterFilename('   ', now)).toBe('Audelyra-untitled-20260714-154207.png')
  })

  it('超长歌名截断（文件名不爆）', () => {
    const long = '很'.repeat(200)
    expect(posterFilename(long, now).length).toBeLessThanOrEqual(120)
  })
})

describe('formatPosterDate', () => {
  it('中文落款格式', () => {
    expect(formatPosterDate(new Date(2026, 6, 14, 15, 5))).toBe('2026年7月14日 15:05')
  })
})

describe('EnergyRibbon 环形缓冲', () => {
  it('同桶取峰值，跨桶推进', () => {
    const r = new EnergyRibbon()
    r.push(0.3, 0)
    r.push(0.8, RIBBON_BUCKET_MS / 2) // 同桶：峰值 0.8
    r.push(0.5, RIBBON_BUCKET_MS + 1) // 次桶
    expect(r.values()).toEqual([0.8, 0.5])
  })

  it('跳桶间隙补 0（静默段可见）', () => {
    const r = new EnergyRibbon()
    r.push(0.6, 0)
    r.push(0.4, RIBBON_BUCKET_MS * 3) // 隔了 2 个空桶
    expect(r.values()).toEqual([0.6, 0, 0, 0.4])
  })

  it('超容量丢最旧', () => {
    const r = new EnergyRibbon()
    for (let i = 0; i < RIBBON_CAPACITY + 10; i++) r.push(i / (RIBBON_CAPACITY + 10), i * RIBBON_BUCKET_MS)
    const v = r.values()
    expect(v).toHaveLength(RIBBON_CAPACITY)
    expect(v[v.length - 1]).toBeCloseTo((RIBBON_CAPACITY + 9) / (RIBBON_CAPACITY + 10))
  })

  it('值钳位到 0..1（脏输入不毁折线）', () => {
    const r = new EnergyRibbon()
    r.push(-5, 0)
    r.push(99, RIBBON_BUCKET_MS)
    expect(r.values()).toEqual([0, 1])
  })

  it('空缓冲 values 为空数组', () => {
    expect(new EnergyRibbon().values()).toEqual([])
  })

  it('断流超一屏（gap > 容量）清空重起，不做天量补 0（双审②P2）', () => {
    const r = new EnergyRibbon()
    r.push(0.5, 0)
    r.push(0.7, (RIBBON_CAPACITY + 5) * RIBBON_BUCKET_MS) // 断流一小时量级后恢复
    expect(r.values()).toEqual([0.7])
  })
})
