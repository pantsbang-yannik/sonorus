import { describe, it, expect } from 'vitest'
import { sanitizeLyricsSettings, DEFAULT_LYRICS_SETTINGS } from '../../src/scenes/nebula/lyrics/lyrics-fx'
import {
  LyricsFxProgram, LYRICS_GATHER_SEC, LYRICS_MORPH_SEC, LYRICS_DISSOLVE_SEC,
  LYRICS_LONG_HOLD_SEC, LYRICS_PREROLL_SEC, LYRICS_HOLD_MAX_SEC
} from '../../src/scenes/nebula/lyrics/lyrics-fx'

describe('sanitizeLyricsSettings', () => {
  it('合法输入原样通过', () => {
    expect(sanitizeLyricsSettings({
      enabled: false, position: -1.35, scale: 1.4, dynamics: false, brightness: 0.6, dynamicsGain: 1.5
    })).toEqual({ enabled: false, position: -1.35, scale: 1.4, dynamics: false, brightness: 0.6, dynamicsGain: 1.5 })
  })
  it('position 非法/缺失回默认 −2（发布准备③ 用户复调：贴底）', () => {
    expect(sanitizeLyricsSettings({ position: 'left' }).position).toBe(DEFAULT_LYRICS_SETTINGS.position)
    expect(sanitizeLyricsSettings({ enabled: true }).position).toBe(DEFAULT_LYRICS_SETTINGS.position)
  })
  it('缺失/非对象/非法字段回退默认', () => {
    expect(sanitizeLyricsSettings(undefined)).toEqual(DEFAULT_LYRICS_SETTINGS)
    expect(sanitizeLyricsSettings({ enabled: 'yes', scale: 'big', dynamics: 0, brightness: NaN }))
      .toEqual(DEFAULT_LYRICS_SETTINGS)
  })
  it('数值钳位：scale [0.5,2]、brightness [0.3,2]', () => {
    const s = sanitizeLyricsSettings({ scale: 99, brightness: 0.01 })
    expect(s.scale).toBe(2)
    expect(s.brightness).toBe(0.3)
  })

  it('position 数值化迁移（歌词位置滑块）：旧三档映射、钳位、非法回默认 −2', () => {
    expect(sanitizeLyricsSettings({ position: 'top' }).position).toBe(1.35)
    expect(sanitizeLyricsSettings({ position: 'bottom' }).position).toBe(-1.35)
    expect(sanitizeLyricsSettings({ position: -3 }).position).toBe(-2)
    expect(sanitizeLyricsSettings({ position: 'left' }).position).toBe(-2)
    expect(sanitizeLyricsSettings({}).position).toBe(-2)
  })

  describe('dynamicsGain（亲验 fb1-D：动态强度滑杆，量程 [0,2] 默认随 DEFAULT_LYRICS_SETTINGS）', () => {
    it('缺失回默认（旧存档天然满足）', () => {
      expect(sanitizeLyricsSettings({}).dynamicsGain).toBe(DEFAULT_LYRICS_SETTINGS.dynamicsGain)
    })
    it('非法类型回默认', () => {
      expect(sanitizeLyricsSettings({ dynamicsGain: 'high' }).dynamicsGain).toBe(DEFAULT_LYRICS_SETTINGS.dynamicsGain)
      expect(sanitizeLyricsSettings({ dynamicsGain: NaN }).dynamicsGain).toBe(DEFAULT_LYRICS_SETTINGS.dynamicsGain)
    })
    it('出界钳位：超上限回 2，负数回 0', () => {
      expect(sanitizeLyricsSettings({ dynamicsGain: 5 }).dynamicsGain).toBe(2)
      expect(sanitizeLyricsSettings({ dynamicsGain: -1 }).dynamicsGain).toBe(0)
    })
  })
})

