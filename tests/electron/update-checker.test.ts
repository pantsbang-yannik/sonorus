import { describe, it, expect, vi } from 'vitest'
import { UpdateChecker, startUpdateSchedule, type ScheduleTimers } from '../../electron/update/checker'

const GOOD = {
  version: '0.2.0', minVersion: '0.1.0', publishedAt: null, notes: null,
  downloadUrl: 'https://example.com/a.dmg', mirrorUrl: null
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response
}

describe('UpdateChecker 双源串行回退', () => {
  it('主源合法即返，备源不请求', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(GOOD))
    const c = new UpdateChecker(['https://a/latest.json', 'https://b/latest.json'], fetchFn as unknown as typeof fetch)
    expect(await c.fetchManifest()).toEqual(GOOD)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0]![0]).toBe('https://a/latest.json')
  })
  it('主源网络异常 → 落到备源', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce(jsonResponse(GOOD))
    const c = new UpdateChecker(['https://a', 'https://b'], fetchFn as unknown as typeof fetch)
    expect(await c.fetchManifest()).toEqual(GOOD)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
  it('主源非 200 / 清单非法 → 也落备源', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ version: 'bad' }))
    const c = new UpdateChecker(['https://a', 'https://b'], fetchFn as unknown as typeof fetch)
    expect(await c.fetchManifest()).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
  it('两源全失败 → null 静默', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'))
    const c = new UpdateChecker(['https://a', 'https://b'], fetchFn as unknown as typeof fetch)
    expect(await c.fetchManifest()).toBeNull()
  })
  it('json() 抛错（非 JSON 响应）→ null 不外抛', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('parse')) })
    const c = new UpdateChecker(['https://a'], fetchFn as unknown as typeof fetch)
    await expect(c.fetchManifest()).resolves.toBeNull()
  })
})

describe('startUpdateSchedule', () => {
  function fakeTimers(): { timers: ScheduleTimers; fireTimeout: () => void; fireInterval: () => void; cleared: string[] } {
    let timeoutFn: (() => void) | null = null
    let intervalFn: (() => void) | null = null
    const cleared: string[] = []
    const timers: ScheduleTimers = {
      setTimeout: (fn) => { timeoutFn = fn; return 1 as unknown as ReturnType<typeof setTimeout> },
      clearTimeout: () => { cleared.push('timeout') },
      setInterval: (fn) => { intervalFn = fn; return 2 as unknown as ReturnType<typeof setInterval> },
      clearInterval: () => { cleared.push('interval') }
    }
    return { timers, fireTimeout: () => timeoutFn?.(), fireInterval: () => intervalFn?.(), cleared }
  }

  it('启动延迟一次 + 定时循环各自触发 run', () => {
    const run = vi.fn()
    const { timers, fireTimeout, fireInterval } = fakeTimers()
    startUpdateSchedule(run, timers, 15000, 1000)
    expect(run).not.toHaveBeenCalled()
    fireTimeout()
    expect(run).toHaveBeenCalledTimes(1)
    fireInterval()
    fireInterval()
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('stop 同时清掉延迟与循环', () => {
    const { timers, cleared } = fakeTimers()
    const stop = startUpdateSchedule(() => {}, timers, 1, 1)
    stop()
    expect(cleared).toEqual(['timeout', 'interval'])
  })
})
