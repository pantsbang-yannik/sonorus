import { describe, it, expect } from 'vitest'
import {
  TitleFxProgram, TITLE_GATHER_SEC, TITLE_HOLD_SEC, TITLE_DISSOLVE_SEC,
  sanitizeTitleSettings, DEFAULT_TITLE_SETTINGS,
  snapToNodes, POSITION_SNAP_NODES, POS_Y_PRESET, POS_Y_MAX
} from '../../src/scenes/nebula/title-fx'
import { easeStandard, easeDrift } from '../../src/scenes/shared/motion'

const CHANGE = (title: string, artist = '歌手'): { kind: 'change'; title: string; artist: string; artworkDataUrl: string | null } =>
  ({ kind: 'change', title, artist, artworkDataUrl: null })

/** 步进 helper：以 60fps 推进 sec 秒，返回最后一帧 */
function run(fx: TitleFxProgram, sec: number) {
  let f = fx.update(0)
  const steps = Math.ceil(sec / (1 / 60))
  for (let i = 0; i < steps; i++) f = fx.update(1 / 60)
  return f
}

describe('TitleFxProgram', () => {
  it('新曲触发：spawn 一次并进 gather，spread 从 1 落向 0，随后 hold', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    const first = fx.update(1 / 60)
    expect(first.spawn).toEqual({ title: '晴天', artist: '歌手' })
    expect(first.phase).toBe('gather')
    const mid = run(fx, TITLE_GATHER_SEC / 2)
    expect(mid.spread).toBeGreaterThan(0)
    expect(mid.spread).toBeLessThan(1)
    const held = run(fx, TITLE_GATHER_SEC)
    expect(held.phase).toBe('hold')
    expect(held.spread).toBe(0)
    expect(held.fade).toBe(1)
  })

  it('同键补发不重触发（封面晚到场景）', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    run(fx, TITLE_GATHER_SEC + 1)
    fx.onTrack(CHANGE('晴天')) // 补发
    expect(fx.update(1 / 60).spawn).toBeNull()
  })

  it('驻留满时长后消散回 idle，fade 归 0', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    const f = run(fx, TITLE_GATHER_SEC + TITLE_HOLD_SEC + TITLE_DISSOLVE_SEC + 0.2)
    expect(f.phase).toBe('idle')
    expect(f.fade).toBe(0)
  })

  it('展示中切歌：立即转 dissolve，散完后 spawn 新曲（单槽保最新）', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    run(fx, TITLE_GATHER_SEC + 0.5) // hold 中
    fx.onTrack(CHANGE('七里香'))
    expect(fx.update(1 / 60).phase).toBe('dissolve')
    fx.onTrack(CHANGE('稻香')) // dissolve 中再切：覆盖 pending
    // 推到 dissolve 走完，收集期间的 spawn
    let spawned: string | null = null
    for (let i = 0; i < Math.ceil((TITLE_DISSOLVE_SEC + 0.2) * 60); i++) {
      const f = fx.update(1 / 60)
      if (f.spawn) spawned = f.spawn.title
    }
    expect(spawned).toBe('稻香')
  })

  it('unknown：展示中转 dissolve 且不再 spawn', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    run(fx, TITLE_GATHER_SEC + 0.5)
    fx.onTrack({ kind: 'unknown' })
    const f = fx.update(1 / 60)
    expect(f.phase).toBe('dissolve')
    const end = run(fx, TITLE_DISSOLVE_SEC + 0.2)
    expect(end.phase).toBe('idle')
  })

  it("setMode('off')：展示中立即消散，之后 onTrack 不触发；重开后新键才触发", () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    run(fx, TITLE_GATHER_SEC + 0.5)
    fx.setMode('off')
    expect(fx.update(1 / 60).phase).toBe('dissolve')
    run(fx, TITLE_DISSOLVE_SEC + 0.2)
    fx.onTrack(CHANGE('七里香'))
    expect(fx.update(1 / 60).spawn).toBeNull()
    fx.setMode('timed')
    fx.onTrack(CHANGE('七里香')) // 关闭期已记键：同键不触发
    expect(fx.update(1 / 60).spawn).toBeNull()
    fx.onTrack(CHANGE('稻香')) // 新键触发
    expect(fx.update(1 / 60).spawn).not.toBeNull()
  })

  it("常驻模式：驻留远超 5s 不消散；切歌仍先散旧再拼新", () => {
    const fx = new TitleFxProgram()
    fx.setMode('always')
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    const f = run(fx, TITLE_GATHER_SEC + TITLE_HOLD_SEC * 3) // 驻留 15s
    expect(f.phase).toBe('hold')
    expect(f.fade).toBe(1)
    fx.onTrack(CHANGE('七里香')) // 常驻中切歌：照常散旧拼新
    expect(fx.update(1 / 60).phase).toBe('dissolve')
    let spawned: string | null = null
    for (let i = 0; i < Math.ceil((TITLE_DISSOLVE_SEC + 0.2) * 60); i++) {
      const g = fx.update(1 / 60)
      if (g.spawn) spawned = g.spawn.title
    }
    expect(spawned).toBe('七里香')
  })

  it('always→timed 热切换：已驻留超 5s 则下一帧开始消散', () => {
    const fx = new TitleFxProgram()
    fx.setMode('always')
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    run(fx, TITLE_GATHER_SEC + TITLE_HOLD_SEC + 2) // hold 已计 ~7s
    fx.setMode('timed')
    expect(fx.update(1 / 60).phase).toBe('dissolve')
    // 反向：timed→always 在 hold 内切换则不再退场
    const fx2 = new TitleFxProgram()
    fx2.onTrack(CHANGE('稻香'))
    fx2.update(1 / 60)
    run(fx2, TITLE_GATHER_SEC + TITLE_HOLD_SEC / 2)
    fx2.setMode('always')
    const g = run(fx2, TITLE_HOLD_SEC * 2)
    expect(g.phase).toBe('hold')
  })

  it('gather 半程打断：dissolve 首帧 spread/fade 与打断前精确连续（无跳变）', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60) // spawn 帧（内部 t=0）
    // 精确推 30 帧到 t=0.5s，记录打断前最后一帧
    let before = fx.update(0)
    for (let i = 0; i < 30; i++) before = fx.update(1 / 60)
    fx.onTrack(CHANGE('七里香')) // startDissolve 用同一 t 反算起点
    const f = fx.update(0) // dt=0：p=0，应与打断前逐位一致
    expect(f.phase).toBe('dissolve')
    expect(Math.abs(f.spread - before.spread)).toBeLessThan(1e-6)
    expect(Math.abs(f.fade - before.fade)).toBeLessThan(1e-6)
  })

  it('gather 早期打断：dissolve 全程 spread 不溢出 1，fade 单调不升', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60) // spawn 帧
    for (let i = 0; i < 3; i++) fx.update(1 / 60) // 仅 ~0.05s，spreadAtDissolve ≈ 1
    fx.onTrack(CHANGE('七里香')) // 立即转 dissolve
    let prevFade = Infinity
    let dissolveFrames = 0
    for (let i = 0; i < Math.ceil((TITLE_DISSOLVE_SEC + 0.2) * 60); i++) {
      const f = fx.update(1 / 60)
      expect(f.spread).toBeLessThanOrEqual(1 + 1e-9)
      if (f.phase !== 'dissolve') break // dissolve 走完后 pending 会 spawn 新 gather（fade 回升），单调性只看 dissolve 段
      expect(f.fade).toBeLessThanOrEqual(prevFade)
      prevFade = f.fade
      dissolveFrames++
    }
    expect(dissolveFrames).toBeGreaterThan(60) // 确认确实走完了整段 dissolve（~90 帧）
  })

  it('曲线数值锚点：gather t=0.5 与 dissolve 半程贴合规格公式', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60) // spawn 帧（内部 t=0）
    // gather：固定 dt 自己累计 t，推 30 帧到 t=0.5
    const dt = 1 / 60
    let t = 0
    let f = fx.update(0)
    for (let i = 0; i < 30; i++) { f = fx.update(dt); t += dt }
    expect(f.phase).toBe('gather')
    expect(f.spread).toBeCloseTo(1 - easeStandard(t / TITLE_GATHER_SEC))
    expect(f.fade).toBe(1) // t=0.5 时 p*3 = 1.5，已钳到 1
    // 推到 hold 自然耗尽转入 dissolve（首帧 p=0），再自己累计 p 到半程
    while (f.phase !== 'dissolve') f = fx.update(dt)
    let p = 0
    for (let i = 0; i < 45; i++) { f = fx.update(dt); p += dt / TITLE_DISSOLVE_SEC }
    expect(f.phase).toBe('dissolve')
    expect(f.spread).toBeCloseTo(easeDrift(p) * 0.35) // 自然路径起点 spread=0，余量缩放系数=1
    expect(f.fade).toBeCloseTo(1 - easeStandard(p))
  })

  it('cancel：gather 中放弃直接回 idle', () => {
    const fx = new TitleFxProgram()
    fx.onTrack(CHANGE('晴天'))
    fx.update(1 / 60)
    fx.cancel()
    const f = fx.update(1 / 60)
    expect(f.phase).toBe('idle')
    expect(f.fade).toBe(0)
  })
})

