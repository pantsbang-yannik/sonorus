// 播放进度纯解析（歌词二期 spec §3）：media-control 载荷 → PlaybackProgress。
// 纯 node 零依赖——mac.ts（stream 事件流）与 lyrics/poller.ts（get 轮询兜底）共用同一解析。
//
// 快照归一化（亲验 fb 根因修复）：MediaRemote 的 elapsedTime 是 timestamp 时刻的位置快照，
// **不是当前位置**——实测（网易云·雾里）播放 97.8s 期间事件与 get 轮询反复返回同一旧快照
// (42.54, 02:36:41)，暂停事件载荷也是暂停前快照原样。当前位置必须换算：
//   elapsedTime + (now − timestamp) × playbackRate
// 在本解析层归一后下发，下游（外插钟/轮询/渲染）全部拿到"当前位置"语义，轮询兜底才成立。
// 不按 playing 门控补偿：暂停事件到达时刻≈暂停时刻，按 rate 归一恰好得到暂停点位置。
export interface PlaybackProgress {
  elapsedTime: number
  /** 秒；载荷缺失或非正数 → null（部分播放器不上报时长） */
  duration: number | null
  playbackRate: number
  playing: boolean
}

/** 补发老化（#歌词冷启动）：did-finish-load 补发缓存进度前按缓存龄外推到当前位置。
 * 播放中才外推（暂停快照本就是当前位置）；负龄=时钟毛刺，钳 0 不倒扣（同 parse 层护栏语义） */
export function ageProgress(p: PlaybackProgress, ageSec: number): PlaybackProgress {
  if (!p.playing || ageSec <= 0) return p
  return { ...p, elapsedTime: p.elapsedTime + ageSec * p.playbackRate }
}

export function parsePlaybackProgress(p: Record<string, unknown>, nowMs: number): PlaybackProgress | null {
  const t = p['elapsedTime']
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  const dur = p['duration']
  const rate = p['playbackRate']
  const rateNum = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1
  // 快照年龄补偿：timestamp 非法/缺失 → 0（退回原样）；ts 略超 now（时钟毛刺）钳 0 不倒扣
  const ts = typeof p['timestamp'] === 'string' ? Date.parse(p['timestamp']) : NaN
  const ageSec = Number.isFinite(ts) ? Math.max(0, (nowMs - ts) / 1000) : 0
  return {
    elapsedTime: t + ageSec * rateNum,
    duration: typeof dur === 'number' && Number.isFinite(dur) && dur > 0 ? dur : null,
    playbackRate: rateNum,
    playing: p['playing'] === true
  }
}
