import { describe, it, expect } from 'vitest'
import { parsePlaybackProgress, ageProgress } from '../../electron/nowplaying/progress'

const NOW = Date.parse('2026-07-13T02:39:14Z')

describe('parsePlaybackProgress', () => {
  it('完整载荷全字段解析（快照新鲜：ts=now 零补偿）', () => {
    expect(parsePlaybackProgress(
      { elapsedTime: 12.5, duration: 240, playbackRate: 1, playing: true, timestamp: '2026-07-13T02:39:14Z' }, NOW
    )).toEqual({ elapsedTime: 12.5, duration: 240, playbackRate: 1, playing: true })
  })
  it('无 elapsedTime / 非有限数 → null', () => {
    expect(parsePlaybackProgress({ duration: 240 }, NOW)).toBeNull()
    expect(parsePlaybackProgress({ elapsedTime: NaN }, NOW)).toBeNull()
    expect(parsePlaybackProgress({ elapsedTime: '12' }, NOW)).toBeNull()
  })
  it('缺省回退：rate→1、playing→false、duration 非正/缺失→null、无 timestamp 原样', () => {
    expect(parsePlaybackProgress({ elapsedTime: 0 }, NOW))
      .toEqual({ elapsedTime: 0, duration: null, playbackRate: 1, playing: false })
    expect(parsePlaybackProgress({ elapsedTime: 3, duration: 0 }, NOW)!.duration).toBeNull()
    expect(parsePlaybackProgress({ elapsedTime: 3, playing: 1 }, NOW)!.playing).toBe(false)
  })

  // ==== 快照归一化（亲验 fb：网易云卡句/对不上的根因）====
  // MediaRemote 语义：elapsedTime 是 timestamp 时刻的位置快照，非当前位置。
  // 实测（雾里）：播放 97.8s 期间 get/事件反复返回同一旧快照 (42.54, 02:36:41)——
  // 当前位置必须换算 elapsedTime + (now − timestamp) × rate，否则轮询每 5s 把时钟拽回旧值。
  it('旧快照 + rate=1：按 (now−ts)×rate 归一到当前位置（轮询兜底去毒）', () => {
    const p = parsePlaybackProgress(
      { elapsedTime: 42.54, playbackRate: 1, playing: true, timestamp: '2026-07-13T02:36:41Z' },
      Date.parse('2026-07-13T02:38:19Z') // 快照后 98s
    )
    expect(p!.elapsedTime).toBeCloseTo(42.54 + 98, 3)
  })
  it('暂停事件携带播放期旧快照（playing=false rate=1 ts 旧）：仍按 rate 归一得到暂停点', () => {
    // 实测暂停事件载荷 = 暂停前快照原样 + playing 翻 false；到达时刻≈暂停时刻，归一即暂停位置
    const p = parsePlaybackProgress(
      { elapsedTime: 42.54, playbackRate: 1, playing: false, timestamp: '2026-07-13T02:36:41Z' },
      Date.parse('2026-07-13T02:38:19Z')
    )
    expect(p!.elapsedTime).toBeCloseTo(140.54, 2)
    expect(p!.playing).toBe(false)
  })
  it('rate=0 中间态 / 倍速：补偿量 = Δt×rate', () => {
    const stale = { elapsedTime: 10, playing: true, timestamp: '2026-07-13T02:39:04Z' } // 10s 前
    expect(parsePlaybackProgress({ ...stale, playbackRate: 0 }, NOW)!.elapsedTime).toBe(10)
    expect(parsePlaybackProgress({ ...stale, playbackRate: 2 }, NOW)!.elapsedTime).toBeCloseTo(30)
  })
  it('timestamp 非法/未来漂移下限护栏：非法原样；ts 略超 now（时钟毛刺）不倒扣', () => {
    expect(parsePlaybackProgress({ elapsedTime: 5, playbackRate: 1, timestamp: 'not-a-date' }, NOW)!.elapsedTime).toBe(5)
    expect(parsePlaybackProgress(
      { elapsedTime: 5, playbackRate: 1, timestamp: '2026-07-13T02:39:15Z' }, NOW // ts 比 now 晚 1s
    )!.elapsedTime).toBe(5)
  })
})

// ==== 冷启动补发老化（#歌词冷启动）：did-finish-load 补发缓存进度前按缓存龄外推 ====
// 根因取证：启动竞态下 stream 首帧 progress 早于渲染层加载 0.2-1.5s 发出即丢失，
// track/lyrics 各有补发缓存唯独 progress 没有——补发时缓存已老化，播放中必须外推到当前位置
describe('ageProgress', () => {
  const base = { elapsedTime: 100, duration: 240, playbackRate: 1, playing: true }
  it('播放中：elapsedTime += 缓存龄×rate（倍速同乘）', () => {
    expect(ageProgress(base, 1.5).elapsedTime).toBeCloseTo(101.5, 5)
    expect(ageProgress({ ...base, playbackRate: 2 }, 1.5).elapsedTime).toBeCloseTo(103, 5)
    expect(ageProgress(base, 1.5)).toMatchObject({ duration: 240, playbackRate: 1, playing: true })
  })
  it('暂停中不外推；零龄/负龄（时钟毛刺）原样', () => {
    expect(ageProgress({ ...base, playing: false }, 5).elapsedTime).toBe(100)
    expect(ageProgress(base, 0).elapsedTime).toBe(100)
    expect(ageProgress(base, -1).elapsedTime).toBe(100)
  })
  it('不改入参对象（补发用，缓存本体不得被污染）', () => {
    const p = { ...base }
    ageProgress(p, 3)
    expect(p.elapsedTime).toBe(100)
  })
})
