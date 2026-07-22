// 激光束角状态机(图形三连 spec §③,#激光动态束):纯逻辑零 three/DOM。
// 束角=扇面基线(能量开合)+慢扫正弦摆;beat 跳位=扫向翻转+相位跃迁,阻尼跟随(利落不瞬移)。
// 跳位用确定性相位跃迁而非随机——trace 回放同轨可复现,测试可对照。
// 束池/gains 门:条数烘死进 TSL 节点图(池大小固定),视觉束数由 gains(0..1 亮度门)逐束门控,
// 束数三层动态——能量常驻(下限..旋钮上限浮动)+鼓点瞬增(冲击一组反应)+底部高能加入(上主下辅)。
export const LASER_TOP_POOL = 10   // 顶部主扇束池:条数烘死进 TSL 节点图,视觉束数由 gains 门控
export const LASER_BOTTOM_POOL = 6 // 底部上射束池(上主下辅:高能才渐次加入)
export const LASER_POOL = LASER_TOP_POOL + LASER_BOTTOM_POOL
export const LASER_BEAMS_MIN = 2   // 静默/低能常驻束数下限
export const LASER_SPREAD_MIN = 0.1  // 静默/低能扇半角(rad)
export const LASER_SPREAD_MAX = 0.55 // 高能扇半角
const BOTTOM_ENERGY_GATE = 0.5     // 能量过半后底部束开始加入
const BURST_BEAMS = 2              // 强拍瞬增束数
const BURST_HALF_LIFE = 0.3        // 瞬增指数衰减半衰期(s)
const GAIN_TAU = 0.2               // 束亮度门淡入淡出时间常数:束的出现/消失不蹦
const SWEEP_RATE = 0.45       // 慢扫角速度(相位域 rad/s)
const JUMP_PHASE = 2.1        // beat 相位跃迁量(非 π 整倍,跳后姿态不重复)
const JUMP_STRENGTH_MIN = 0.6
const JUMP_COOLDOWN_SEC = 0.25
const FOLLOW_TAU = 0.07       // 角度阻尼时间常数:跳位快而不瞬移
const WOBBLE = 0.06           // 慢扫摆幅(rad)
const WOBBLE2_FREQ = 2.37     // 第二正弦频率(与主频不可通约→漂移永不重复)
const JUMP_RAND_MIN = 0.8     // 乱跳相位下限
const JUMP_RAND_SPAN = 2.6    // 乱跳相位跨度
const FLIP_GATE = 0.5         // 乱度下跳向翻转概率闸

