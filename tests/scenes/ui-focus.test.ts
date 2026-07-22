import { describe, it, expect } from 'vitest'
import { uiFocusOutput } from '../../src/scenes/nebula/ui-focus'
describe('uiFocusOutput 退台分级', () => {
  it("'full' 与改动前三联动一致", () => {
    expect(uiFocusOutput(1, 'full')).toEqual({ dim: 1 - 0.45, defocus: 1, camera: 0.8 })
    expect(uiFocusOutput(0, 'full')).toEqual({ dim: 1, defocus: 0, camera: 0 })
  })
  it("'camera' 只后拉：不调暗不退焦", () => {
    expect(uiFocusOutput(1, 'camera')).toEqual({ dim: 1, defocus: 0, camera: 0.8 })
    expect(uiFocusOutput(0.5, 'camera')).toEqual({ dim: 1, defocus: 0, camera: 0.4 })
  })
})