describe('sanitizeTitleSettings', () => {
  it('缺失/非法回退默认（timed, scale 1）', () => {
    expect(sanitizeTitleSettings(undefined)).toEqual(DEFAULT_TITLE_SETTINGS)
    expect(sanitizeTitleSettings({ mode: 'forever', scale: 'big' })).toEqual(DEFAULT_TITLE_SETTINGS)
  })

  it('合法值透传；scale 钳 [0.5, 2]', () => {
    expect(sanitizeTitleSettings({ mode: 'always', position: 0, scale: 1.4, brightness: 1.5 })).toEqual({ mode: 'always', position: 0, scale: 1.4, brightness: 1.5 })
    expect(sanitizeTitleSettings({ mode: 'off', position: 'up', scale: 99, brightness: 0.01 })).toEqual({ mode: 'off', position: 1.35, scale: 2, brightness: 0.3 })
    expect(sanitizeTitleSettings({ mode: 'timed', scale: 0.01 })).toEqual({ mode: 'timed', position: 1.35, scale: 0.5, brightness: 1 })
  })

  it('旧存档迁移：showParticleTitle=false → off；true/缺失 → 默认 timed；新字段优先于旧字段', () => {
    expect(sanitizeTitleSettings(undefined, false).mode).toBe('off')
    expect(sanitizeTitleSettings(undefined, true).mode).toBe('timed')
    expect(sanitizeTitleSettings({ mode: 'always' }, false).mode).toBe('always')
  })

  describe('position 数值化迁移（歌词位置滑块 spec §3）', () => {
    it('旧三档字符串走映射（零跳变）', () => {
      expect(sanitizeTitleSettings({ position: 'top' }).position).toBe(1.35)
      expect(sanitizeTitleSettings({ position: 'middle' }).position).toBe(0)
      expect(sanitizeTitleSettings({ position: 'bottom' }).position).toBe(-1.35)
    })
    it('数值钳 ±POS_Y_MAX；NaN/非法字符串/缺失回默认 1.35', () => {
      expect(sanitizeTitleSettings({ position: 3.5 }).position).toBe(2)
      expect(sanitizeTitleSettings({ position: -9 }).position).toBe(-2)
      expect(sanitizeTitleSettings({ position: -0.8 }).position).toBe(-0.8)
      expect(sanitizeTitleSettings({ position: NaN }).position).toBe(1.35)
      expect(sanitizeTitleSettings({ position: 'up' }).position).toBe(1.35)
      expect(sanitizeTitleSettings({}).position).toBe(1.35)
    })
  })
})

