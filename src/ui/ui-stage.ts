// 路线 C 核心（M4 设计 2.3）：UI 出现时指挥场景「退台」。唯一输出是 0..1 的 uiFocus 包络，
// 经注入的 apply 回调进 SceneHost.setUiFocus；三联动（相机后拉/CoC 退焦/调光）在场景内部消化。
import gsap from 'gsap'
import { easeDrift } from '../scenes/shared/motion' // M3 运镜同款曲线
import type { UiFocusProfile } from '../scenes/types'

export type TweenFn = (from: number, to: number, onUpdate: (v: number) => void) => () => void

const gsapTween: TweenFn = (from, to, onUpdate) => {
  const proxy = { v: from } // GSAP 只 tween proxy（M3 坑纪律），真实写入走 onUpdate
  const t = gsap.to(proxy, {
    v: to,
    duration: 0.9,
    ease: (x: number) => easeDrift(x),
    onUpdate: () => onUpdate(proxy.v)
  })
  return () => t.kill()
}

export class UiStage {
  private open = 0
  private value = 0
  /** 当前退台画风——由 PanelCoordinator 在互斥切换面板时通过 setProfile 更新（A2 退台分级） */
  private profile: UiFocusProfile = 'full'
  private cancel: (() => void) | null = null

  constructor(
    private apply: (v: number, profile: UiFocusProfile) => void,
    private tween: TweenFn = gsapTween
  ) {}

  push(): void {
    this.open++
    if (this.open === 1) this.to(1)
  }

  pop(): void {
    if (this.open === 0) return
    this.open--
    if (this.open === 0) this.to(0)
  }

  /** 面板互斥切换（如设置开着点调试台）时调用：舞台已在 v=1，只需换画风，
   * 不重新起 pop→push 的 tween（避免闪烁）——用当前值立即重新 apply 一次 */
  setProfile(profile: UiFocusProfile): void {
    this.profile = profile
    this.apply(this.value, this.profile)
  }

  dispose(): void {
    this.cancel?.()
    this.cancel = null
  }

  private to(target: number): void {
    this.cancel?.()
    this.cancel = this.tween(this.value, target, (v) => {
      this.value = v
      this.apply(v, this.profile)
    })
  }
}
