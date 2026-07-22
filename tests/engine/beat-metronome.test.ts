// fb5 病根最小复现：均匀等响鼓点序列——旧排名语义强制把等响拍摊成 0..1 名次（±1% 抖动
// 便足以定名次），修后 ±TIE_EPS 内并列、力度收敛。硬线 std ≤0.08 不许放宽。
import { describe, it, expect } from 'vitest'
import { BeatDetector } from '../../src/engine/beat'

const SR = 48000
const HOP = 1024
const HOP_SEC = HOP / SR
const BINS = HOP / 2

/** 合成频谱帧：kick 帧在 30-200Hz 频段（bin 1..4）给幅度，静默帧近零 */
function frame(kickAmp: number): Float32Array {
  const s = new Float32Array(BINS)
  for (let b = 1; b <= 4; b++) s[b] = kickAmp
  return s
}

describe('节拍器合成测试（fb5 硬线：均匀鼓点力度收敛）', () => {
  it('等响鼓点±1%抖动：预热后力度标准差 ≤0.08', () => {
    const det = new BeatDetector(SR, HOP)
    const strengths: number[] = []
    const clickPeriod = 0.5 // 120bpm
    let nextClick = 0.5
    let clickIdx = 0
    for (let t = 0; t < 40; t += HOP_SEC) {
      let amp = 0
      if (t >= nextClick) {
        // ±1% 确定性抖动：真实世界的毫厘差——旧语义靠它定名次，新语义视为并列
        amp = 10 * (1 + 0.01 * Math.sin(clickIdx * 1.7))
        nextClick += clickPeriod
        clickIdx++
      }
      const b = det.push(frame(amp), t)
      if (b.onBeat && t > 10) strengths.push(b.strength) // 前 10s 预热（阈值窗+力度窗填充）
    }
    expect(strengths.length).toBeGreaterThan(30)
    const mean = strengths.reduce((a, x) => a + x, 0) / strengths.length
    const std = Math.sqrt(strengths.reduce((a, x) => a + (x - mean) ** 2, 0) / strengths.length)
    expect(std).toBeLessThanOrEqual(0.08)
  })
})
