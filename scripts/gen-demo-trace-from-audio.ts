// 序幕配乐管线（发布准备③ 亲验反馈轮②）：从 CC-BY 音源产出「内置音频段 + 同拍 trace」。
// 用法：npx vite-node scripts/gen-demo-trace-from-audio.ts
// 管线：mp3 → ffmpeg 全曲 f32 → 真实引擎能量扫描选最高能 60s 窗 → ffmpeg 剪段+淡入淡出
//       → ①libmp3lame 128k 编码进 src/assets/audio/（?url 内置）②段内重喂引擎录 trace（serializeSignal 同格式）
// 关键：trace 与音频出自同一段落同一淡变曲线 → 序幕粒子脉动与用户听到的音乐同拍。
// 确定性：无随机数，同音源同输出（bakedAt 除外，不写入）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AudelyraEngine } from '../src/engine/engine'
import { TraceRecorder } from '../src/engine/trace'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_MP3 = join(ROOT, 'assets/audio-src/fsm-team-escp-neonscapes.mp3')
const OUT_MP3 = join(ROOT, 'src/assets/audio/onboarding-demo.mp3')
const OUT_TRACE = join(ROOT, 'src/assets/traces/onboarding-demo.jsonl')
const TMP = join(ROOT, 'assets/audio-src/.tmp')

const RATE = 48000
const SEG_SEC = 60 // 序幕正常 30-60s 走完；trace/音频双循环兜底更久的停留
const FADE_IN = 1.5
const FADE_OUT = 2.5
const CHUNK = 4800 // 0.05s/次喂引擎（interleaved 立体声）

function decodeF32(input: string, args: string[] = []): Float32Array {
  const raw = join(TMP, 'decode.pcm')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', input, ...args, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), raw])
  const buf = readFileSync(raw)
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/** 喂引擎收 (t, energy) 曲线或完整 trace */
function runEngine(pcm: Float32Array, record: boolean): { energies: Array<{ t: number; e: number }>; trace: string } {
  const engine = new AudelyraEngine()
  const energies: Array<{ t: number; e: number }> = []
  const recorder = new TraceRecorder()
  if (record) recorder.start(engine.bus)
  const unsub = engine.bus.subscribe((s) => energies.push({ t: s.t, e: s.energy }))
  for (let off = 0; off < pcm.length; off += CHUNK * 2) {
    engine.ingest({ sampleRate: RATE, channels: 2, samples: pcm.subarray(off, off + CHUNK * 2) })
  }
  unsub()
  return { energies, trace: record ? recorder.stop() : '' }
}

mkdirSync(TMP, { recursive: true })
mkdirSync(dirname(OUT_MP3), { recursive: true })

// 1) 全曲逐秒绝对 RMS（不用引擎 energy——那是相对至今峰值的，开头窗必然虚高）
const full = decodeF32(SRC_MP3)
const total = full.length / 2 / RATE
const rmsPerSec: number[] = []
for (let s = 0; s < Math.floor(total); s++) {
  let acc = 0
  const from = s * RATE * 2, to = Math.min(full.length, (s + 1) * RATE * 2)
  for (let i = from; i < to; i++) acc += full[i] * full[i]
  rmsPerSec.push(Math.sqrt(acc / Math.max(1, to - from)))
}

// 2) 1s 步进滑窗选平均 RMS 最高的 60s 段
let bestStart = 0
let bestScore = -1
for (let s = 0; s + SEG_SEC <= rmsPerSec.length; s++) {
  let score = 0
  for (let k = 0; k < SEG_SEC; k++) score += rmsPerSec[s + k]
  if (score > bestScore) { bestScore = score; bestStart = s }
}
bestScore /= SEG_SEC
console.log(`选段: ${bestStart}s..${bestStart + SEG_SEC}s（全曲 ${total.toFixed(1)}s，窗均 RMS ${bestScore.toFixed(4)}）`)

// 3) 剪段 + 淡入淡出 → 内置 mp3（128k ≈ 1MB/分钟）
const fade = `afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${SEG_SEC - FADE_OUT}:d=${FADE_OUT}`
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(bestStart), '-t', String(SEG_SEC), '-i', SRC_MP3,
  '-af', fade, '-c:a', 'libmp3lame', '-b:a', '128k', OUT_MP3])

// 4) 同一段（含同一淡变）重喂新引擎录 trace —— 音画同源
const seg = decodeF32(OUT_MP3)
const { trace, energies: segE } = runEngine(seg, true)
writeFileSync(OUT_TRACE, trace)
const lines = trace.split('\n').length
const silent = segE.filter((p) => p.e < 0.05).length
console.log(`trace: ${lines} 行，${(trace.length / 1e6).toFixed(2)}MB，段内低能帧占比 ${(silent / segE.length * 100).toFixed(1)}%`)
rmSync(TMP, { recursive: true, force: true })