describe('位置滑块轻吸附（歌词位置滑块 spec §4）', () => {
  it('节点 EPS 邻域内吸附到节点，邻域外原样返回', () => {
    expect(snapToNodes(1.3)).toBe(1.35)      // 距 1.35 差 0.05 < 0.08 → 吸
    expect(snapToNodes(-0.05)).toBe(0)
    expect(snapToNodes(0.5)).toBe(0.5)       // 距 0.67 差 0.17 > 0.08 → 不吸
    expect(snapToNodes(-1.95)).toBe(-2)
  })
  it('多节点同时命中取最近；恰好等于 EPS 不吸（开区间）', () => {
    expect(snapToNodes(0.04, [0, 0.06], 0.08)).toBe(0.06)
    expect(snapToNodes(0.08, [0], 0.08)).toBe(0.08)
  })
  it('节点表对称 7 点且含旧三档值（迁移后仍可吸回原档）、两端=±量程', () => {
    expect(POSITION_SNAP_NODES).toHaveLength(7)
    for (const n of POSITION_SNAP_NODES) expect(POSITION_SNAP_NODES).toContain(-n)
    expect(POSITION_SNAP_NODES).toContain(POS_Y_PRESET.top)
    expect(POSITION_SNAP_NODES).toContain(POS_Y_PRESET.middle)
    expect(POSITION_SNAP_NODES).toContain(POS_Y_PRESET.bottom)
    expect(POSITION_SNAP_NODES).toContain(POS_Y_MAX)
    expect(POSITION_SNAP_NODES).toContain(-POS_Y_MAX)
  })
})
