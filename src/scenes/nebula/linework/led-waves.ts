// 点阵环波队列(图形三连 spec §②):纯逻辑零 three/DOM。
// 与 RippleController 机制同族但纪律相反——涟漪「稀疏而郑重」(门槛0.75/冷却0.4/上限3),
// 点阵墙要「繁密跟拍」:门槛/冷却减半、4 槽常转;常量独立演化,不复用互相牵制(spec 取舍)。
export const LED_SLOTS = 4
export const LED_WAVE_SPEED = 7      // 波前速度(画板世界单位/s):~2.5s 扫过半屏
export const LED_WAVE_MAX_R = 24     // 出界半径=空槽哨兵
export const LED_STRENGTH_MIN = 0.5  // 起环门槛(涟漪 0.75 的跟拍版)
export const LED_COOLDOWN_SEC = 0.22
export const LED_DROP_AMP = 1.3      // drop 大环幅度(越过普通拍上限,同 RIPPLE_DROP_STRENGTH 语义)

export interface LedWaveInputs {
  onBeat: boolean; strength: number; dropEdge: boolean
  silence: boolean; sleeping: boolean; energy: number
  /** 映射速度→行进速率乘子(死线接活):1=现状 */
  rateMul: number
}

export class LedWaves {
  /** 波前半径(世界单位);≥MAX_R=空槽。画板按槽高斯包络点亮格子 */
  readonly radii = new Float32Array(LED_SLOTS).fill(LED_WAVE_MAX_R)
  /** 环幅(发射时定格;行进远端渐弱交给画板按半径算) */
  readonly amps = new Float32Array(LED_SLOTS)
  private cooldown = 0

  update(dt: number, ev: LedWaveInputs): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    for (let i = 0; i < LED_SLOTS; i++) {
      if (this.radii[i] < LED_WAVE_MAX_R) {
        this.radii[i] = Math.min(LED_WAVE_MAX_R, this.radii[i] + LED_WAVE_SPEED * ev.rateMul * dt)
        if (this.radii[i] >= LED_WAVE_MAX_R) this.amps[i] = 0 // 出界即清幅:防哨兵半径残留振幅在画板角落显影
      }
    }
    if (ev.silence || ev.sleeping) return
    if (ev.dropEdge) {
      // drop 大环:无视冷却抢最旧槽(涟漪 drop 特例同款仪式感)
      this.emit(LED_DROP_AMP)
      this.cooldown = LED_COOLDOWN_SEC
      return
    }
    if (ev.onBeat && ev.strength >= LED_STRENGTH_MIN && this.cooldown <= 0) {
      this.emit(0.55 + 0.45 * Math.min(1, ev.strength))
      this.cooldown = LED_COOLDOWN_SEC
    }
  }

  /** 选最大半径槽(最旧/空槽)复用 */
  private emit(amp: number): void {
    let slot = 0
    for (let i = 1; i < LED_SLOTS; i++) if (this.radii[i] > this.radii[slot]) slot = i
    this.radii[slot] = 0
    this.amps[slot] = amp
  }
}
