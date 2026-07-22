// galaxy/types.ts —— 星系图鉴共享类型（渲染层侧 PlayRecord 独立声明，惯例同 RendererSettings）
export interface GalaxyPlayRecord {
  title: string
  artist: string
  duration: number | null
  listenedSeconds: number
  endedAt: string           // ISO
  artworkKey: string | null
}
export interface GalaxyDay { date: string; count: number; seconds: number } // date=本地时区 YYYY-MM-DD
export interface GalaxyStar {
  key: string               // `${title}\0${artist}`，与歌词/track 去重键同构
  title: string
  artist: string
  playCount: number
  totalListenedSeconds: number
  firstAt: string           // ISO（最早一条 endedAt）
  lastAt: string            // ISO（最晚一条 endedAt）
  days: GalaxyDay[]         // 升序
  artworkKey: string | null
  tint: [number, number, number] | null // 线性 rgb 0..1，封面主色；aggregate 置 null，main.ts 装配时回填
}
export type GalaxyFilter = { kind: 'all' } | { kind: 'range'; days: 7 | 30 } | { kind: 'day'; date: string }
export interface GalaxyFilterView { activeKeys: string[]; trailKeys: string[] }
export interface GalaxyView {
  active: boolean
  stars: GalaxyStar[]
  filterView: GalaxyFilterView | null   // null = 全部（无筛选态）
  selectedKey: string | null
  onPick?: (key: string | null) => void // 场景拾取上报；null=点空
  onHover?: (hit: { key: string; x: number; y: number } | null) => void // 悬停星+星心屏幕坐标(CSS px)逐帧上报；null=未悬停（fb2 悬浮信息条）
}
