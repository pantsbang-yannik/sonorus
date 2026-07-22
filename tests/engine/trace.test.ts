import { describe, it, expect } from 'vitest'
import { serializeSignal, deserializeSignal, TraceRecorder, TracePlayer } from '../../src/engine/trace'
import { SignalBus } from '../../src/engine/bus'
import type { Signals } from '../../src/engine/types'

function mkSignal(t: number, over: Partial<Signals> = {}): Signals {
  const spectrum = new Float32Array(512)
  for (let i = 0; i < 512; i++) spectrum[i] = (i / 512) * 0.8
  return {
    t, loudness: { instant: 0.5, smooth: 0.42 }, bands: { low: 0.3, mid: 0.2, high: 0.1 },
    spectrum, beat: { onBeat: true, strength: 0.7 }, bpm: 120,
    energy: 0.6, drop: false, silence: false, ...over
  }
}

describe('serialize/deserialize', () => {
  it('往返后标量字段无损、spectrum 误差 < 峰值/200', () => {
    const s = mkSignal(1.5)
    const back = deserializeSignal(serializeSignal(s))!
    expect(back.t).toBe(1.5)
    expect(back.loudness).toEqual(s.loudness)
    expect(back.bands).toEqual(s.bands)
    expect(back.beat).toEqual(s.beat)
    expect(back.bpm).toBe(120)
    expect(back.spectrum.length).toBe(512)
    const maxErr = Math.max(...Array.from(s.spectrum).map((v, i) => Math.abs(v - back.spectrum[i])))
    expect(maxErr).toBeLessThan(0.8 / 200)
  })
  it('坏行返回 null', () => {
    expect(deserializeSignal('not json')).toBeNull()
    expect(deserializeSignal('{"t":1}')).toBeNull()
  })
  it('版本戳：序列化带 v:1；未知版本拒收，无版本（历史 trace）宽进', () => {
    const line = serializeSignal(mkSignal(1))
    expect(JSON.parse(line).v).toBe(1)
    const future = JSON.stringify({ ...JSON.parse(line), v: 2 })
    expect(deserializeSignal(future)).toBeNull()
    const legacy = JSON.stringify((({ v, ...rest }) => rest)(JSON.parse(line)))
    expect(deserializeSignal(legacy)).not.toBeNull()
  })
})

describe('TraceRecorder', () => {
  it('订阅期间记录，stop 返回 JSONL 并退订', () => {
    const bus = new SignalBus()
    const rec = new TraceRecorder()
    rec.start(bus)
    bus.publish(mkSignal(0.1))
    bus.publish(mkSignal(0.2))
    expect(rec.count).toBe(2)
    const jsonl = rec.stop()
    expect(jsonl.trim().split('\n')).toHaveLength(2)
    bus.publish(mkSignal(0.3)) // stop 后不再记录
    expect(rec.count).toBe(0)
  })

  it('重复 start 幂等，不产生双份订阅', () => {
    const bus = new SignalBus()
    const rec = new TraceRecorder()
    rec.start(bus)
    rec.start(bus) // 第二次 start 应被忽略
    bus.publish(mkSignal(0.1))
    expect(rec.count).toBe(1)
  })
})

describe('TracePlayer', () => {
  it('按虚拟时钟到期发布，播完循环', () => {
    const lines = [mkSignal(0), mkSignal(0.1), mkSignal(0.2)].map(serializeSignal).join('\n')
    const player = new TracePlayer(lines)
    expect(player.duration).toBeCloseTo(0.2, 5)
    const got: number[] = []
    player.step(0.15, (s) => got.push(s.t))   // t=0 与 t=0.1 到期
    expect(got).toEqual([0, 0.1])
    player.step(0.1, (s) => got.push(s.t))    // t=0.2 到期后回卷
    expect(got).toContain(0.2)
    player.step(0.15, (s) => got.push(s.t))   // 循环第二圈的 t=0 应再次出现
    expect(got.filter((t) => t === 0).length).toBeGreaterThanOrEqual(2)
  })

  it('全坏行 JSONL：duration 为 0，step 不抛错、不发布', () => {
    const player = new TracePlayer('not json\n{"t":1}\ngarbage')
    expect(player.duration).toBe(0)
    const got: number[] = []
    expect(() => player.step(1, (s) => got.push(s.t))).not.toThrow()
    expect(got).toEqual([])
  })

  it('dt=0 连续 step：不推进虚拟时钟，仅首条 t=0 条目在第一次发布', () => {
    const lines = [mkSignal(0), mkSignal(0.1), mkSignal(0.2)].map(serializeSignal).join('\n')
    const player = new TracePlayer(lines)
    const got: number[] = []
    player.step(0, (s) => got.push(s.t)) // t=0 <= clock(0) 到期发布，符合实现语义
    expect(got).toEqual([0])
    player.step(0, (s) => got.push(s.t)) // 时钟未推进，t=0.1 未到期
    player.step(0, (s) => got.push(s.t))
    expect(got).toEqual([0]) // 后续 dt=0 不再发布任何条目
  })
})
