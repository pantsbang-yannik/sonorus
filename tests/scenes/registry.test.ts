import { describe, it, expect } from 'vitest'
import { registerScene, createScene, sceneNames } from '../../src/scenes/registry'
import type { Scene } from '../../src/scenes/types'

function fakeScene(): Scene {
  return { init() {}, update() {}, onTrackChange() {}, dispose() {} }
}

describe('registry', () => {
  it('注册后可创建，未注册抛错', () => {
    registerScene('t1', fakeScene)
    expect(createScene('t1')).toBeDefined()
    expect(sceneNames()).toContain('t1')
    expect(() => createScene('nope')).toThrow()
  })
})
