import { describe, it, expect } from 'vitest'
import { NarrativeTracker, type NarrativePhase } from '../../src/engine/narrative'

const DT = 1 / 60

/** 喂 sec 秒恒定输入 */
function feed(tr: NarrativeTracker, sec: number, energy: number, over: { drop?: boolean; silence?: boolean } = {}): NarrativePhase {
  let phase: NarrativePhase = 'steady'
  for (let i = 0; i < Math.round(sec * 60); i++) {
    phase = tr.update(DT, { energy, drop: over.drop ?? false, silence: over.silence ?? false }).phase
  }
  return phase
}

/** 线性 ramp fromE→toE 经 sec 秒 */
function ramp(tr: TrackerLike, sec: number, fromE: number, toE: number): NarrativePhase[] {
  const n = Math.round(sec * 60)
  const seen: NarrativePhase[] = []
  for (let i = 0; i < n; i++) {
    const e = fromE + (toE - fromE) * (i / (n - 1))
    seen.push(tr.update(DT, { energy: e, drop: false, silence: false }).phase)
  }
  return seen
}
type TrackerLike = NarrativeTracker

describe('NarrativeTracker 叙事 4 态（Phase C spec §3：唯一真状态机）', () => {
  it('冷启动 5s 内恒 steady（免疫窗口与 EnergyTracker drop 同宽）', () => {
    const tr = new NarrativeTracker()
    // 冷启动期内即使猛爬升也不讲叙事
    const phases = ramp(tr, 4.5, 0.1, 0.9)
    expect(new Set(phases)).toEqual(new Set(['steady']))
  })

  it('平稳能量 → 恒 steady，progress=0', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.5)
    expect(feed(tr, 4, 0.5)).toBe('steady')
    expect(tr.state.progress).toBe(0)
  })

  it('能量爬升（0.3→0.8 / 2s）→ build，progress 随爬升幅度增长', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.3)
    const phases = ramp(tr, 2, 0.3, 0.8)
    expect(phases).toContain('build')
    expect(phases.at(-1)).toBe('build') // 爬升途中一直蓄力
    expect(tr.state.progress).toBeGreaterThan(0.5) // 3s 窗口内爬了 ~0.5 ≫ span 0.25
  })

  it('drop 帧 → 立即 burst（不受驻留防抖限制），持续 ~2.5s 后离场', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.3)
    ramp(tr, 2, 0.3, 0.8) // 蓄力中
    const s = tr.update(DT, { energy: 0.85, drop: true, silence: false })
    expect(s.phase).toBe('burst') // 鼓不等人：build→burst 无驻留门
    expect(s.progress).toBeGreaterThan(0.9) // 剩余强度起步 ≈1
    expect(feed(tr, 2.2, 0.85)).toBe('burst') // 2.2s 后仍在演出窗口
    // 再喂 1.5s 平高能量：窗口结束+3s 对照窗滑平（紧贴 2.5s 边界时窗内还留着爬升尾巴，会短暂判 build）
    expect(feed(tr, 1.5, 0.85)).toBe('steady') // 高原=常态，爆发不是永恒态
  })

  it('能量回落（0.8→0.3 / 2s）→ release；落定后回 steady', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.8)
    const phases = ramp(tr, 2, 0.8, 0.3)
    expect(phases).toContain('release')
    expect(feed(tr, 4, 0.3)).toBe('steady') // 3s 窗口滑过后回落条件消失
  })

  it('silence → steady（静默不讲叙事），即使能量数值仍在爬', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.3)
    let phase: NarrativePhase = 'steady'
    for (let i = 0; i < 120; i++) {
      const e = 0.3 + 0.5 * (i / 119)
      phase = tr.update(DT, { energy: e, drop: false, silence: true }).phase
    }
    expect(phase).toBe('steady')
  })

  it('防抖驻留：0.8s 周期正弦能量下，非 burst 切换间隔 ≥0.5s（8 态否决理由①的落地）', () => {
    const tr = new NarrativeTracker()
    feed(tr, 6, 0.5)
    const transitions: number[] = []
    let prev: NarrativePhase = tr.state.phase
    for (let i = 0; i < 600; i++) {
      const t = i * DT
      const e = 0.5 + 0.2 * Math.sin((2 * Math.PI * t) / 0.8)
      const { phase } = tr.update(DT, { energy: e, drop: false, silence: false })
      if (phase !== prev) { transitions.push(t); prev = phase }
    }
    for (let i = 1; i < transitions.length; i++) {
      expect(transitions[i] - transitions[i - 1]).toBeGreaterThanOrEqual(0.5 - 1e-6)
    }
  })
})