/** 三句标准词：0-10 / 10-20 / 20-∞ */
const LINES = [
  { t: 0, text: '第一句' },
  { t: 10, text: '第二句' },
  { t: 20, text: '第三句' }
]
/** 步进 helper：以 0.1s 粒度推进 sec 秒，返回最后一帧 */
function run(p: LyricsFxProgram, sec: number, pos: () => number, busy = false) {
  let f = p.update(0, pos(), busy)
  for (let i = 0; i < Math.round(sec / 0.1); i++) f = p.update(0.1, pos(), busy)
  return f
}

describe('LyricsFxProgram', () => {
  it('进场：有词有进度且歌名空闲 → gather spawn 当前句到槽0，聚拢完成 show', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    const f0 = p.update(0.016, 5, false)
    expect(f0.phase).toBe('gather')
    expect(f0.spawn).toEqual({ text: '第一句', slot: 0 })
    expect(f0.spread).toBe(1)
    const f1 = run(p, LYRICS_GATHER_SEC + 0.2, () => 5)
    expect(f1.phase).toBe('show')
    expect(f1.spread).toBe(0)
    expect(f1.fade).toBe(1)
    expect(f1.mix).toBe(0)
  })
  it('句切换：position 进入下一句 → morph spawn 对面槽，mix 0→1，完成后回 show', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    let pos = 5
    run(p, 2, () => pos)
    pos = 10.5
    const f = p.update(0.016, pos, false)
    expect(f.phase).toBe('morph')
    expect(f.spawn).toEqual({ text: '第二句', slot: 1 })
    const done = run(p, LYRICS_MORPH_SEC + 0.2, () => pos)
    expect(done.phase).toBe('show')
    expect(done.mix).toBe(1)
    // 再切第三句：写回槽0，mix 1→0（乒乓）
    pos = 21
    const f2 = p.update(0.016, pos, false)
    expect(f2.spawn).toEqual({ text: '第三句', slot: 0 })
    const done2 = run(p, LYRICS_MORPH_SEC + 0.2, () => pos)
    expect(done2.mix).toBe(0)
  })
  it('密句跳过：句窗 < 1.6s 的句不成为目标（保持上一句），下一正常句照常 morph', () => {
    const p = new LyricsFxProgram()
    p.setDoc([{ t: 0, text: 'A' }, { t: 10, text: '密' }, { t: 11, text: 'B' }])
    let pos = 5
    run(p, 2, () => pos)
    pos = 10.5 // 落在密句窗（1s < 1.6s）
    expect(p.update(0.016, pos, false).phase).toBe('show') // 不 morph
    pos = 11.5
    expect(p.update(0.016, pos, false).spawn!.text).toBe('B')
  })
  it('长间奏散场（fb 收严）：句窗 30s 驻留 4s 仍不散（未到 60% 驻留线），过 15s 上限才散；下一句起点前 0.8s 预聚重进', () => {
    const p = new LyricsFxProgram()
    p.setDoc([{ t: 0, text: 'A' }, { t: 30, text: 'B' }]) // A 句窗 30s：驻留线 = min(30×0.6, 15) = 15s
    let pos = 1
    run(p, 2, () => pos)
    pos = LYRICS_LONG_HOLD_SEC + 1.2 // 旧规则会在这里散场——收严后必须仍在展示
    expect(p.update(0.016, pos, false).phase).toBe('show')
    pos = LYRICS_HOLD_MAX_SEC + 0.2 // 过 15s 驻留上限 → 间奏散场
    const f = p.update(0.016, pos, false)
    expect(f.phase).toBe('dissolve')
    const idle = run(p, LYRICS_DISSOLVE_SEC + 0.2, () => pos)
    expect(idle.phase).toBe('idle')
    // 散场后同句不复拼
    expect(p.update(0.016, pos + 1, false).phase).toBe('idle')
    // 下一句临近 → 预聚
    pos = 30 - LYRICS_PREROLL_SEC + 0.1
    const g = p.update(0.016, pos, false)
    expect(g.phase).toBe('gather')
    expect(g.spawn!.text).toBe('B')
  })
  it('慢歌长句不误伤（亲验 fb 回归锚）：句窗 7.5s 的演唱句全程展示到 morph，不中途散场', () => {
    // 实锤场景=《好想爱这个世界啊》主歌：句窗 7.5~11.5s 全是唱满的句子，旧规则(>6s+4s)唱到一半消失
    const p = new LyricsFxProgram()
    p.setDoc([{ t: 0, text: '我想说 却在开口的时候变沉默' }, { t: 7.5, text: '这世界 又神秘又赤裸' }, { t: 15, text: 'C' }])
    let pos = 0.5
    run(p, 2, () => pos)
    for (const at of [4.5, 6.0, 7.0]) { // 旧规则 4s 后任意时刻都已散场
      pos = at
      expect(p.update(0.016, pos, false).phase).toBe('show')
    }
    pos = 7.6 // 跨句 → 直接 morph（中间没有 dissolve 断档）
    expect(p.update(0.016, pos, false).phase).toBe('morph')
  })
  it('中长句按比例驻留（锁 FRAC=0.6）：句窗 20s 驻留线=12s（未触 15s 上限），11.9s 仍展示、12.1s 散场', () => {
    const p = new LyricsFxProgram()
    p.setDoc([{ t: 0, text: 'A' }, { t: 20, text: 'B' }]) // min(20×0.6, 15) = 12 —— FRAC 门生效区间
    let pos = 0.5
    run(p, 2, () => pos)
    pos = 11.9
    expect(p.update(0.016, pos, false).phase).toBe('show')
    pos = 12.1
    expect(p.update(0.016, pos, false).phase).toBe('dissolve')
  })
  it('末句 ∞ 句窗靠驻留上限兜底：15s 后散场，不永久悬挂', () => {
    const p = new LyricsFxProgram()
    p.setDoc([{ t: 0, text: 'A' }, { t: 10, text: '末句' }])
    let pos = 10.1
    run(p, 2, () => pos) // 末句进场
    pos = 10 + LYRICS_HOLD_MAX_SEC - 0.5 // 驻留未满上限 → 仍展示
    expect(p.update(0.016, pos, false).phase).toBe('show')
    pos = 10 + LYRICS_HOLD_MAX_SEC + 0.2
    expect(p.update(0.016, pos, false).phase).toBe('dissolve')
  })
  it('歌名互斥：titleBusy 中在场即散且不进场；释放后当前句重新 gather', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    expect(p.update(0.016, 5, true).phase).toBe('dissolve')
    run(p, LYRICS_DISSOLVE_SEC + 0.2, () => 5, true)
    expect(p.update(0.016, 5, true).phase).toBe('idle')
    expect(p.update(0.016, 6, false).phase).toBe('gather') // 释放 → 同句重进场
  })
  it('seek：position 跳变直接 morph 到目标句（含回跳）', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 15) // show 第二句
    const f = p.update(0.016, 25, false) // 前跳
    expect(f.spawn!.text).toBe('第三句')
    run(p, LYRICS_MORPH_SEC + 0.2, () => 25)
    const b = p.update(0.016, 3, false) // 回跳
    expect(b.spawn!.text).toBe('第一句')
  })
  it('无进度/清词：在场即散；setDoc(null) 后 hasDoc false', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    expect(p.update(0.016, null, false).phase).toBe('dissolve')
    p.setDoc(null)
    expect(p.hasDoc()).toBe(false)
  })
  it('cancel：spawn 后渲染失败回 idle 且坏句不重试，下一句照常', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    p.update(0.016, 5, false) // gather spawn 第一句
    p.cancel()
    expect(p.update(0.016, 6, false).phase).toBe('idle') // 同句不重试
    const f = p.update(0.016, 11, false)
    expect(f.spawn!.text).toBe('第二句') // 下一句正常
  })
  it('gather 半途被打断（morph 目标变化走完再切）不产生 uniform 跳变：spread/fade 单帧变化有界', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    let prev = p.update(0.016, 5, false)
    for (let i = 0; i < 40; i++) {
      const f = p.update(0.1, 5 + i * 0.5, false)
      expect(Math.abs(f.spread - prev.spread)).toBeLessThan(0.5)
      expect(Math.abs(f.fade - prev.fade)).toBeLessThan(0.5)
      prev = f
    }
  })
})

