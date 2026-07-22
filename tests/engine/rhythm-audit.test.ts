// 【fb5 常驻回归防线：选拍随机性硬线（诊断审计 2026-07-14 转正）】
// 对三首真歌 trace 重放 BeatDetector + hybrid 力度合成，统计每个吃 beat 的视觉效果的门槛/冷却实际放行率，
// 以及「相邻两拍一个过线一个不过」的翻脸率（用户体感的嫌疑主犯）。
import { describe, it, expect } from 'vitest'
import { BeatDetector } from '../../src/engine/beat'
import { EnergyTracker } from '../../src/engine/energy'
import { hybridBeatStrength } from '../../src/engine/engine'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'

const SR = 48000
const HOP = 1024

describe('节奏审计（fb5 常驻）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name}：门槛/冷却放行率与相邻拍翻脸率`, () => {
      const rows = loadTrace(fixture.path)
      const det = new BeatDetector(SR, HOP)
      const tracker = new EnergyTracker(SR, HOP)
      const beats: Array<{ t: number; s: number }> = []
      for (const r of rows) {
        const b = det.push(r.spectrum, r.t)
        const specLoud = specLoudOf(r.bands)
        const { energy } = tracker.push(specLoud, specLoud, r.t)
        if (b.onBeat) beats.push({ t: r.t, s: hybridBeatStrength(b.strength, energy) })
      }
      const durMin = (rows[rows.length - 1].t - rows[0].t) / 60

      // 涟漪门：strength≥0.75 + 冷却 0.4s（并发上限忽略，独立统计冷却挡刀数）
      let rippleFired = 0, rippleBlockedByCooldown = 0, rippleBlockedByStrength = 0
      let rippleCd = -Infinity
      for (const b of beats) {
        if (b.s < 0.75) { rippleBlockedByStrength++; continue }
        if (b.t - rippleCd < 0.4) { rippleBlockedByCooldown++; continue }
        rippleFired++; rippleCd = b.t
      }

      // 歌词强拍冲散门（fb4）：strength≥0.75 + 不应期 max(period×0.9, 0.35)
      const bpm = det.bpm ?? 120
      const refractory = Math.max((60 / bpm) * 0.9, 0.35)
      let scatterFired = 0, scatterBlockedByRefractory = 0
      let scatterCd = -Infinity
      for (const b of beats) {
        if (b.s < 0.75) continue
        if (b.t - scatterCd < refractory) { scatterBlockedByRefractory++; continue }
        scatterFired++; scatterCd = b.t
      }

      // 镜头 drop 冲击门：kickStrength>0.6
      const camFired = beats.filter((b) => b.s > 0.6).length

      // 相邻拍翻脸率：相隔 ≤1.2s 的两拍，一个 ≥0.75 一个 <0.75（同段落同类鼓点不同命的代理指标）
      let flip = 0, adjacent = 0
      for (let i = 1; i < beats.length; i++) {
        if (beats[i].t - beats[i - 1].t > 1.2) continue
        adjacent++
        if ((beats[i].s >= 0.75) !== (beats[i - 1].s >= 0.75)) flip++
      }

      // 涟漪之间的最长干旱（用户盯着镜面时的「没反应」窗口）
      let maxGap = 0, lastFire = beats.length ? beats[0].t : 0
      let cd2 = -Infinity
      for (const b of beats) {
        if (b.s >= 0.75 && b.t - cd2 >= 0.4) {
          maxGap = Math.max(maxGap, b.t - lastFire); lastFire = b.t; cd2 = b.t
        }
      }

      console.log(`\n[审计] ${fixture.name}`, JSON.stringify({
        总拍数: beats.length,
        每分钟拍数: +(beats.length / durMin).toFixed(1),
        检出bpm: det.bpm,
        涟漪: {
          放行: rippleFired,
          放行率: +(rippleFired / beats.length).toFixed(3),
          被排名刷掉: rippleBlockedByStrength,
          被冷却刷掉: rippleBlockedByCooldown,
          最长干旱秒: +maxGap.toFixed(1),
        },
        歌词冲散: {
          放行: scatterFired,
          放行率: +(scatterFired / beats.length).toFixed(3),
          被不应期刷掉: scatterBlockedByRefractory,
        },
        镜头冲击放行率: +(camFired / beats.length).toFixed(3),
        相邻拍翻脸率: +(flip / Math.max(1, adjacent)).toFixed(3),
        相邻拍样本: adjacent,
      }, null, 2))
      expect(flip / Math.max(1, adjacent)).toBeLessThanOrEqual(0.15)          // 翻脸率（spec 硬线）
      expect(rippleFired / beats.length).toBeGreaterThanOrEqual(0.15)          // 涟漪放行率下限
      expect(rippleFired / beats.length).toBeLessThanOrEqual(0.45)             // 上限（稀疏郑重不丢）
    })
  }
})
