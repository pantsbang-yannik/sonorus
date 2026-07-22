import Meyda from 'meyda'
import type { PcmFrame } from './types'

export const HOP_SIZE = 1024

export interface FeatureFrame {
  rms: number
  bands: { low: number; mid: number; high: number }
  spectrum: Float32Array
}

export function mixToMono(frame: PcmFrame): Float32Array {
  const { channels, samples } = frame
  if (channels === 1) return samples
  const n = Math.floor(samples.length / channels)
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let c = 0; c < channels; c++) acc += samples[i * channels + c]
    mono[i] = acc / channels
  }
  return mono
}

export function extractFeatures(mono: Float32Array, sampleRate: number): FeatureFrame {
  Meyda.bufferSize = HOP_SIZE
  Meyda.sampleRate = sampleRate

  // Calculate RMS directly to avoid windowing effects
  let sum = 0
  for (let i = 0; i < mono.length; i++) {
    sum += mono[i] * mono[i]
  }
  const rms = Math.sqrt(sum / mono.length)

  const spectrum = Float32Array.from(
    (Meyda.extract('amplitudeSpectrum', mono) as unknown as number[]) ?? new Array(512).fill(0)
  )
  const binHz = sampleRate / HOP_SIZE
  const lowEnd = Math.max(1, Math.round(280 / binHz))
  const midEnd = Math.round(4000 / binHz)
  const avg = (from: number, to: number): number => {
    let s = 0
    for (let i = from; i < to; i++) s += spectrum[i]
    return to > from ? s / (to - from) : 0
  }
  return {
    rms,
    spectrum,
    bands: {
      low: avg(0, lowEnd),
      mid: avg(lowEnd, midEnd),
      high: avg(midEnd, spectrum.length)
    }
  }
}
