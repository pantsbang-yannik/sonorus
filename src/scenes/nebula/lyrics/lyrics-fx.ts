// 歌词粒子（二期 spec §5/§6）：LyricsSettings + sanitize（本文件被 electron/settings.ts 复用，
// 零 DOM 依赖纪律同 title-fx.ts）。LyricsFxProgram 状态机（Task 7）在本文件下方。
import { easeStandard, easeImpact, easeDrift } from '../../shared/motion'
import type { LyricLine } from './lrc'
import { sanitizePositionY } from '../title-fx'

export interface LyricsSettings {
  enabled: boolean          // 关 = 不抓词、不轮询、不渲染（整链路休眠，spec §6）
  position: number          // 悬浮高度（世界 y，量程±POS_Y_MAX）；独立于粒子歌名的位置（亲验期追加：原沿用 title.position）
  scale: number             // 面板档位 小0.7/标准1/大1.4；钳 [0.5,2]
  dynamics: boolean         // 节奏动态总开关（批2 接线；批1 仅存取）
  brightness: number        // 面板档位 暗0.6/标准1/亮1.5；钳 [0.3,2]
  dynamicsGain: number      // 亲验 fb1-D：节奏三层（呼吸/脉冲/burst）幅度缩放；钳 [0,2] 默认 1，0≈幅度层纯静态（对拍时序仍由 dynamics 总闸管）
}

// 发布默认（发布准备③ 用户复调：字大、贴底）：最下方大字低亮弱动态——可读性优先，仍不抢星云主体。
// 首启观感调优（2026-07-23 用户复调）：字再大一档、动态再弱三分之二——歌词求「稳稳可读」，
// 律动交给星云本体表达
export const DEFAULT_LYRICS_SETTINGS: LyricsSettings = {
  enabled: true, position: -2, scale: 1.5, dynamics: true, brightness: 0.6, dynamicsGain: 0.05
}
export const LYRICS_SCALE_MIN = 0.5
export const LYRICS_SCALE_MAX = 2
export const LYRICS_BRIGHTNESS_MIN = 0.3
export const LYRICS_BRIGHTNESS_MAX = 2
export const LYRICS_DYNAMICS_GAIN_MIN = 0
export const LYRICS_DYNAMICS_GAIN_MAX = 2

/** 逐字段校验非法回退默认（先例 sanitizeTitleSettings；position 为亲验期追加，旧存档缺失回默认 −1.35） */
export function sanitizeLyricsSettings(raw: unknown): LyricsSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const num = (v: unknown, min: number, max: number, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
  return {
    enabled: bool(r.enabled, DEFAULT_LYRICS_SETTINGS.enabled),
    position: sanitizePositionY(r.position, DEFAULT_LYRICS_SETTINGS.position),
    scale: num(r.scale, LYRICS_SCALE_MIN, LYRICS_SCALE_MAX, DEFAULT_LYRICS_SETTINGS.scale),
    dynamics: bool(r.dynamics, DEFAULT_LYRICS_SETTINGS.dynamics),
    brightness: num(r.brightness, LYRICS_BRIGHTNESS_MIN, LYRICS_BRIGHTNESS_MAX, DEFAULT_LYRICS_SETTINGS.brightness),
    dynamicsGain: num(r.dynamicsGain, LYRICS_DYNAMICS_GAIN_MIN, LYRICS_DYNAMICS_GAIN_MAX, DEFAULT_LYRICS_SETTINGS.dynamicsGain)
  }
}

// ===== LyricsFxProgram 生命周期状态机（spec §5.2，纯逻辑零 DOM）=====
// idle → gather(0.8s) → show → morph(0.7s) ⇄ show → …；长间奏/互斥/清词 → dissolve(1.2s) → idle。
// uniform 值（spread/fade/mix）由本机输出，渲染类（LyricsParticles）纯消费——title-fx 分工先例。
// C+A 混合：句间 morph 直飞（双槽乒乓），长间奏才散场；密句（窗<1.6s）跳过——宁漏不赶。

export type LyricsPhase = 'idle' | 'gather' | 'show' | 'morph' | 'dissolve'
export interface LyricsFrame {
  phase: LyricsPhase
  spread: number
  fade: number
  /** 双缓冲插值：0=槽0字形 1=槽1字形。渲染 = mix(槽0, 槽1, mix) */
  mix: number
  /** 本帧需上传点云的句（gather=当前极槽 / morph=对面槽）；渲染方先上传再消费本帧 uniform */
  spawn: { text: string; slot: 0 | 1 } | null
}

