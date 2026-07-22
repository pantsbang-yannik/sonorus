// 涟漪控制器（虚空之镜 spec §涟漪控制器）：纯逻辑零 three/DOM。
// beat.onBeat 是 kick/snare 任一 onset（非小节重拍），逐拍起圈=水面感之源——
// 门槛+冷却+并发上限让涟漪「稀疏而郑重」（防海面化纪律④）。
// 消费 beat 事件本身（上升沿+strength），不读会反复重置的 uBeat 包络。
export const RIPPLE_MAX = 3
export const RIPPLE_STRENGTH_MIN = 0.75 // strength=hybrid 合成语义（fb5：能量语境为主，真机 p50≈0.65/p90≈0.96）：高能段全过线由冷却限流，安静段一致克制——稀疏由 0.75 门 + 冷却共同保证
export const RIPPLE_COOLDOWN_SEC = 0.4
export const RIPPLE_LIFE_SEC = 2.2
export const RIPPLE_DROP_STRENGTH = 1.2 // drop 大涟漪越过普通拍强度上限，镜面按强度放大环幅

export interface RippleInputs {
  onBeat: boolean
  strength: number
  dropEdge: boolean
  silence: boolean
  sleeping: boolean
  /** 设置滑杆 ripple（0..1）：0=不起圈（减少动态效果逃生通道） */
  gain: number
}
export interface RippleState { age: number; strength: number }

export class RippleController {
  private list: RippleState[] = []
  private cooldown = 0

  /** 每帧推进并返回活跃涟漪（≤RIPPLE_MAX，镜面据此打包 uniform；返回值即内部数组，调用方只读） */
  update(dt: number, ev: RippleInputs): RippleState[] {
    this.cooldown = Math.max(0, this.cooldown - dt)
    for (const r of this.list) r.age += dt
    this.list = this.list.filter((r) => r.age < RIPPLE_LIFE_SEC)
    if (ev.gain <= 0 || ev.sleeping || ev.silence) return this.list
    if (ev.dropEdge) {
      // drop 大涟漪：无视冷却清空小圈——一次郑重的仪式，不与散拍混杂（spec §涟漪控制器特例）
      this.list = [{ age: 0, strength: RIPPLE_DROP_STRENGTH * ev.gain }]
      this.cooldown = RIPPLE_COOLDOWN_SEC
      return this.list
    }
    if (ev.onBeat && ev.strength >= RIPPLE_STRENGTH_MIN && this.cooldown <= 0 && this.list.length < RIPPLE_MAX) {
      this.list.push({ age: 0, strength: ev.strength * ev.gain })
      this.cooldown = RIPPLE_COOLDOWN_SEC
    }
    return this.list
  }
}
