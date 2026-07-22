// 更新检查器（发布准备② spec）：双源串行回退取 latest.json + 启动延迟/24h 定时调度。
// fetch/timers 可注入（lyrics/service 先例，单测不打真网络不走真时钟）；一切失败静默降级。
import { sanitizeManifest, type UpdateManifest } from './protocol'

/** latest.json 双源：raw.githubusercontent 主源 + jsDelivr CDN 备源（国内可达性）。
 * 地址烘死在包里改不了——公开仓 pantsbang-yannik/sonorus 一经分发不可更名/转私有
 * （2026-07-22 拍板：v0.1.0 从未分发，撤销独立发布仓，改主流单仓模式：清单+DMG 全在公开代码仓） */
export const LATEST_JSON_URLS: readonly string[] = [
  'https://raw.githubusercontent.com/pantsbang-yannik/sonorus/main/latest.json',
  'https://cdn.jsdelivr.net/gh/pantsbang-yannik/sonorus@main/latest.json'
]

export const FETCH_TIMEOUT_MS = 8000
/** 启动后首查延迟：让位于首帧渲染与权限流（spec） */
export const INITIAL_DELAY_MS = 15_000
export const CHECK_INTERVAL_MS = 24 * 3600 * 1000

export class UpdateChecker {
  constructor(
    private urls: readonly string[] = LATEST_JSON_URLS,
    private fetchFn: typeof fetch = fetch
  ) {}

  /** 逐源尝试，取到首个合法清单即返；全失败/全非法 → null（本次静默放弃，spec：不打扰不上报）。
   * 请求是纯 GET 静态文件，不带任何标识参数（零上报铁律） */
  async fetchManifest(): Promise<UpdateManifest | null> {
    for (const url of this.urls) {
      const manifest = sanitizeManifest(await this.fetchJson(url))
      if (manifest) return manifest
    }
    return null
  }

  /** 非 200 / 超时 / 网络异常 / 非 JSON → null（回退链下一源，lyrics fetchJson 同款） */
  private async fetchJson(url: string): Promise<unknown | null> {
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }
}

export interface ScheduleTimers {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (id: ReturnType<typeof setInterval>) => void
}

/** 检查调度：启动延迟一次 + 定时循环；返回 stop 供 before-quit 收尾。
 * setInterval 睡眠唤醒会漂移，可接受——下次启动必查（spec 边界） */
export function startUpdateSchedule(
  run: () => void,
  timers: ScheduleTimers = { setTimeout, clearTimeout, setInterval, clearInterval },
  initialDelayMs: number = INITIAL_DELAY_MS,
  intervalMs: number = CHECK_INTERVAL_MS
): () => void {
  const first = timers.setTimeout(run, initialDelayMs)
  const loop = timers.setInterval(run, intervalMs)
  return () => {
    timers.clearTimeout(first)
    timers.clearInterval(loop)
  }
}
