import { describe, it, expect } from 'vitest'
import { hybridBeatStrength, BEAT_RANK_W, BEAT_ENERGY_W } from '../../src/engine/engine'

describe('hybridBeatStrength（fb5：排名×能量语境合成）', () => {
  it('钳位 [0,1]；对 rank/energy 单调不减', () => {
    expect(hybridBeatStrength(1, 1)).toBe(1)
    expect(hybridBeatStrength(0, 0)).toBe(0)
    expect(hybridBeatStrength(0.8, 0.9)).toBeGreaterThan(hybridBeatStrength(0.5, 0.9))
    expect(hybridBeatStrength(0.5, 0.9)).toBeGreaterThan(hybridBeatStrength(0.5, 0.3))
  })
  // 语义锚点按校准终值(0.14/1.02)重锚：能量为主轴。重音锚从「>0.9 接近满」改为
  // 「≥0.8 稳过涟漪线且高于同段中拍」——0.9 锚定的是 spec 起点权重(0.6/0.55)，
  // 起点值在三首真歌上翻脸率全挂硬线，rank 降为微调后重音 ≈0.95×0.14+0.7×1.02≈0.85
  it('语义锚点：均匀副歌(rank0.5,e0.9)过涟漪线0.75；均匀安静段(rank0.5,e0.3)不过镜头线0.6；重音(rank0.95,e0.7)≥0.8 且高于同段中拍', () => {
    expect(hybridBeatStrength(0.5, 0.9)).toBeGreaterThanOrEqual(0.75)
    expect(hybridBeatStrength(0.5, 0.3)).toBeLessThan(0.6)
    expect(hybridBeatStrength(0.95, 0.7)).toBeGreaterThanOrEqual(0.8)
    expect(hybridBeatStrength(0.95, 0.7)).toBeGreaterThan(hybridBeatStrength(0.5, 0.7))
  })
  it('权重常量=校准终值（2026-07-14 三首真歌网格扫描收敛；校准收敛只许动这里）', () => {
    expect(BEAT_RANK_W).toBe(0.14)
    expect(BEAT_ENERGY_W).toBe(1.02)
  })
})
