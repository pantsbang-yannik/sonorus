import { describe, it, expect } from 'vitest'
import { EnergyTracker } from '../../src/engine/energy'

const SR = 48000, HOP = 1024
const hopSec = HOP / SR
const hopsPerSec = 1 / hopSec

function run(tracker: EnergyTracker, specLoud: number, rms: number, seconds: number, startT: number) {
  const results: Array<{ energy: number; drop: boolean; silence: boolean }> = []
  const n = Math.round(seconds * hopsPerSec)
  for (let i = 0; i < n; i++) results.push(tracker.push(specLoud, rms, startT + i * hopSec))
  return { results, endT: startT + n * hopSec }
}

describe('EnergyTracker v2（specLoud 驱动 energy，rms 只驱动 silence）', () => {
  it('恒定输入长时间维持 → energy 钳制在 0（峰谷完全贴合，无持续变化时无法判高低）', () => {
    const tr = new EnergyTracker(SR, HOP)
    const { results } = run(tr, 0.5, 0.5, 60, 0)
    expect(results.at(-1)!.energy).toBe(0)
  })

  it('阶跃×2（低→高→低→高）→ 两次都恰当上冲，不是偶然一次', () => {
    const tr = new EnergyTracker(SR, HOP)
    const a1 = run(tr, 0.05, 0.05, 15, 0) // 主歌 1：低位铺垫，先让峰谷贴合
    const c1 = run(tr, 0.5, 0.5, 5, a1.endT) // 副歌 1：阶跃上冲
    const a2 = run(tr, 0.05, 0.05, 15, c1.endT) // 主歌 2：回落
    const c2 = run(tr, 0.5, 0.5, 5, a2.endT) // 副歌 2：再次阶跃上冲
    expect(c1.results.at(-1)!.energy).toBeGreaterThan(a1.results.at(-1)!.energy)
    expect(c1.results.at(-1)!.energy).toBeGreaterThan(0.7)
    expect(c2.results.at(-1)!.energy).toBeGreaterThan(a2.results.at(-1)!.energy)
    expect(c2.results.at(-1)!.energy).toBeGreaterThan(0.7)
  })

  it('冷启动免疫窗口内（前 5s）阶跃上冲不触发 drop，即便爬升率达标', () => {
    const tr = new EnergyTracker(SR, HOP)
    const a = run(tr, 0.05, 0.05, 2, 0) // 主歌铺垫（仍在 5s 免疫窗内）
    const b = run(tr, 0.5, 0.5, 2, a.endT) // 阶跃上冲，但 elapsed 仍 <5s
    const drops = [...a.results, ...b.results].filter((r) => r.drop).length
    expect(drops).toBe(0)
  })

  it('免疫窗口过后，低位铺垫→阶跃上冲触发 drop', () => {
    const tr = new EnergyTracker(SR, HOP)
    const a = run(tr, 0.05, 0.05, 15, 0) // 主歌：低位铺垫到 5s 免疫窗之后，顺带让峰谷稳定
    const b = run(tr, 0.5, 0.5, 3, a.endT) // 副歌：阶跃上冲
    const drops = b.results.filter((r) => r.drop).length
    expect(drops).toBeGreaterThan(0)
  })

  it('drop 触发后 12s 冷却内不重复触发（沿用旧实现的 cooldown）', () => {
    const tr = new EnergyTracker(SR, HOP)
    let t = 0
    const dropTimes: number[] = []
    const step = (specLoud: number, seconds: number) => {
      const n = Math.round(seconds * hopsPerSec)
      for (let i = 0; i < n; i++) {
        const r = tr.push(specLoud, specLoud, t)
        if (r.drop) dropTimes.push(t)
        t += hopSec
      }
    }
    step(0.05, 15) // 低位铺垫，越过 5s 免疫窗
    step(0.5, 2) // 第一次阶跃上冲：触发 drop
    step(0.05, 2) // 短暂回落
    step(0.5, 2) // 3s 内第二次阶跃上冲：爬升/energy 条件仍满足，但应被 12s 冷却挡住
    expect(dropTimes.length).toBeGreaterThan(0)
    for (let i = 1; i < dropTimes.length; i++) {
      expect(dropTimes[i] - dropTimes[i - 1]).toBeGreaterThan(12)
    }
  })

  it('持续低位铺垫（峰谷完全贴合）不产生 drop：无爬升就无爆发', () => {
    const tr = new EnergyTracker(SR, HOP)
    const { results } = run(tr, 0.5, 0.5, 30, 0)
    expect(results.filter((r) => r.drop).length).toBe(0)
  })

  it('持续静音 2s 后进入 silence，有声后退出（rms 绝对阈值路径不回归）', () => {
    const tr = new EnergyTracker(SR, HOP)
    const a = run(tr, 0.0001, 0.0001, 3, 0)
    expect(a.results.at(-1)!.silence).toBe(true)
    const b = run(tr, 0.2, 0.2, 1, a.endT)
    expect(b.results.at(-1)!.silence).toBe(false)
  })

  it('冷启动：前 1.5s 内 energy 全部 ≤ 0.5（seed 期不许瞎跳，门槛修订后的数值稳定期）', () => {
    const tr = new EnergyTracker(SR, HOP)
    const { results } = run(tr, 0.8, 0.8, 1.5, 0)
    for (const r of results) expect(r.energy).toBeLessThanOrEqual(0.5)
  })

  it('迟滞带内毛刺不触发 silence（判定吃 0.3s 平滑 rms，不吃裸 rms）', () => {
    const tr = new EnergyTracker(SR, HOP)
    // 极安静段落：先在迟滞带中央（0.002）稳住平滑值
    const warm = run(tr, 0.002, 0.002, 1, 0)
    // 单帧毛刺跌破下阈（裸 rms 判定会在此启动 silence 计时）→ 3s 停在迟滞带内（裸判定不重置计时）
    // → 再来一帧毛刺（裸判定此刻累计 >2s 误触 silent）。平滑值几乎没被单帧毛刺拉动（每帧只走 ~7%），
    // 全程不跌破下阈 0.001 → 不触发
    tr.push(0.002, 0.0005, warm.endT)
    const mid = run(tr, 0.002, 0.002, 3, warm.endT + hopSec)
    const spike2 = tr.push(0.002, 0.0005, mid.endT)
    expect(spike2.silence).toBe(false)
  })
})
