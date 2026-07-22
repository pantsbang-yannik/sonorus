import { describe, it, expect } from 'vitest'
import { UiStage } from '../../src/ui/ui-stage'

/** 同步假 tween：立即走到目标值并记录轨迹 */
const makeSyncTween = (log: Array<[number, number]>) =>
  (from: number, to: number, onUpdate: (v: number) => void): (() => void) => {
    log.push([from, to])
    onUpdate(to)
    return () => {}
  }

describe('UiStage', () => {
  it('push 推向 1，pop 归 0', () => {
    const seen: number[] = []
    const tweens: Array<[number, number]> = []
    const stage = new UiStage((v) => seen.push(v), makeSyncTween(tweens))
    stage.push()
    stage.pop()
    expect(tweens).toEqual([[0, 1], [1, 0]])
    expect(seen).toEqual([1, 0])
  })

  it('引用计数：两次 push 只起一次开场 tween，全 pop 才归 0', () => {
    const tweens: Array<[number, number]> = []
    const stage = new UiStage(() => {}, makeSyncTween(tweens))
    stage.push()
    stage.push()
    stage.pop()
    expect(tweens).toEqual([[0, 1]]) // 第二次 push 与首次 pop 都不该起新 tween
    stage.pop()
    expect(tweens).toEqual([[0, 1], [1, 0]])
  })

  it('pop 不下穿 0（多余 pop 无害）', () => {
    const tweens: Array<[number, number]> = []
    const stage = new UiStage(() => {}, makeSyncTween(tweens))
    stage.pop()
    expect(tweens).toEqual([])
  })

  it('apply 携带当前 profile，默认 full（A2 退台分级）', () => {
    const seen: Array<[number, string]> = []
    const stage = new UiStage((v, profile) => seen.push([v, profile]), makeSyncTween([]))
    stage.push()
    expect(seen).toEqual([[1, 'full']])
  })

  it('setProfile：不重新起 tween，用当前值立即以新 profile 重新 apply（面板互斥切换用，见 panel-coordinator）', () => {
    const seen: Array<[number, string]> = []
    const tweens: Array<[number, number]> = []
    const stage = new UiStage((v, profile) => seen.push([v, profile]), makeSyncTween(tweens))
    stage.push() // v 推到 1，profile 仍是 full
    seen.length = 0

    stage.setProfile('camera')

    expect(seen).toEqual([[1, 'camera']]) // 立即以当前值 1 重新 apply，未触发新 tween
    expect(tweens).toEqual([[0, 1]]) // 沿用 push 时那次 tween，没有多余的 [1,1] 之类
  })
})
