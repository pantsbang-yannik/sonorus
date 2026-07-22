// LRC 歌词解析（歌词二期 spec §4）。纯函数零依赖——electron/lyrics/providers.ts 复用，
// 必须保持零 DOM/three import（camera-types 纪律）。
export interface LyricLine {
  /** 该句起点（秒）。句无显式终点：句窗 = [t_i, t_{i+1})，末句到曲终 */
  t: number
  text: string
}

/** 行首连续时间标签：[mm:ss] / [mm:ss.xx] / [mm:ss.xxx]，分钟允许超两位 */
const HEAD_TAG = /^\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/

export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const times: number[] = []
    let rest = line
    let m: RegExpExecArray | null
    while ((m = HEAD_TAG.exec(rest))) {
      times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]))
      rest = rest.slice(m[0].length)
    }
    const text = rest.trim()
    // 元信息标签行（[ar:] 等）不匹配时间标签 → times 空；纯时间戳空文本行 → text 空。两类都滤掉
    if (times.length === 0 || text === '') continue
    for (const t of times) out.push({ t, text })
  }
  out.sort((a, b) => a.t - b.t)
  return out.filter((l, i) => i === 0 || l.t !== out[i - 1].t)
}
