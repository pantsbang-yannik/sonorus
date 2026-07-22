// src/ui/onboarding-logic.ts
// 首启引导判定状态机（纯逻辑，零 DOM/IPC）。macOS 拒绝授权不报错只给静音（M0 结论），
// 判定只能靠信号交叉：能量=成功；歌名在播却持续静音=授权被拒。
export type OnboardingState = 'intro' | 'listening' | 'denied' | 'success'

const DENIED_AFTER_SEC = 8 // 在播却静音这么久 → 判授权被拒
const MUSIC_HINT_AFTER_SEC = 4 // 无任何信号这么久 → 提示「放一首歌试试」

export class OnboardingLogic {
  state: OnboardingState = 'intro'
  needsMusicHint = false
  private mutedWhilePlayingSec = 0
  private idleSec = 0

  start(): void {
    if (this.state === 'intro') this.state = 'listening'
  }

  retry(): void {
    if (this.state !== 'denied') return
    this.state = 'listening'
    this.mutedWhilePlayingSec = 0
  }

  sample(s: { hasAudio: boolean; hasTrack: boolean; dt: number }): void {
    if (this.state !== 'listening' && this.state !== 'denied') return
    if (s.hasAudio) {
      this.state = 'success' // 任何时刻听到真实能量都是终局
      return
    }
    if (this.state !== 'listening') return
    if (s.hasTrack) {
      this.needsMusicHint = false
      this.mutedWhilePlayingSec += s.dt
      if (this.mutedWhilePlayingSec >= DENIED_AFTER_SEC) this.state = 'denied'
    } else {
      this.idleSec += s.dt
      if (this.idleSec >= MUSIC_HINT_AFTER_SEC) this.needsMusicHint = true
    }
  }
}
