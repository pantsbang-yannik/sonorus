// 切歌拼字生命周期状态机（纯逻辑，spec §3）：idle → gather(1s) → hold(5s 或常驻) → dissolve(1.5s) → idle。
// 单槽 pending：展示中切歌先散旧字，散完只拼最新一首。uniform 值（spread/fade）由本机输出，
// 渲染类（TitleParticles）纯消费——分工同 mapper→uPulse* 先例。
// 亲验期追加（2026-07-12 用户）：三态模式（off/timed/always）+ 整体大小 scale——设置类型与 sanitize
// 一并收在本文件（先例：camera-types.ts 承载 CameraSettings + sanitize，供 electron/settings.ts 复用）。
import { easeStandard, easeDrift } from '../shared/motion'

/** 与 SceneTrackEvent 结构兼容的最小事件形状。不 import ../types：本文件的 sanitize 被
 * electron 侧 settings.ts 复用（node tsconfig 无 DOM lib），必须保持零 DOM 依赖（同 camera-types 纪律） */
export type TitleTrackEvent = { kind: 'change'; title: string; artist: string } | { kind: 'unknown' }

export interface TitleTrack { title: string; artist: string }
export type TitlePhase = 'idle' | 'gather' | 'hold' | 'dissolve'
export interface TitleFrame {
  phase: TitlePhase
  spread: number
  fade: number
  spawn: TitleTrack | null
}

/** 展示模式：off=不出现 / timed=驻留 5s 后消散（默认，原「开」）/ always=常驻到下一次切歌 */
export type TitleMode = 'off' | 'timed' | 'always'
export interface TitleSettings {
  mode: TitleMode
  position: number // 悬浮高度（世界 y，滑块量程 ±POS_Y_MAX；旧三档字符串由 sanitize 迁移）
  scale: number // 整体大小倍率（面板档位 小0.7/标准1/大1.4；sanitize 钳 [0.5,2]）
  brightness: number // 亮度倍率（面板档位 暗0.6/标准1/亮1.5；sanitize 钳 [0.3,2]）
}
export const DEFAULT_TITLE_SETTINGS: TitleSettings = { mode: 'timed', position: 1.35, scale: 1, brightness: 1 }
export const TITLE_SCALE_MIN = 0.5
export const TITLE_SCALE_MAX = 2
export const TITLE_BRIGHTNESS_MIN = 0.3
export const TITLE_BRIGHTNESS_MAX = 2

const TITLE_MODES: readonly string[] = ['off', 'timed', 'always']

/** 逐字段校验（先例 sanitizeCameraSettings）：非法回退默认。
 * 迁移：旧存档的 showParticleTitle 布尔（本功能首版字段）——false 迁为 off，true/缺失走默认 timed */
export function sanitizeTitleSettings(raw: unknown, legacyShow?: unknown): TitleSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  let mode: TitleMode
  if (TITLE_MODES.includes(r.mode as string)) mode = r.mode as TitleMode
  else mode = legacyShow === false ? 'off' : DEFAULT_TITLE_SETTINGS.mode
  const position = sanitizePositionY(r.position, DEFAULT_TITLE_SETTINGS.position)
  const num = (v: unknown, min: number, max: number, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
  const scale = num(r.scale, TITLE_SCALE_MIN, TITLE_SCALE_MAX, DEFAULT_TITLE_SETTINGS.scale)
  const brightness = num(r.brightness, TITLE_BRIGHTNESS_MIN, TITLE_BRIGHTNESS_MAX, DEFAULT_TITLE_SETTINGS.brightness)
  return { mode, position, scale, brightness }
}

export const TITLE_GATHER_SEC = 1.0
export const TITLE_HOLD_SEC = 5.0
export const TITLE_DISSOLVE_SEC = 1.5
const DISSOLVE_SPREAD = 0.35 // 消散是缓释不是二次爆开：外扩幅度压到 gather 散布的 35%

export class TitleFxProgram {
  private mode: TitleMode = 'timed'
  private phase: TitlePhase = 'idle'
  private t = 0 // 当前相位已推进秒数
  private lastKey: string | null = null // 'unknown' 或 title\0artist；null=从未见过事件
  private pending: TitleTrack | null = null // 单槽：dissolve 走完要拼的下一首
  private fadeAtDissolve = 1 // dissolve 起点 fade（从 gather 半程打断时无跳变）
  private spreadAtDissolve = 0 // dissolve 起点 spread（同上）

  /** off=立即散场且不再触发；timed↔always 热切换：hold 计时到点与否由 update 逐帧按当前模式判定
   * （always→timed 且已驻留超 5s 会在下一帧开始消散——「切回限时就退场」符合直觉） */
  setMode(m: TitleMode): void {
    if (this.mode === m) return
    this.mode = m
    if (m === 'off') {
      this.pending = null
      if (this.phase === 'gather' || this.phase === 'hold') this.startDissolve()
    }
  }

  onTrack(t: TitleTrackEvent): void {
    if (t.kind !== 'change' || t.title === '') {
      // unknown/空题：记键防补发，展示中自然散场
      // 无需门控 mode：off 时 phase 不可能是 gather/hold（setMode('off') 已立即转 dissolve），此处转 dissolve 分支天然不可达
      if (this.lastKey === 'unknown') return
      this.lastKey = 'unknown'
      this.pending = null
      if (this.phase === 'gather' || this.phase === 'hold') this.startDissolve()
      return
    }
    const key = `${t.title}\0${t.artist}`
    if (key === this.lastKey) return // 同曲补发（封面晚到）
    this.lastKey = key
    if (this.mode === 'off') return
    const track = { title: t.title, artist: t.artist }
    if (this.phase === 'idle') {
      this.pending = track // update 里统一 spawn（帧节奏一致，测试可步进）
    } else if (this.phase === 'dissolve') {
      this.pending = track // 单槽覆盖：只拼最新
    } else {
      this.pending = track
      this.startDissolve()
    }
  }

