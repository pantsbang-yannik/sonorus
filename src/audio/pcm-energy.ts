// src/audio/pcm-energy.ts
// 原始 PCM 帧能量探针（发布准备③）：纯函数，零 DOM/零依赖。
// 用途：引导/空状态的「听到声音」判定改从原始帧直测——与 SignalBus 彻底解耦，
// demo trace 回放灌 bus 不会造成假成功，捕获冻结时 bus 停走也不会拿陈旧信号误判。
// 阈值依据：macOS 拒绝授权不报错只给全零帧（M0 结论），正常播放哪怕小声 RMS 也远超 1e-3，
// 0.001 足以区分「零流/底噪」与「真有声」。

export const AUDIBLE_RMS = 0.001

export function frameRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}
