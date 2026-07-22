// 形状仲裁（spec §4.3，本期最谨慎的缝合点）：「显示什么」的唯一决定权。
// 纯函数——输入当前选择/开关/封面点云/粒子数，输出吸附目标与 kind；
// CoverController 只是生产者，setTargets 触发权全在编排层（评审 I2 职责切割）。
import type { ShapePointCloud } from '../cover-points'
import { generateShape, shapeById } from './index'
import type { ShapeId, ShapeSettings, DialectFamily, BodyKind } from './types'

export type ResolvedKind = 'cover' | 'custom' | 'geometry' | 'free' | 'linework'

export interface ResolvedShape {
  target: ShapePointCloud | null
  kind: ResolvedKind
  /** → uTargetPlanar（封面=薄板标定） */
  planar: boolean
  /** → uTargetHasColor（封面像素色接管 vs 情绪三色） */
  hasColor: boolean
  /** → kernel 家族权重门控 */
  dialect: DialectFamily
  /** 主体类型（线条系）：编排层据此做粒子↔线条交接；粒子路径恒 'particles' */
  body: BodyKind
}

export function resolveShape(opts: {
  current: ShapeId
  coverPriority: boolean
  coverCloud: ShapePointCloud | null
  /** 非 null = 用户选中的是自定义形状；cloud=null 表示加载中/失败（回退 free，就绪后 onCloudChanged 重仲裁） */
  custom: { cloud: ShapePointCloud | null; kind: 'image' | 'text' } | null
  count: number
}): ResolvedShape {
  if (opts.coverPriority && opts.coverCloud) {
    return { target: opts.coverCloud, kind: 'cover', planar: true, hasColor: true, dialect: 'none', body: 'particles' }
  }
  if (opts.custom) {
    const image = opts.custom.kind === 'image'
    // 自定义图片与文字都走薄板鼓面标定（planar:true → kernel lockW=1，xy 锁死转 z 浮雕，
    // 阅读性=封面同款）；hasColor 仍只图片为真——文字保持情绪三色，不接管像素色
    return opts.custom.cloud
      ? { target: opts.custom.cloud, kind: 'custom', planar: true, hasColor: image, dialect: 'none', body: 'particles' }
      : { target: null, kind: 'free', planar: false, hasColor: false, dialect: 'none', body: 'particles' }
  }
  const def = shapeById(opts.current)
  // 线条系（spec §④）：body 卡无点云目标，粒子回自由态淡出，线条画板登场；封面/自定义优先级不变（上方已短路）
  if (def.body && def.body !== 'particles') {
    return { target: null, kind: 'linework', planar: false, hasColor: false, dialect: 'none', body: def.body }
  }
  const target = generateShape(opts.current, opts.count)
  return target
    ? { target, kind: 'geometry', planar: false, hasColor: false, dialect: def.dialect, body: 'particles' }
    : { target: null, kind: 'free', planar: false, hasColor: false, dialect: 'none', body: 'particles' }
}

/** 溶解判据（N1 推广）：原「跨 cover 边界」的实质是标定 uniform（uTargetPlanar/uTargetHasColor）翻转
 * =亮度单帧爆白+颜色硬跳；custom 图片与封面同标定，故判据改为标志位比较——对既有形状行为逐值等价 */
export function planShapeSwap(
  applied: { planar: boolean; hasColor: boolean },
  next: { planar: boolean; hasColor: boolean }
): 'immediate' | 'dissolve' {
  return applied.planar !== next.planar || applied.hasColor !== next.hasColor ? 'dissolve' : 'immediate'
}

/** 形状选择真实变更判定（spec §4.6 防误唤醒铁律）：只有用户真改了选择才触发唤醒预览——
 * 启动播种（seeded=false）、档位重建重放（新场景 seeded 归 false）、无关设置广播（值相同）都不算 */
export function shapeSelectionChanged(prev: ShapeSettings, next: ShapeSettings, seeded: boolean): boolean {
  return seeded && (prev.current !== next.current || prev.customCurrent !== next.customCurrent || prev.coverPriority !== next.coverPriority)
}

/** refreshShape 的决策核（B1 终审记账抽取）：短路 / 溶解挂起 / 立即落地。
 * 纯函数——编排层唯一的新分支逻辑收敛于此，B2 选择器高频路径的回归由本函数用例拦截。 */
export type RefreshAction = 'skip' | 'dissolve' | 'immediate'

/** 就绪补切识别（S2 回账「补切仪式感」）：轮廓资产迟到就绪触发的 applyShape 重放，
 * 表现为「已播种、非用户切换、free→geometry|custom」——档位重建（appliedKind 保持原值）、
 * 换歌（cover 参与）、用户切换（snap=true 自有碎散聚）都不命中。
 * 命中后编排层：借快编排聚相成形（果断）+ 唤醒预览宽限（无音乐也看得到成形一幕） */
export function isBackfillReveal(prevKind: ResolvedKind, nextKind: ResolvedKind, seeded: boolean, snap: boolean): boolean {
  return seeded && !snap && prevKind === 'free' && (nextKind === 'geometry' || nextKind === 'custom')
}

export function planRefreshAction(opts: {
  appliedKind: ResolvedKind
  appliedPlanar: boolean
  appliedHasColor: boolean
  appliedBody: BodyKind
  /** undefined = 尚未应用（粒子重建后哨兵，强制重传）；null = free 已应用 */
  appliedTarget: ShapePointCloud | null | undefined
  next: ResolvedShape
  morph: number
  /** 用户主动切换（碎散聚快编排）：强制走溶解出散相 */
  snap: boolean
}): RefreshAction {
  if (opts.next.kind === opts.appliedKind && opts.next.target === opts.appliedTarget
    && opts.next.body === opts.appliedBody) return 'skip'
  const needDissolve =
    planShapeSwap({ planar: opts.appliedPlanar, hasColor: opts.appliedHasColor }, opts.next) === 'dissolve' || opts.snap
  return needDissolve && opts.morph > 0.02 ? 'dissolve' : 'immediate'
}