  cancel(): void {
    this.phase = 'idle'
    this.t = 0
    this.pending = null
  }

  update(dt: number): TitleFrame {
    // idle + 有 pending → 本帧 spawn 进 gather
    if (this.phase === 'idle' && this.pending && this.mode !== 'off') {
      const spawn = this.pending
      this.pending = null
      this.phase = 'gather'
      this.t = 0
      return { phase: 'gather', spread: 1, fade: 0, spawn }
    }
    this.t += dt
    switch (this.phase) {
      case 'gather': {
        const p = Math.min(1, this.t / TITLE_GATHER_SEC)
        if (p >= 1) { this.phase = 'hold'; this.t = 0; return { phase: 'hold', spread: 0, fade: 1, spawn: null } }
        return { phase: 'gather', spread: 1 - easeStandard(p), fade: Math.min(1, p * 3), spawn: null }
      }
      case 'hold': {
        // 常驻模式不计时退场：驻留到下一次切歌/unknown/关闭（startDissolve 由事件驱动）
        if (this.mode === 'timed' && this.t >= TITLE_HOLD_SEC) this.startDissolve()
        else return { phase: 'hold', spread: 0, fade: 1, spawn: null }
        return { phase: 'dissolve', spread: this.spreadAtDissolve, fade: this.fadeAtDissolve, spawn: null }
      }
      case 'dissolve': {
        const p = Math.min(1, this.t / TITLE_DISSOLVE_SEC)
        if (p >= 1) { this.phase = 'idle'; this.t = 0; return { phase: 'idle', spread: 0, fade: 0, spawn: null } }
        return {
          phase: 'dissolve',
          // 外扩按剩余余量 (1-起点) 缩放：gather 早期打断（起点≈1）不再向外冲，spread 恒 ≤1
          spread: this.spreadAtDissolve + easeDrift(p) * DISSOLVE_SPREAD * (1 - this.spreadAtDissolve),
          fade: this.fadeAtDissolve * (1 - easeStandard(p)),
          spawn: null
        }
      }
      default:
        return { phase: 'idle', spread: 0, fade: 0, spawn: null }
    }
  }

  /** 从当前相位无跳变转入 dissolve：记下当前 spread/fade 作为衰减起点 */
  private startDissolve(): void {
    if (this.phase === 'gather') {
      const p = Math.min(1, this.t / TITLE_GATHER_SEC)
      this.spreadAtDissolve = 1 - easeStandard(p)
      this.fadeAtDissolve = Math.min(1, p * 3)
    } else {
      this.spreadAtDissolve = 0
      this.fadeAtDissolve = 1
    }
    this.phase = 'dissolve'
    this.t = 0
  }
}

// ===== 位置滑块化（歌词位置滑块 spec §3/§4）：位置数值域常量 + 轻吸附纯函数 =====
// 收在本文件：与 sanitize 同住（UI/渲染/electron settings 三方共用的单一事实源，零 DOM 纪律不变）

/** 位置滑块量程（世界 y）。存世界单位而非归一化：未来放宽量程不改既有存档的实际位置 */
export const POS_Y_MAX = 2.0
/** 旧三档 → 数值迁移映射（即原 TITLE_ANCHOR_Y 三值，迁移画面零跳变）；也是默认值与吸附节点来源 */
export const POS_Y_PRESET = { top: 1.35, middle: 0, bottom: -1.35 } as const
/** 轻吸附节点（对称 7 点）：中间 / ±1/3 处 / ±原上下档 / ±两端 */
export const POSITION_SNAP_NODES: readonly number[] = [-2, -1.35, -0.67, 0, 0.67, 1.35, 2]
/** 吸附半径（手感，亲验调）：|v−node| < EPS 吸到 node。
 * 亲验 fb1「吸附不明显」：0.08 只占量程 2%（轨道约 4px 捕获区）→ 放宽 0.15（约 7px/侧） */
export const POSITION_SNAP_EPS = 0.15

/** 轻吸附：v 落在某节点 EPS 开邻域内取该节点（多节点命中取最近），否则原样返回 */
export function snapToNodes(
  v: number,
  nodes: readonly number[] = POSITION_SNAP_NODES,
  eps: number = POSITION_SNAP_EPS,
): number {
  let best = v
  let bestDist = eps
  for (const n of nodes) {
    const d = Math.abs(v - n)
    if (d < bestDist) { best = n; bestDist = d }
  }
  return best
}

/** 位置字段校验+迁移（title/lyrics 两处 sanitize 共用）：
 * 数值 → 钳 ±POS_Y_MAX；旧三档字符串 → POS_Y_PRESET 映射（零跳变）；其余 → 回默认 */
export function sanitizePositionY(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(POS_Y_MAX, Math.max(-POS_Y_MAX, v))
  if (typeof v === 'string' && v in POS_Y_PRESET) return POS_Y_PRESET[v as keyof typeof POS_Y_PRESET]
  return fallback
}
