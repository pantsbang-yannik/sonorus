// src/ui/idle-hint-logic.ts
// 空状态教学 + 权限闭环判定状态机（发布准备③ spec §2，纯逻辑零 DOM/IPC）。
// 与 onboarding-logic 同一判定哲学：macOS 拒绝授权不报错只给静音，「在播却静音」即权限疑似被收回。
// permission 态粘滞：只有真实声音或压制（面板/本地播放/回放）能解除——用户去系统设置改权限的
// 半路上音乐可能暂停，指引不能因此消失。
export type IdleHintState = 'hidden' | 'teach' | 'permission'

export interface IdleHintInput {
  /** 原始 PCM 帧近 1s 内有能量（pcm-energy 探针，与 bus 解耦） */
  audible: boolean
  /** 系统在播（track change + progress playing） */
  hasTrack: boolean
  /** capture:status === 'unavailable'（tap 挂掉/二进制缺失） */
  captureUnavailable: boolean
  /** 面板/引导/本地播放/回放任一活跃——强制隐藏且计时清零 */
  suppressed: boolean
  dt: number
}

const TEACH_AFTER_SEC = 25 // 沉睡（10s）落定后再等一段，才淡入教学文案
const PERMISSION_AFTER_SEC = 8 // 对齐 onboarding DENIED_AFTER_SEC 的判定口径

export class IdleHintLogic {
  state: IdleHintState = 'hidden'
  private idleSec = 0
  private mutedWhilePlayingSec = 0

  sample(s: IdleHintInput): IdleHintState {
    if (s.suppressed || s.audible) {
      this.state = 'hidden'
      this.idleSec = 0
      this.mutedWhilePlayingSec = 0
      return this.state
    }
    if (s.captureUnavailable) {
      this.state = 'permission' // 捕获明确挂了不用等交叉判定，直达指引
      return this.state
    }
    if (this.state === 'permission') return this.state // 粘滞（见文件头）
    if (s.hasTrack) {
      this.idleSec = 0
      this.mutedWhilePlayingSec += s.dt
      // 在播窗口期教学文案不合语境（「放一首歌」×正在播）——未到判定线先藏
      this.state = this.mutedWhilePlayingSec >= PERMISSION_AFTER_SEC ? 'permission' : 'hidden'
    } else {
      this.mutedWhilePlayingSec = 0
      this.idleSec += s.dt
      if (this.idleSec >= TEACH_AFTER_SEC) this.state = 'teach'
    }
    return this.state
  }
}
