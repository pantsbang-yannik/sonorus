export interface PcmFrame {
  sampleRate: number
  channels: number
  samples: Float32Array    // 交错
}

export interface Signals {
  t: number                                     // 秒
  loudness: { instant: number; smooth: number } // 0..1，相对 30s 滚动峰值（音量无关，契约 v1.1）
  bands: { low: number; mid: number; high: number } // 各频段归一化能量
  spectrum: Float32Array                        // 平滑幅度谱（512 bins）
  beat: { onBeat: boolean; strength: number }   // 本 hop 是否鼓点
  bpm: number | null
  energy: number                                // 0..1 段落能量
  drop: boolean                                 // 本 hop 是否爆发
  silence: boolean
}
