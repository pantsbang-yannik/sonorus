import { describe, it, expect } from 'vitest'
import { parseLrc } from '../../src/scenes/nebula/lyrics/lrc'

describe('parseLrc', () => {
  it('基本行 + 排序（乱序输入按 t 升序）', () => {
    const lines = parseLrc('[00:20.50]第二句\n[00:10.00]第一句')
    expect(lines).toEqual([{ t: 10, text: '第一句' }, { t: 20.5, text: '第二句' }])
  })
  it('一行多标签展开为多句', () => {
    const lines = parseLrc('[00:10.00][01:10.00]副歌重复句')
    expect(lines).toEqual([{ t: 10, text: '副歌重复句' }, { t: 70, text: '副歌重复句' }])
  })
  it('毫秒三位 / 无小数 / 分钟超两位均可解析', () => {
    expect(parseLrc('[00:05.123]a')[0].t).toBeCloseTo(5.123)
    expect(parseLrc('[00:05]a')[0].t).toBe(5)
    expect(parseLrc('[100:00.00]a')[0].t).toBe(6000)
  })
  it('空文本行与元信息标签行过滤', () => {
    expect(parseLrc('[ar:歌手]\n[ti:歌名]\n[00:10.00]\n[00:12.00]  \n[00:15.00]真句')).toEqual([
      { t: 15, text: '真句' }
    ])
  })
  it('重复时间戳保留先出现者', () => {
    expect(parseLrc('[00:10.00]先\n[00:10.00]后')).toEqual([{ t: 10, text: '先' }])
  })
  it('空串/纯垃圾 → 空数组', () => {
    expect(parseLrc('')).toEqual([])
    expect(parseLrc('not lrc at all')).toEqual([])
  })
})