export const LYRICS_GATHER_SEC = 0.8
export const LYRICS_MORPH_SEC = 0.7
export const LYRICS_DISSOLVE_SEC = 1.2
// 长间奏散场判据（亲验 fb 收严）：LRC 只有句首时间戳，一句唱多久无从知——旧判据(句窗>6s+驻留4s)
// 把慢歌唱满 7~8s 的长句误判成"唱完进间奏"，唱到一半词就消失（实锤=《好想爱这个世界啊》26/53 句中招）。
// 收严为三重门：句窗>12s 才可能是间奏 + 至少驻留句窗 60% + 驻留上限 15s（末句 ∞ 句窗靠上限兜底）——
// 宁可真间奏期歌词多挂几秒，不许唱到一半消失
export const LYRICS_GAP_SEC = 12
export const LYRICS_LONG_HOLD_SEC = 4
export const LYRICS_HOLD_FRAC = 0.6
export const LYRICS_HOLD_MAX_SEC = 15
export const LYRICS_MIN_LINE_SEC = 1.6
export const LYRICS_PREROLL_SEC = 0.8
const DISSOLVE_SPREAD = 0.35 // 同 title-fx：消散是缓释外扩不是二次爆开

/** 批2 节奏调度输入（可选：不传=批1 静态行为）——nextBeatIn 由 LyricsRhythm 预测；
 * drop 冲散已改道节奏层（fb4 碎散聚：炸开-重聚不杀句），本类不再消费 drop */
export interface LyricsBeatOpts {
  nextBeatIn: number | null
}
export const LYRICS_BEAT_SNAP_SEC = 0.4

export class LyricsFxProgram {
  private lines: LyricLine[] | null = null
  private phase: LyricsPhase = 'idle'
  private t = 0
  private shownIdx = -1       // 当前展示（或 morph 去往）的句；散场后保留可防同句复拼
  private showEnterPos = 0    // 进入本次 show 时的 position；长间奏驻留＝position 相对它的推进量（歌曲时间，非墙钟）
  private mix = 0
  private morphFrom = 0
  private morphTo = 0
  private fadeAtDissolve = 1
  private spreadAtDissolve = 0
  // idle/dissolve 静止态的 spread 基线：dissolve 连续写入其收尾值，idle 原样透出——
  // 避免"消散刚收尾→下一句立即重进场"这类衔接处出现 spread 从 0 硬跳到 1（uniform 禁止跳变）
  private restSpread = 1
  private gatherStartSpread = 1 // 本次 gather 的起始 spread（通常 1；散场未收满即重进场时=restSpread，接续渐弱轨迹）
  private morphHold = 0 // 对拍 morph 倒计时：>0 = 已决定 morph、等拍点起跳（期间维持 show）

  hasDoc(): boolean {
    return this.lines !== null
  }

  /** 换词/清词：在场则散场，shownIdx 归零重新按 position 进场 */
  setDoc(lines: LyricLine[] | null): void {
    this.lines = lines && lines.length > 0 ? lines : null
    this.shownIdx = -1
    if (this.phase === 'gather' || this.phase === 'show' || this.phase === 'morph') this.startDissolve()
  }

  clear(): void {
    this.setDoc(null)
  }

  /** 点云渲染失败（画布不可用/全空文字）：回 idle 但保留 shownIdx——坏句不重试，等下一句 */
  cancel(): void {
    this.phase = 'idle'
    this.t = 0
    this.mix = Math.round(this.mix) // 半途 morph 作废：mix 落回最近极值，槽语义保持一致
  }

