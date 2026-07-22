// 合成 demo trace 占位生成器（发布准备③ spec §1.3）：产出 src/assets/traces/onboarding-demo.jsonl。
// 验收阶段由用户在开发版按 R 从真歌录制同名文件替换——本脚本只保证开发期序幕有信号可跳。
// 行格式与 src/engine/trace.ts serializeSignal 完全一致（v1，spectrum Uint8 量化 + base64）。
// 确定性：无随机数，纯正弦叠加，重跑同输出。
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/traces/onboarding-demo.jsonl')

const DURATION = 48 // 秒，TracePlayer 自动循环
const RATE = 30 // 信号帧率
const BPM = 112
const BEAT_SEC = 60 / BPM
const BINS = 512

function packSpectrum(sp) {
  let max = 0
  for (const v of sp) if (v > max) max = v
  const u8 = new Uint8Array(sp.length)
  if (max > 0) for (let i = 0; i < sp.length; i++) u8[i] = Math.round((sp[i] / max) * 255)
  return { m: max, d: Buffer.from(u8).toString('base64') }
}

/** 段落能量弧线：铺垫 → 主歌 → 短爬升 → 副歌（drop）→ 收束 */
function energyAt(t) {
  if (t < 12) return 0.35 + (t / 12) * 0.15
  if (t < 24) return 0.5 + 0.04 * Math.sin(t * 0.9)
  if (t < 26) return 0.55 + ((t - 24) / 2) * 0.3
  if (t < 38) return 0.85 + 0.08 * Math.sin(t * 1.7)
  if (t < 44) return 0.7 - ((t - 38) / 6) * 0.2
  return 0.5 - ((t - 44) / 4) * 0.15
}

const lines = []
let prevBeatIdx = -1
for (let i = 0; i < DURATION * RATE; i++) {
  const t = i / RATE
  const energy = energyAt(t)
  const beatIdx = Math.floor(t / BEAT_SEC)
  const onBeat = beatIdx !== prevBeatIdx
  prevBeatIdx = beatIdx
  const beatPhase = (t % BEAT_SEC) / BEAT_SEC // 0=拍点
  const pulse = Math.exp(-beatPhase * 6) // 拍点冲击衰减包络
  const strength = onBeat ? 0.55 + 0.4 * Math.abs(Math.sin(beatIdx * 1.618)) : 0
  const chorus = t >= 26 && t < 38
  const drop = i === Math.round(26 * RATE) // 副歌落点单帧爆发

  const smooth = Math.min(1, energy * 0.9 + 0.05)
  const instant = Math.min(1, smooth * (0.75 + 0.45 * pulse))
  const low = Math.min(1, energy * (0.5 + 0.5 * pulse))
  const mid = Math.min(1, energy * (0.55 + 0.25 * Math.sin(t * 2.3 + 1)))
  const high = Math.min(1, (chorus ? 0.75 : 0.45) * energy * (0.6 + 0.4 * Math.sin(t * 5.1)))

  // 频谱：低频重滚降 + 三段 band 鼓包 + 慢速梳状起伏（画面频谱环/点阵消费）
  const sp = new Float32Array(BINS)
  for (let b = 0; b < BINS; b++) {
    const x = b / BINS
    const rolloff = Math.exp(-x * 4.5)
    const lowBump = low * Math.exp(-((x - 0.05) ** 2) / 0.004)
    const midBump = mid * 0.6 * Math.exp(-((x - 0.3) ** 2) / 0.02)
    const highBump = high * 0.4 * Math.exp(-((x - 0.7) ** 2) / 0.05)
    const comb = 0.85 + 0.15 * Math.sin(x * 40 + t * 0.7)
    sp[b] = Math.max(0, (rolloff * 0.5 * energy + lowBump + midBump + highBump) * comb)
  }
  const packed = packSpectrum(sp)

  lines.push(JSON.stringify({
    v: 1,
    t, li: Number(instant.toFixed(4)), ls: Number(smooth.toFixed(4)),
    bl: Number(low.toFixed(4)), bm: Number(mid.toFixed(4)), bh: Number(high.toFixed(4)),
    ob: onBeat ? 1 : 0, bs: Number(strength.toFixed(4)), bpm: BPM,
    e: Number(energy.toFixed(4)), dr: drop ? 1 : 0, si: 0, sm: packed.m, sd: packed.d
  }))
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, lines.join('\n'))
console.log(`生成 ${OUT}: ${lines.length} 帧 / ${DURATION}s，${(lines.join('\n').length / 1e6).toFixed(2)} MB`)