describe('LyricsFxProgram 批2：对拍 morph（drop 冲散已退役，见下方注释）', () => {
  /** 带 opts 的步进：以 0.1s 粒度推进 */
  function runOpts(p: LyricsFxProgram, sec: number, pos: () => number, opts: () => { nextBeatIn: number | null }) {
    let f = p.update(0, pos(), false, opts())
    for (let i = 0; i < Math.round(sec / 0.1); i++) f = p.update(0.1, pos(), false, opts())
    return f
  }
  const NO_BEAT = () => ({ nextBeatIn: null })

  it('对拍：nextBeatIn=0.3 时跨句 → 等 0.3s 才 morph spawn；等待期间保持 show', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5) // 进场到 show
    // 跨句帧：nextBeatIn=0.3 → 设 morphHold=0.3，本帧不 morph（设定帧不倒计时）
    let f = p.update(0.1, 11, false, { nextBeatIn: 0.3 })
    expect(f.phase).toBe('show')
    expect(f.spawn).toBeNull()
    // 等待中 nextBeatIn 不再重估——morphHold 自行倒计时：0.3 − 0.1 = 0.2 剩
    f = p.update(0.1, 11, false, { nextBeatIn: 0.2 })
    expect(f.phase).toBe('show')
    // 0.2 − 0.25 < 0 → 拍点到，起跳
    f = p.update(0.25, 11, false, { nextBeatIn: 0.05 })
    expect(f.phase).toBe('morph')
    expect(f.spawn).toEqual({ text: '第二句', slot: 1 })
  })

  it('对拍上限：nextBeatIn=0.6（>0.4）→ 立即 morph', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    const f = p.update(0.1, 11, false, { nextBeatIn: 0.6 })
    expect(f.phase).toBe('morph')
  })

  it('对拍等待中目标再变：起跳用最新目标句', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    p.update(0.1, 11, false, { nextBeatIn: 0.35 })
    // 等待期内 seek 到第三句
    const f = runOpts(p, 0.4, () => 25, NO_BEAT)
    expect(['morph', 'show']).toContain(f.phase)
    // morph 完成后展示的是第三句（槽1）——从 mix 终值验证
    const done = runOpts(p, 1, () => 25, NO_BEAT)
    expect(done.phase).toBe('show')
    expect(done.mix).toBe(1)
  })

  it('对拍等待中被 blocked：散场且等待取消，重进正常', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    p.update(0.1, 11, false, { nextBeatIn: 0.35 })
    let f = p.update(0.1, 11, true, { nextBeatIn: 0.25 }) // 歌名抢位
    expect(f.phase).toBe('dissolve')
    f = runOpts(p, LYRICS_DISSOLVE_SEC + 0.3, () => 11, NO_BEAT)
    f = runOpts(p, LYRICS_GATHER_SEC + 0.3, () => 11, NO_BEAT)
    expect(f.phase).toBe('show')
  })

  // drop 冲散已改道节奏层（fb4 碎散聚）：杀句用例退役，见 lyrics-rhythm.test.ts 碎散聚 describe

  it('opts 缺省=批1 行为：跨句立即 morph（回归锚）', () => {
    const p = new LyricsFxProgram()
    p.setDoc(LINES)
    run(p, 2, () => 5)
    const f = p.update(0.1, 11, false)
    expect(f.phase).toBe('morph')
  })
})