/** 确定性散列(跳位计数→伪随机 0..1):trace 回放同轨可复现,禁 Math.random */
const hash = (n: number): number => {
  const s = Math.sin(n * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export interface LaserInputs {
  onBeat: boolean; strength: number; dropEdge: boolean
  silence: boolean; sleeping: boolean; energy: number
  /** 映射速度→扫动速率乘子(死线接活):1=现状 */
  rateMul: number
  /** 开角旋钮:缩放扇面张角,1=现状 */
  spreadMul: number
  /** 速度旋钮:缩放扫动相位推进速率,1=现状 */
  speedMul: number
  /** 乱度旋钮:0=旧规律行为(恒翻转+固定跃迁),1=散列随机翻转+随机跃迁+第二正弦摆动 */
  chaos: number
  /** 光束数量旋钮:常驻束数在 LASER_BEAMS_MIN..maxCount 间随能量浮动,瞬增后仍受其钳制 */
  maxCount: number
}

export class LaserSweep {
  /** 各束当前角(rad):[0..TOP_POOL)顶部下射、[TOP_POOL..POOL)底部上射;配对 gains 门控亮度 */
  readonly angles = new Float32Array(LASER_POOL)
  /** 各束亮度门 0..1:束数变化经淡入淡出,画板逐束乘用 */
  readonly gains = new Float32Array(LASER_POOL)
  private burst = 0
  private phase = 0
  private dir = 1
  private cooldown = 0
  private jumpN = 0

  update(dt: number, ev: LaserInputs): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    const calm = ev.silence || ev.sleeping
    if (!calm) {
      this.phase += SWEEP_RATE * this.dir * ev.rateMul * ev.speedMul * dt
      if (ev.dropEdge || (ev.onBeat && ev.strength >= JUMP_STRENGTH_MIN && this.cooldown <= 0)) {
        this.jumpN += 1
        // 乱度=0:恒翻转+固定跃迁(旧行为);乱度=1:半数翻转+散列随机跃迁
        if (hash(this.jumpN * 1.7 + 0.3) > ev.chaos * FLIP_GATE) this.dir = -this.dir
        const rand = JUMP_RAND_MIN + JUMP_RAND_SPAN * hash(this.jumpN)
        this.phase += (JUMP_PHASE * (1 - ev.chaos) + rand * ev.chaos) * this.dir
        this.burst = BURST_BEAMS // 强拍/drop 瞬增束(与跳位同门槛同冷却,一次冲击一组反应)
        this.cooldown = JUMP_COOLDOWN_SEC
      }
    }
    const spread = (calm ? LASER_SPREAD_MIN
      : LASER_SPREAD_MIN + (LASER_SPREAD_MAX - LASER_SPREAD_MIN) * Math.min(1, ev.energy)) * ev.spreadMul
    this.burst *= Math.pow(0.5, dt / BURST_HALF_LIFE)
    // 束数三层:能量定常驻 + 鼓点瞬增,钳上限;calm 收到下限
    const maxN = Math.min(LASER_POOL, Math.max(LASER_BEAMS_MIN, Math.round(ev.maxCount)))
    const live = calm ? LASER_BEAMS_MIN
      : Math.min(maxN, Math.round(LASER_BEAMS_MIN + (maxN - LASER_BEAMS_MIN) * Math.min(1, ev.energy) + this.burst))
    // 上主下辅:能量越过门槛的程度决定底部份额,恒 ≤ 半数(底不超顶)
    const over = calm ? 0 : Math.max(0, Math.min(1, (ev.energy - BOTTOM_ENERGY_GATE) / (1 - BOTTOM_ENERGY_GATE)))
    const bottomN = Math.min(LASER_BOTTOM_POOL, Math.floor(live / 2), Math.round(over * (live / 2)))
    const topN = Math.min(LASER_TOP_POOL, live - bottomN)

    const a = 1 - Math.exp(-dt / FOLLOW_TAU)
    const g = 1 - Math.exp(-dt / GAIN_TAU)
    // 非活跃束角度也阻尼归中(target=0):静默收拢语义对全池成立(既有用例口径),
    // 且再激活时从中心阻尼展开,不会带着陈旧角度蹦回
    for (let i = 0; i < LASER_TOP_POOL; i++) {
      const active = i < topN
      let target = 0
      if (active) {
        const half = Math.max(1, (topN - 1) / 2)
        const centered = (i - (topN - 1) / 2) / half // 活跃束对称排布:束数变化=扇面重新展开(阻尼平滑)
        target = centered * spread + Math.sin(this.phase + i * 0.7) * WOBBLE
          + Math.sin(this.phase * WOBBLE2_FREQ + i * 1.9) * WOBBLE * ev.chaos
      }
      this.angles[i] += (target - this.angles[i]) * a
      this.gains[i] += ((active ? 1 : 0) - this.gains[i]) * g
    }
    for (let k = 0; k < LASER_BOTTOM_POOL; k++) {
      const i = LASER_TOP_POOL + k
      const active = k < bottomN
      let target = 0
      if (active) {
        const half = Math.max(1, (bottomN - 1) / 2)
        const centered = bottomN > 1 ? (k - (bottomN - 1) / 2) / half : 0
        // 底部束独立相位(×1.31 与顶不可通约):对射交织而非死板镜像
        target = centered * spread * 0.8 + Math.sin(this.phase * 1.31 + k * 0.9) * WOBBLE
          + Math.sin(this.phase * WOBBLE2_FREQ * 1.31 + k * 1.7) * WOBBLE * ev.chaos
      }
      this.angles[i] += (target - this.angles[i]) * a
      this.gains[i] += ((active ? 1 : 0) - this.gains[i]) * g
    }
  }
}
