// 线条系数据链（线条系主体 spec §技术方案）：512-bin 谱 → 对数分桶 64 → 滚动峰值归一 →
// 快起慢落平滑 → 静默硬门归零。纯逻辑零 three/DOM（惯例同 lyrics-rhythm）。
// 输出 values ∈[0,1] 由 LineworkBody 直灌 uniform 数组；silence 用引擎硬门不猜谱值（spec §风险）。
export const BIN_COUNT = 64

const SPECTRUM_SIZE = 512
const EDGE_LO = 2            // 跳过 DC 与次低 bin（<~40Hz 噪声地板）
const ATTACK_TAU = 0.03      // 起跳时间常数（s）：3 帧内到位，跳动有生命感
const RELEASE_TAU = 0.18     // 回落时间常数：慢落不抽搐
const PEAK_RELEASE_PER_SEC = 0.25 // 滚动峰值每秒衰减比例：安静段 ~4s 重新校准增益
const PEAK_FLOOR = 1e-4      // 峰值下限：防除零/静噪放大
const GLOBAL_TIE = 0.05      // fb1 逐桶归一的全局系绳：桶自峰低于全局峰 5% 时按全局参考——噪声地板不虚涨
const LOUD_WEIGHT_GAMMA = 1.6 // fb4 响度权重幂次：柱形=逐桶归一（保上半环起舞），整体高度×(当前全场能量/全局峰)^γ——
// 逐桶归一会抹掉响度信息（任何起音都是自己的峰=瞬间满格），此权重把"现在整体多响"乘回来：
// 安静段全体收敛、副歌打满。γ 越大安静段收得越狠（1=温和线性,2=激进）

// 对数桶边界（模块加载算一次）：EDGE_LO..512 几何级数，保证单调且首尾覆盖完备；
// 低桶宽度可能 <1 bin，用 max 保每桶至少 1 bin
const EDGES: number[] = (() => {
  const e: number[] = []
  for (let i = 0; i <= BIN_COUNT; i++) {
    e.push(Math.round(EDGE_LO * Math.pow(SPECTRUM_SIZE / EDGE_LO, i / BIN_COUNT)))
  }
  for (let i = 1; i <= BIN_COUNT; i++) e[i] = Math.max(e[i], e[i - 1] + 1)
  e[BIN_COUNT] = SPECTRUM_SIZE
  return e
})()

export class SpectrumBins {
  readonly values = new Float32Array(BIN_COUNT)
  private readonly raw = new Float32Array(BIN_COUNT)
  private peak = PEAK_FLOOR
  /** fb1 逐桶滚动峰值：全局归一下高频桶永远只占全局峰的零头（环上半=高频恒矮）——
   * 每桶按自身历史峰值归一，柱柱都有满高的机会（参考图类可视化的通行做法） */
  private readonly binPeaks = new Float32Array(BIN_COUNT).fill(PEAK_FLOOR)
  private loud = 0 // fb4 当前响度权重（本帧全场能量相对全局峰，已过 γ 曲线）

  /** rateMul：映射速度→响应速率乘子（调音台规范化：死线接活）。1=现状；>1 起落同快（柱子更跟手） */
  update(spectrum: Float32Array | number[] | null, silence: boolean, dt: number, rateMul = 1): void {
    // 1) 分桶均值（silence/null 帧目标全零，谱残余余晖不可信）
    const live = !silence && spectrum !== null
    if (live) {
      for (let k = 0; k < BIN_COUNT; k++) {
        let sum = 0
        for (let i = EDGES[k]; i < EDGES[k + 1]; i++) sum += spectrum![i]
        this.raw[k] = sum / (EDGES[k + 1] - EDGES[k])
      }
      // 2) 滚动峰值归一（相对响度：与系统音量解耦，同引擎 loudness 契约精神）——
      //    fb1：全局峰只当"系绳"参考，真正的归一基准是逐桶自峰
      let frameMax = 0
      const decay = 1 - PEAK_RELEASE_PER_SEC * dt
      for (let k = 0; k < BIN_COUNT; k++) {
        frameMax = Math.max(frameMax, this.raw[k])
        this.binPeaks[k] = Math.max(this.binPeaks[k] * decay, this.raw[k], PEAK_FLOOR)
      }
      this.peak = Math.max(this.peak * decay, frameMax, PEAK_FLOOR)
      // fb4 响度权重：frameMax≤peak 恒成立（上一行刚 max 过），比值 ∈[0,1]
      this.loud = Math.pow(frameMax / this.peak, LOUD_WEIGHT_GAMMA)
    }
    // 3) 快起慢落逼近目标
    const aAtk = 1 - Math.exp(-dt * rateMul / ATTACK_TAU)
    const aRel = 1 - Math.exp(-dt * rateMul / RELEASE_TAU)
    for (let k = 0; k < BIN_COUNT; k++) {
      const target = live
        ? Math.min(1, this.raw[k] / Math.max(this.binPeaks[k], this.peak * GLOBAL_TIE)) * this.loud
        : 0
      const cur = this.values[k]
      this.values[k] = cur + (target - cur) * (target > cur ? aAtk : aRel)
    }
  }
}
