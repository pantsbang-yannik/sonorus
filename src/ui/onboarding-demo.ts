// src/ui/onboarding-demo.ts
// 序幕「声音的形状进化史」（发布准备③ spec §1）：五站剧本状态机 + demo trace 回放跑带。
// 剧本纯逻辑零 DOM/零 electron（可测）；跑带薄壳复用 TracePlayer（trace-controls 同款 rAF 泵）。
import { TracePlayer } from '../engine/trace'
import type { Signals } from '../engine/types'
import type { ShapeId } from '../scenes/nebula/shapes/types'

/** 站序即叙事：留声机 → 卡带 → 耳机 → 麦克风（轮到你发声）→ 星云（「这是声音的下一个形状」）。
 * 第四站原设计 DJ 台，2026-07-21 用户拍板换麦克风：方盒剪影粒子化不可读，且麦克风把「听的进化」收束到「你」 */
export const DEMO_STATIONS: readonly ShapeId[] = ['demo-gramophone', 'demo-cassette', 'demo-headphones', 'demo-mic', 'nebula']

/** 每站引导文案（③亲验反馈：逐站换词，叙事推着点击走）；首站保留点击教学，星云站不在此列——落幕即 intro 接管 */
export const DEMO_STATION_HINTS: Partial<Record<ShapeId, string>> = {
  'demo-gramophone': '点一下，让声音继续进化',
  'demo-cassette': '后来，它装进了口袋',
  'demo-headphones': '再后来，它只属于你',
  'demo-mic': '现在，轮到你发声',
}

export class OnboardingDemoScript {
  private index = 0

  constructor(private stations: readonly ShapeId[] = DEMO_STATIONS) {
    if (stations.length === 0) throw new Error('剧本至少一站')
  }

  get currentShape(): ShapeId {
    return this.stations[this.index]
  }

  get atEnd(): boolean {
    return this.index === this.stations.length - 1
  }

  /** 推进一站，返回新站形体；已在终点返回 null（点击接线据此忽略多余点击） */
  advance(): ShapeId | null {
    if (this.atEnd) return null
    this.index++
    return this.currentShape
  }

  skipToEnd(): ShapeId {
    this.index = this.stations.length - 1
    return this.currentShape
  }
}

export interface DemoPlayback {
  stop: () => void
}

/** demo trace 循环泵进 bus（trace-controls 回放同款节拍钳 0.1s）；
 * trace 空/坏 → null，调用方据此整体跳过序幕 */
export function runDemoPlayback(traceJsonl: string, publish: (s: Signals) => void): DemoPlayback | null {
  const player = new TracePlayer(traceJsonl)
  if (player.duration <= 0) return null
  let rafId = 0
  let stopped = false
  let last = performance.now()
  const tick = (now: number): void => {
    if (stopped) return
    player.step(Math.min((now - last) / 1000, 0.1), publish)
    last = now
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
  return {
    stop: () => {
      stopped = true
      cancelAnimationFrame(rafId)
    }
  }
}
