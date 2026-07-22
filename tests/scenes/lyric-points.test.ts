import { describe, it, expect } from 'vitest'
import { padPositions } from '../../src/scenes/nebula/lyrics/lyric-points'

describe('padPositions', () => {
  it('等长原样返回（零拷贝或等值）', () => {
    const p = new Float32Array([1, 2, 3, 4, 5, 6])
    expect(Array.from(padPositions(p, 2))).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('超长截断到 capacity*3', () => {
    const p = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(padPositions(p, 2)).toHaveLength(6)
  })
  it('偏短用首点补齐尾部（护栏：不残留上一句旧点）', () => {
    const p = new Float32Array([1, 2, 3])
    expect(Array.from(padPositions(p, 3))).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3])
  })
  it('空输入补零点', () => {
    expect(Array.from(padPositions(new Float32Array(0), 2))).toEqual([0, 0, 0, 0, 0, 0])
  })
})
