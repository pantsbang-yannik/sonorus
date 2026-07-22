import { describe, it, expect } from 'vitest'
import { pickStar } from '../../src/scenes/nebula/galaxy/pick'

const star = (key: string, x: number, y: number, depth = 1) => ({ key, x, y, depth })

describe('pickStar', () => {
  it('半径内取最近', () => {
    expect(pickStar(100, 100, [star('a', 110, 100), star('b', 103, 100)], 24)).toBe('b')
  })
  it('全部超出半径 → null', () => {
    expect(pickStar(0, 0, [star('a', 100, 100)], 24)).toBeNull()
  })
  it('镜头后（depth≤0）排除', () => {
    expect(pickStar(100, 100, [star('a', 100, 100, -1)], 24)).toBeNull()
  })
  it('空集 → null', () => {
    expect(pickStar(0, 0, [], 24)).toBeNull()
  })
})
