// src/ui/idle-hint.ts
// 空状态教学 + 权限闭环的 UI 壳（发布准备③ spec §2.2）：两幕中央淡文案，
// 三态由 IdleHintLogic 驱动，本层只管显影切换与按钮接线（onboarding 同款显影语言）。
// 容器 pointer-events: none 不挡舞台交互，仅权限幕按钮显式 auto（makeTextButton 内）。
import { makeSceneWrapper, makeTextButton } from './onboarding'
import type { IdleHintState } from './idle-hint-logic'

export interface IdleHintDeps {
  openAudioPrefs: () => void
  restartCapture: () => void
}

export class IdleHint {
  private container: HTMLElement
  private scenes: { teach: HTMLElement; permission: HTMLElement }
  private shown: IdleHintState = 'hidden'

  constructor(parent: HTMLElement, deps: IdleHintDeps) {
    this.container = document.createElement('div')
    this.container.setAttribute('data-role', 'idle-hint')
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
    `

    // ===== 教学幕：一行细字，比引导文案更淡（长期陪伴不打扰）=====
    const teach = makeSceneWrapper()
    const teachText = document.createElement('div')
    teachText.setAttribute('data-role', 'idle-hint-teach')
    teachText.textContent = '放一首歌，让声音显形'
    teachText.style.cssText = `
      font-size: 15px;
      font-weight: 300;
      letter-spacing: 0.1em;
      color: rgba(255, 255, 255, 0.4);
    `
    teach.appendChild(teachText)

    // ===== 权限幕：与 onboarding denied 幕同款指引 + 双按钮 =====
    const permission = makeSceneWrapper()
    const permLine1 = document.createElement('div')
    permLine1.setAttribute('data-role', 'idle-hint-permission')
    permLine1.textContent = 'Audelyra 听不到系统声音'
    permLine1.style.cssText = `
      font-size: 15px;
      font-weight: 300;
      letter-spacing: 0.06em;
      color: rgba(255, 255, 255, 0.85);
    `
    const permLine2 = document.createElement('div')
    permLine2.textContent = '系统设置 → 隐私与安全性 → 系统音频录制，确认 Audelyra 已开启'
    permLine2.style.cssText = `
      font-size: 12px;
      font-weight: 300;
      letter-spacing: 0.04em;
      color: rgba(255, 255, 255, 0.45);
      margin-bottom: 20px;
    `
    const buttons = document.createElement('div')
    buttons.style.cssText = 'display: flex; gap: 32px;'
    const prefsBtn = makeTextButton('打开系统设置', () => deps.openAudioPrefs())
    prefsBtn.setAttribute('data-role', 'idle-hint-open-prefs')
    const retryBtn = makeTextButton('重试', () => deps.restartCapture())
    retryBtn.setAttribute('data-role', 'idle-hint-retry')
    buttons.append(prefsBtn, retryBtn)
    permission.append(permLine1, permLine2, buttons)

    this.container.append(teach, permission)
    parent.appendChild(this.container)
    this.scenes = { teach, permission }
  }

  /** 幂等：同态重复调用不动 DOM（1s 采样节拍下的常态路径） */
  setState(state: IdleHintState): void {
    if (state === this.shown) return
    this.shown = state
    for (const key of ['teach', 'permission'] as const) {
      const el = this.scenes[key]
      if (key === state) {
        el.style.visibility = 'visible'
        el.style.opacity = '1'
        el.style.filter = 'blur(0)'
      } else {
        el.style.visibility = 'hidden'
        el.style.opacity = '0'
        el.style.filter = 'blur(6px)'
      }
    }
  }

  dispose(): void {
    this.container.remove()
  }
}
