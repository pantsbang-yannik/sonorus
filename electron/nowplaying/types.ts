export interface TrackMeta {
  title: string
  artist: string
  /**
   * 封面位图字节，可能为 null。
   * 注意：字段名沿用契约中的 artworkPng，但 MediaRemote 实际交付的字节
   * 可能是 JPEG/PNG/HEIC 等（以系统上报的 artworkMime 为准，见下）。
   * 封面可能在 title/artist 之后异步到达：同一首歌会先收到一次无封面的
   * change，封面就绪后再收到一次带封面的 change。
   */
  artworkPng: Buffer | null
  /** 系统上报的封面 MIME（如 "image/jpeg"），media-control 未给出时为 null——由调用方按魔数兜底判定 */
  artworkMime: string | null
  /** 歌曲总时长（秒）；载荷缺失为 null。歌词服务用它做版本校验（spec §4），不参与去重键 */
  duration: number | null
}

export type TrackEvent = { kind: 'change'; meta: TrackMeta } | { kind: 'unknown' }
