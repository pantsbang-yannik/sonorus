// 回放口径：energy/drop/silence 经当前 EnergyTracker 重算（与 calibration-drop 同款回放口径）——
// fixture 烤死的 dr/e/si 字段是录制时旧判据的产物，不作输入；bands 是原始特征、可信。
import { describe, it, expect } from 'vitest'
import { EnergyTracker } from '../../src/engine/energy'
import { NarrativeTracker, type NarrativePhase } from '../../src/engine/narrative'
import { loadTrace, TRACE_FIXTURES, specLoudOf } from './helpers/load-trace'

const SR = 48000
const HOP = 1024

interface Segment { phase: NarrativePhase; from: number; to: number }

/** 整曲回放：bands→EnergyTracker 重算 energy/drop/silence→喂 NarrativeTracker，
 *  测的是 EnergyTracker 下游的叙事裁决（判据链与真机 processHop 同源） */
function replay(path: string): { segments: Segment[]; dropTimes: number[]; duration: number } {
  const rows = loadTrace(path)
  const energyTracker = new EnergyTracker(SR, HOP)
  const tracker = new NarrativeTracker()
  const t0 = rows[0].t
  let prev = rows[0].t
  const dropTimes: number[] = []
  const segments: Segment[] = []
  for (const r of rows) {
    const dt = Math.max(r.t - prev, 1e-4)
    prev = r.t
    const specLoud = specLoudOf(r.bands)
    const { energy, drop, silence } = energyTracker.push(specLoud, specLoud, r.t)
    if (drop) dropTimes.push(r.t - t0)
    const { phase } = tracker.update(dt, { energy, drop, silence })
    const last = segments.at(-1)
    if (!last || last.phase !== phase) segments.push({ phase, from: r.t - t0, to: r.t - t0 })
    else last.to = r.t - t0
  }
  return { segments, dropTimes, duration: (rows.at(-1)!.t - t0) }
}

describe('叙事 4 态校准门槛（三首真歌回放；硬线不许因过不了而放宽，先调 Tracker 常量）', () => {
  for (const fixture of TRACE_FIXTURES) {
    it(`${fixture.name}：冷启动 steady / burst 与 drop 一一对应 / 无抖动 / steady 占比合理`, () => {
      const { segments, dropTimes, duration } = replay(fixture.path)
      // 叙事时间线：亲验词汇表的对照锚——用户拿它对歌曲时间轴（"51s 该蓄力了吗"）
      console.log(`\n[叙事校准] ${fixture.name}`,
        JSON.stringify(segments.map(s => `${s.phase} ${s.from.toFixed(1)}→${s.to.toFixed(1)}s`), null, 2))

      // ① 冷启动免疫：开场首段是 steady 且至少覆盖前 4.5s
      expect(segments[0].phase).toBe('steady')
      expect(segments[0].to).toBeGreaterThanOrEqual(4.5)
      // ② 每个 drop 都进爆发：burst 段数 === drop 数（cooldown 12s 保证不会合并）
      const bursts = segments.filter(s => s.phase === 'burst')
      expect(bursts.length).toBe(dropTimes.length)
      // ③ 无抖动：所有段驻留 ≥0.45s——例外：被 burst 掐断的前一段（鼓不等人）与歌曲收尾的最后一段
      for (let i = 0; i < segments.length - 1; i++) {
        const cut = segments[i + 1]?.phase === 'burst'
        if (!cut) expect(segments[i].to - segments[i].from).toBeGreaterThanOrEqual(0.45)
      }
      // ④ steady 占比 ≥25%：常态是底色，不能全曲都在特殊状态里
      const steadySec = segments.filter(s => s.phase === 'steady').reduce((a, s) => a + (s.to - s.from), 0)
      expect(steadySec / duration).toBeGreaterThanOrEqual(0.25)
    })
  }

  it('三首合计：build 段 ≥2（真歌必有酝酿），且 ≥50% 的 burst 前 8s 内出现过 build（预期感）', () => {
    let buildTotal = 0, burstTotal = 0, preceded = 0
    for (const fixture of TRACE_FIXTURES) {
      const { segments } = replay(fixture.path)
      buildTotal += segments.filter(s => s.phase === 'build').length
      for (const b of segments.filter(s => s.phase === 'burst')) {
        burstTotal++
        if (segments.some(s => s.phase === 'build' && s.to <= b.from && s.to >= b.from - 8)) preceded++
      }
    }
    console.log(`\n[叙事校准] build 总数=${buildTotal} burst 总数=${burstTotal} 蓄力前置率=${burstTotal ? (preceded / burstTotal).toFixed(2) : 'n/a'}`)
    expect(buildTotal).toBeGreaterThanOrEqual(2)
    if (burstTotal > 0) expect(preceded / burstTotal).toBeGreaterThanOrEqual(0.5)
  })
})
