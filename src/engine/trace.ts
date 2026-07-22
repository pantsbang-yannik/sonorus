import type { Signals } from './types'
import type { SignalBus } from './bus'

/** spectrum 量化为 Uint8 + 峰值，base64 存储（512 floats → ~683 字符） */
function packSpectrum(sp: Float32Array): { m: number; d: string } {
  let max = 0
  for (let i = 0; i < sp.length; i++) if (sp[i] > max) max = sp[i]
  const u8 = new Uint8Array(sp.length)
  if (max > 0) for (let i = 0; i < sp.length; i++) u8[i] = Math.round((sp[i] / max) * 255)
  let bin = ''
  for (let i = 0; i < u8.length; i += 4096) bin += String.fromCharCode(...u8.subarray(i, i + 4096))
  return { m: max, d: btoa(bin) }
}

function unpackSpectrum(m: number, d: string): Float32Array {
  const bin = atob(d)
  const out = new Float32Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) / 255) * m
  return out
}

export function serializeSignal(s: Signals): string {
  const sp = packSpectrum(s.spectrum)
  return JSON.stringify({
    v: 1,
    t: s.t, li: s.loudness.instant, ls: s.loudness.smooth,
    bl: s.bands.low, bm: s.bands.mid, bh: s.bands.high,
    ob: s.beat.onBeat ? 1 : 0, bs: s.beat.strength, bpm: s.bpm,
    e: s.energy, dr: s.drop ? 1 : 0, si: s.silence ? 1 : 0, sm: sp.m, sd: sp.d
  })
}

export function deserializeSignal(line: string): Signals | null {
  try {
    const o = JSON.parse(line)
    if ('v' in o && o.v !== 1) return null
    if (typeof o?.t !== 'number' || typeof o.sd !== 'string') return null
    return {
      t: o.t, loudness: { instant: o.li, smooth: o.ls },
      bands: { low: o.bl, mid: o.bm, high: o.bh },
      spectrum: unpackSpectrum(o.sm, o.sd),
      beat: { onBeat: o.ob === 1, strength: o.bs }, bpm: o.bpm ?? null,
      energy: o.e, drop: o.dr === 1, silence: o.si === 1
    }
  } catch {
    return null
  }
}

export class TraceRecorder {
  private lines: string[] = []
  private unsubscribe: (() => void) | null = null

  start(bus: SignalBus): void {
    if (this.unsubscribe) return
    this.unsubscribe = bus.subscribe((s) => this.lines.push(serializeSignal(s)))
  }

  stop(): string {
    this.unsubscribe?.()
    this.unsubscribe = null
    const out = this.lines.join('\n')
    this.lines = []
    return out
  }

  get count(): number {
    return this.lines.length
  }
}

export class TracePlayer {
  private entries: Signals[]
  private cursor = 0
  private clock: number
  readonly duration: number

  constructor(jsonl: string) {
    this.entries = jsonl.split('\n').map(deserializeSignal).filter((s): s is Signals => s !== null)
    const t0 = this.entries[0]?.t ?? 0
    this.duration = (this.entries.at(-1)?.t ?? t0) - t0
    this.clock = t0
  }

  step(dtSec: number, publish: (s: Signals) => void): void {
    if (this.entries.length === 0) return
    this.clock += dtSec
    while (this.cursor < this.entries.length && this.entries[this.cursor].t <= this.clock) {
      publish(this.entries[this.cursor])
      this.cursor++
    }
    if (this.cursor >= this.entries.length) { // 循环
      this.cursor = 0
      this.clock = this.entries[0].t
    }
  }
}
