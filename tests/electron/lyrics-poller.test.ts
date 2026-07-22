import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgressPoller } from '../../electron/lyrics/poller'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createProgressPoller', () => {
  it('start 后按间隔 readOnce→解析→emit；stop 停止', async () => {
    const emitted: unknown[] = []
    const poller = createProgressPoller({
      intervalMs: 5000,
      readOnce: async () => ({ elapsedTime: 42, playing: true }),
      onProgress: (p) => emitted.push(p)
    })
    poller.start()
    expect(poller.running()).toBe(true)
    await vi.advanceTimersByTimeAsync(5100)
    expect(emitted).toHaveLength(1)
    expect((emitted[0] as { elapsedTime: number }).elapsedTime).toBe(42)
    poller.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(emitted).toHaveLength(1)
    expect(poller.running()).toBe(false)
  })
  it('start 幂等（重复调用不叠加计时器）；readOnce null/无进度字段静默跳过', async () => {
    const emitted: unknown[] = []
    let payload: Record<string, unknown> | null = null
    const poller = createProgressPoller({
      intervalMs: 5000,
      readOnce: async () => payload,
      onProgress: (p) => emitted.push(p)
    })
    poller.start()
    poller.start()
    await vi.advanceTimersByTimeAsync(5100)
    expect(emitted).toHaveLength(0) // null 跳过
    payload = { title: 'x' } // 无 elapsedTime
    await vi.advanceTimersByTimeAsync(5000)
    expect(emitted).toHaveLength(0)
    payload = { elapsedTime: 1 }
    await vi.advanceTimersByTimeAsync(5000)
    expect(emitted).toHaveLength(1) // 且非双份（幂等验证）
  })
})
