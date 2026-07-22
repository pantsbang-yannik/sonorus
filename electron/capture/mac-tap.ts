import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { CaptureHeader, CaptureStatus } from './types'
import { PcmChunker } from './pcm-chunker'

const CHUNK_SAMPLES = 1024 // 每 channel（fb6 延迟速赢：2048→1024，采集缓冲平均延迟 ~21ms→~11ms；
                           // IPC 频率 23.4→46.9 chunk/s 量级安全；丢帧阈值按 1s 音频量算不受影响）

export interface MacTapEvents {
  onHeader: (h: CaptureHeader) => void
  onPcm: (chunk: Buffer, header: CaptureHeader) => void
  onStatus: (s: CaptureStatus) => void
  /** 失败细节（发布准备③ 导出诊断）：status 只有二值，出错原因经此进诊断日志；不接=行为不变 */
  onError?: (message: string) => void
}

export function startMacTap(events: MacTapEvents): () => void {
  const binPath = app.isPackaged
    ? join(process.resourcesPath, 'sonorus-tap')
    : join(app.getAppPath(), 'native/mac-tap/sonorus-tap')

  if (!existsSync(binPath)) {
    events.onError?.(`tap 二进制不存在: ${binPath}`)
    events.onStatus('unavailable')
    return () => {}
  }

  let child: ChildProcess | null = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'] })
  let header: CaptureHeader | null = null
  let chunker: PcmChunker | null = null
  // 代际守卫（审①P2-2）：restartCapture 先杀旧代再起新代，旧进程迟到的 exit 事件若不拦，
  // 会把新代刚报的 running 覆盖成 unavailable（idle-hint permission 粘滞 + 诊断记错，无自愈）
  let stopped = false

  // 头部可能跨多个 data 事件到达：逐行消费（解析过的行移出缓冲），
  // 找到头部或错误即停，避免非头部首行被反复重解析 + 缓冲无界增长
  let stderrBuf = ''
  let headerDone = false
  child.stderr!.on('data', (d: Buffer) => {
    if (stopped || headerDone) return
    stderrBuf += d.toString()
    let nl: number
    while (!headerDone && (nl = stderrBuf.indexOf('\n')) >= 0) {
      const line = stderrBuf.slice(0, nl).trim()
      stderrBuf = stderrBuf.slice(nl + 1)
      if (!line) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.sampleRate) {
          header = { sampleRate: parsed.sampleRate, channels: parsed.channels }
          const frameBytes = header.channels * 4
          chunker = new PcmChunker(
            CHUNK_SAMPLES * frameBytes, // 每 chunk 字节数（1024 samples/ch）
            frameBytes,
            header.sampleRate * frameBytes // 丢帧阈值：1s 音频量
          )
          events.onHeader(header)
          events.onStatus('running')
          headerDone = true
        } else if (parsed.error) {
          events.onError?.(`tap 报错: ${parsed.error} (status ${parsed.status})`)
          events.onStatus('unavailable')
          headerDone = true
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    }
    if (headerDone) stderrBuf = ''
  })

  child.stdout!.on('data', (d: Buffer) => {
    if (stopped || !header || !chunker) return
    for (const chunk of chunker.push(d)) {
      events.onPcm(chunk, header)
    }
  })

  // existsSync 通过也可能 spawn 失败（EACCES / quarantine 等）
  child.on('error', (err) => {
    if (stopped) return
    events.onError?.(`tap 进程启动失败: ${err.message}`)
    events.onStatus('unavailable')
  })
  child.on('exit', (code) => {
    if (stopped) return // 主动停代（重启/退出）不发事件——顺带消掉每次重启一条的退出日志噪音
    events.onError?.(`tap 进程退出 code=${String(code)}`)
    events.onStatus('unavailable')
  })

  return () => {
    stopped = true
    child?.kill('SIGTERM')
    child = null
  }
}
