import { describe, it, expect } from 'vitest'
import { checkImageUsable, renderCustomTextImage, fitTextLines } from '../../src/scenes/nebula/custom-points'
import { wrapTitleLines } from '../../src/scenes/shared/wrap-lines'

/** 手工像素源：fill=[r,g,b,a] */
const makeImg = (w: number, h: number, fill: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4)
  return { width: w, height: h, data }
}

describe('checkImageUsable（idea #12 边界：全黑/全透明图拼不出形状）', () => {
  it('正常图 → ok', () => {
    expect(checkImageUsable(makeImg(8, 8, [200, 120, 80, 255]))).toBe('ok')
  })
  it('几乎全透明 → empty', () => {
    expect(checkImageUsable(makeImg(8, 8, [255, 255, 255, 0]))).toBe('empty')
  })
  it('全黑 → dark', () => {
    expect(checkImageUsable(makeImg(8, 8, [3, 3, 3, 255]))).toBe('dark')
  })
})

describe('renderCustomTextImage', () => {
  it('node 无 DOM → null（场景侧回退 free，不崩）', () => {
    expect(renderCustomTextImage('你好')).toBeNull()
  })
})

describe('wrapTitleLines 搬迁后行为不变（poster 再导出兜底由既有 poster.test 覆盖）', () => {
  it('短文本单行', () => {
    expect(wrapTitleLines('abc', () => true)).toEqual(['abc'])
  })
})

describe('fitTextLines（fb1 修复：缩字号必须先于省略号，30 字内输入必完整显示）', () => {
  // 假 measure：每字符宽 = px（等宽近似），maxW=300 → maxPx=148 下单行装 300/148≈2 字，两行约 4 字
  const measure = (s: string, px: number) => s.length * px
  const opts = { maxW: 300, maxPx: 148, minPx: 36 }

  it('短文本 → maxPx 单行、无省略号（快路径不变）', () => {
    const r = fitTextLines('ab', measure, opts)
    expect(r.px).toBe(148)
    expect(r.lines).toEqual(['ab'])
    expect(r.lines.some((l) => l.endsWith('…'))).toBe(false)
  })

  it('中长文本 → 降字号后完整装下（px < maxPx 且无省略号），而非在高字号下截断', () => {
    // minPx=36 下两行容量 = 2 * floor(300/36) = 2*8 = 16 字（近似，wrapTitleLines 按空格/字符断）
    const text = '一二三四五六七八九十'
    const r = fitTextLines(text, measure, opts)
    expect(r.px).toBeLessThan(148)
    expect(r.lines.some((l) => l.endsWith('…'))).toBe(false)
    expect(r.lines.join('')).toBe(text) // 完整显示，一字不丢
  })

  it('极端超长文本（超过 minPx 两行容量）→ 触底 minPx 且末行带省略号（兜底仍截断）', () => {
    const text = '字'.repeat(50)
    const r = fitTextLines(text, measure, opts)
    expect(r.px).toBe(36)
    expect(r.lines[r.lines.length - 1].endsWith('…')).toBe(true)
  })
})
