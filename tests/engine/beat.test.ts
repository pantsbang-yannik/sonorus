import { describe, it, expect } from 'vitest'
import { BeatDetector } from '../../src/engine/beat'

const SR = 48000, HOP = 1024
const hopSec = HOP / SR
const BINS = 512
// binHz ≈ 46.9：kick 通道吃 bins[1..4)（30-200Hz），snare 通道吃 bins[21..107)（1k-5kHz）
const KICK_BINS = [1, 2, 3]
const SNARE_BINS = Array.from({ length: 86 }, (_, i) => 21 + i)

/** 合成一帧谱：指定 bin 集合放能量，其余为底噪 */
function frame(bins: number[], amp: number, base = 0.02): Float32Array {
  const sp = new Float32Array(BINS).fill(base)
  for (const b of bins) sp[b] = amp
  return sp
}

/** 逐帧喂入探测器，返回每帧结果 */
function run(det: BeatDetector, frames: Float32Array[]): { onBeat: boolean; strength: number }[] {
  return frames.map((sp, i) => det.push(sp, (i + 1) * hopSec))
}

/** kick 通道周期脉冲序列：periodSec 一拍，单帧尖峰 */
function kickPulses(seconds: number, periodSec: number, amp = 5): Float32Array[] {
  const frames: Float32Array[] = []
  let nextBeat = 0
  for (let t = 0; t < seconds; t += hopSec) {
    const hit = t >= nextBeat
    if (hit) nextBeat += periodSec
    frames.push(frame(KICK_BINS, hit ? amp : 0.02))
  }
  return frames
}

describe('BeatDetector v2', () => {
  it('120BPM kick 脉冲 → 阈值热身后逐拍命中，bpm≈120', () => {
    const det = new BeatDetector(SR, HOP)
    const results = run(det, kickPulses(12, 0.5))
    const beats = results.filter((r) => r.onBeat).length
    // 12s 理论 24 拍，前 ~2.5s 阈值热身允许漏
    expect(beats).toBeGreaterThanOrEqual(17)
    expect(beats).toBeLessThanOrEqual(24)
    expect(det.bpm).not.toBeNull()
    expect(det.bpm!).toBeGreaterThan(114)
    expect(det.bpm!).toBeLessThan(126)
  })

  it('恒定谱 → 零误触（flux 恒为 0，不应从底噪里造拍）', () => {
    const det = new BeatDetector(SR, HOP)
    const frames = Array.from({ length: 400 }, () => frame(KICK_BINS.concat(SNARE_BINS), 0.5))
    const beats = run(det, frames).filter((r) => r.onBeat).length
    expect(beats).toBe(0)
  })

  it('flux 持续跨阈值多帧（线性爬升斜坡）只在上升沿触发一次', () => {
    const det = new BeatDetector(SR, HOP)
    const frames: Float32Array[] = []
    // 3s 底噪热身 + 1s 线性爬升：帧间差恒为正 → flux 持续在阈上、横跨多个不应期周期
    // （恒定平台构造不判别：平台期帧间差为 0，flux 自然归零，与上升沿逻辑无关）
    for (let t = 0; t < 3; t += hopSec) frames.push(frame(KICK_BINS, 0.02))
    const rampFrames = Math.round(1 / hopSec)
    for (let i = 1; i <= rampFrames; i++) {
      frames.push(frame(KICK_BINS, 0.02 + (5 - 0.02) * (i / rampFrames)))
    }
    const beats = run(det, frames).filter((r) => r.onBeat).length
    expect(beats).toBe(1) // 只有斜坡首帧上穿；禁用上升沿则每过不应期重触发（实测 4 次）
  })

  it('双通道独立：纯 snare 脉冲能出 onBeat，但 bpm 只吃 kick 保持 null', () => {
    const det = new BeatDetector(SR, HOP)
    const frames: Float32Array[] = []
    let nextBeat = 0
    for (let t = 0; t < 12; t += hopSec) {
      const hit = t >= nextBeat
      if (hit) nextBeat += 0.5
      frames.push(frame(SNARE_BINS, hit ? 3 : 0.02))
    }
    const beats = run(det, frames).filter((r) => r.onBeat).length
    expect(beats).toBeGreaterThanOrEqual(10) // snare 通道独立触发
    expect(det.bpm).toBeNull() // kick 无 onset，军鼓不进 IOI
  })

  it('力度 tie 排名：3 倍振幅的爆点 strength 显著高于普通拍（等响普通拍并列收敛到中位）', () => {
    const det = new BeatDetector(SR, HOP)
    const frames: Float32Array[] = []
    let nextBeat = 0, beatIdx = 0
    for (let t = 0; t < 16; t += hopSec) {
      const hit = t >= nextBeat
      let amp = 0.02
      if (hit) {
        nextBeat += 0.5
        amp = beatIdx % 4 === 3 ? 15 : 5 // 每第 4 拍爆一次
        beatIdx++
      }
      frames.push(frame(KICK_BINS, amp))
    }
    const results = run(det, frames)
    const strengths = results.filter((r) => r.onBeat).map((r) => r.strength)
    // 后半段（分位窗已填充）：爆点应贴近 1，普通拍应明显更低
    const settled = strengths.slice(Math.floor(strengths.length / 2))
    expect(Math.max(...settled)).toBeGreaterThanOrEqual(0.75)
    expect(Math.max(...settled) - Math.min(...settled)).toBeGreaterThanOrEqual(0.4) // 对比度是意图本体
    expect(Math.min(...settled)).toBeLessThanOrEqual(0.45) // 等响拍并列中位（tie 语义，旧线 0.3 编码旧公式）
  })
})