  update(dt: number, position: number | null, titleBusy: boolean, opts?: LyricsBeatOpts): LyricsFrame {
    const blocked = titleBusy || !this.lines || position === null
    if (blocked && (this.phase === 'gather' || this.phase === 'show' || this.phase === 'morph')) {
      this.shownIdx = -1 // 互斥/断流散场后允许同句重进场（区别于长间奏散场）
      this.startDissolve()
    }
    // 目标句：position 落点句且句窗可展示；密句不成为目标（保持现状=跳过）
    let target = -1
    if (!blocked) {
      const at = this.lineAt(position!)
      if (at >= 0 && this.displayable(at)) target = at
    }

    this.t += dt
    switch (this.phase) {
      case 'idle': {
        if (blocked) return this.frame(this.restSpread, 0, null)
        let spawnIdx = -1
        if (target >= 0 && target !== this.shownIdx) {
          spawnIdx = target // 立即进场：晚到/seek/歌名让位
        } else {
          const next = this.nextDisplayableAfter(position!)
          if (next >= 0 && this.lines![next].t - position! <= LYRICS_PREROLL_SEC) spawnIdx = next // 预聚
        }
        if (spawnIdx >= 0) {
          this.shownIdx = spawnIdx
          this.phase = 'gather'
          this.t = 0
          this.gatherStartSpread = this.restSpread // 接续 idle/消散基线，不强行跳回 1
          return this.frame(this.gatherStartSpread, 0, { text: this.lines![spawnIdx].text, slot: this.activeSlot() })
        }
        return this.frame(this.restSpread, 0, null)
      }
      case 'gather': {
        const p = Math.min(1, this.t / LYRICS_GATHER_SEC)
        if (p >= 1) {
          this.phase = 'show'
          this.t = 0
          this.showEnterPos = position! // 走到这必是 !blocked 分支，position 非空
          this.restSpread = 0 // 完全收拢；供后续消散/idle 沿用起点
          return this.frame(0, 1, null)
        }
        return this.frame(this.gatherStartSpread * (1 - easeStandard(p)), Math.min(1, p * 3), null)
      }
      case 'show': {
        if (target >= 0 && target !== this.shownIdx) {
          // 对拍 morph（spec §5.2）：预测下一拍 ≤0.4s → 起跳压到拍点；否则立即。
          // 等待中不重估 nextBeatIn（morphHold 自行倒计时）；起跳时用最新 target
          if (this.morphHold > 0) {
            this.morphHold -= dt
            if (this.morphHold <= 0) {
              this.morphHold = 0
              return this.startMorph(target)
            }
            return this.frame(0, 1, null)
          }
          const wait = opts?.nextBeatIn ?? null
          if (wait !== null && wait > dt && wait <= LYRICS_BEAT_SNAP_SEC) {
            this.morphHold = wait
            return this.frame(0, 1, null)
          }
          return this.startMorph(target)
        }
        this.morphHold = 0 // 目标回退到当前句（seek 回跳）：取消等待
        if (!blocked && this.shownIdx >= 0) {
          const start = this.lines![this.shownIdx].t
          const end = this.lineEnd(this.shownIdx)
          // 长间奏散场：句窗超长、进场后驻留够（防 seek 晚入即散）、按句窗比例驻留到位（防慢歌长句
          // 唱到一半被散，见文件头判据注释）、且不临近下一句（临近则等 morph 更顺）
          if (
            end - start > LYRICS_GAP_SEC &&
            position! - this.showEnterPos >= LYRICS_LONG_HOLD_SEC &&
            position! - start >= Math.min((end - start) * LYRICS_HOLD_FRAC, LYRICS_HOLD_MAX_SEC) &&
            end - position! > LYRICS_PREROLL_SEC
          ) {
            this.startDissolve()
            return this.frame(this.spreadAtDissolve, this.fadeAtDissolve, null)
          }
        }
        return this.frame(0, 1, null)
      }
      case 'morph': {
        const p = Math.min(1, this.t / LYRICS_MORPH_SEC)
        this.mix = this.morphFrom + (this.morphTo - this.morphFrom) * easeImpact(p) // 快出慢收
        if (p >= 1) {
          this.mix = this.morphTo
          this.phase = 'show'
          this.t = 0
          this.showEnterPos = position! // 走到这必是 !blocked 分支，position 非空
        }
        return this.frame(0, 1, null)
      }
      case 'dissolve': {
        const p = Math.min(1, this.t / LYRICS_DISSOLVE_SEC)
        // 连续写入 restSpread（而非收尾强制清零/清一）：消散刚收尾就被下一句立即重进场时，
        // gather 起点接续这里的值，不产生 uniform 跳变
        this.restSpread = this.spreadAtDissolve + easeDrift(p) * DISSOLVE_SPREAD * (1 - this.spreadAtDissolve)
        const fade = this.fadeAtDissolve * (1 - easeStandard(p))
        if (p >= 1) {
          this.phase = 'idle'
          this.t = 0
        }
        return this.frame(this.restSpread, fade, null)
      }
    }
  }

  /** mix 极值所在槽：0=槽0 1=槽1（morph 中四舍五入到出发槽无意义——只在 idle/show 调用） */
  private activeSlot(): 0 | 1 {
    return this.mix >= 0.5 ? 1 : 0
  }

  private startMorph(target: number): LyricsFrame {
    const toSlot: 0 | 1 = this.activeSlot() === 0 ? 1 : 0
    this.morphFrom = this.mix
    this.morphTo = toSlot
    this.shownIdx = target
    this.phase = 'morph'
    this.t = 0
    return this.frame(0, 1, { text: this.lines![target].text, slot: toSlot })
  }

  private startDissolve(): void {
    if (this.phase === 'gather') {
      const p = Math.min(1, this.t / LYRICS_GATHER_SEC)
      this.spreadAtDissolve = this.gatherStartSpread * (1 - easeStandard(p))
      this.fadeAtDissolve = Math.min(1, p * 3)
    } else {
      this.spreadAtDissolve = 0
      this.fadeAtDissolve = 1
    }
    this.mix = Math.round(this.mix) // morph 半途散场：mix 收敛到最近极值
    this.phase = 'dissolve'
    this.t = 0
    this.morphHold = 0 // blocked 散场取消等待（drop 已不散场，fb4）
  }

  private frame(spread: number, fade: number, spawn: LyricsFrame['spawn']): LyricsFrame {
    return { phase: this.phase, spread, fade, mix: this.mix, spawn }
  }

  private lineEnd(i: number): number {
    const ls = this.lines!
    return i + 1 < ls.length ? ls[i + 1].t : Infinity
  }

  private displayable(i: number): boolean {
    return this.lineEnd(i) - this.lines![i].t >= LYRICS_MIN_LINE_SEC
  }

  /** 最后一个 t<=pos 的句 index；无 → -1（二分） */
  private lineAt(pos: number): number {
    const ls = this.lines!
    let lo = 0
    let hi = ls.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ls[mid].t <= pos) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  /** 首个 t>pos 且可展示的句 index；无 → -1 */
  private nextDisplayableAfter(pos: number): number {
    const ls = this.lines!
    for (let i = this.lineAt(pos) + 1; i < ls.length; i++) {
      if (this.displayable(i)) return i
    }
    return -1
  }
}
