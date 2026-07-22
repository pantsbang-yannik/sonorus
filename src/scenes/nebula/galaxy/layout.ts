// 时间星旋布局（spec §五）：位置只由 rank（首听顺序）与 key 哈希决定——确定性、旧星永不挪窝。
// 常量为亲验旋钮：改这里收敛观感，勿在调用方散写数字。
import { hash01 } from '../cover-points'

export interface StarPlacement { x: number; y: number; z: number }

export const ARM_COUNT = 2        // 旋臂数
export const LAYOUT_R0 = 0.5      // 核心起始半径（fb1 亲验调参：稀疏期星距 > 2σ 不融团，原 0.35 太挤）
export const LAYOUT_K = 0.17      // 半径增速（r = R0 + K·√rank，封顶 2.45 防出软边界；fb1 从 0.09 拉开，同 rank 邻星不再糊团）
export const LAYOUT_TWIST = 2.6   // 螺线扭转（rad / 单位半径；fb1 从 2.2 微调配合更宽的臂距）
export const DISK_THICKNESS = 0.12 // 薄盘厚度：y = (hash-0.5)×此值,即 |y| < 此值一半(哈希项就是全部 y,无额外叠加)
export const JITTER = 0.07        // 径向/切向抖动幅度

/** 字符串 → 数值种子（确定性；配 hash01 出三通道抖动） */
function seedOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1_000_003
  return h + 1 // 避开 0（hash01(0)=0 退化）
}

export function layoutGalaxy(keys: string[]): StarPlacement[] {
  return keys.map((key, i) => {
    const s = seedOf(key)
    // 「向外生长」是宏观趋势：抖动幅度(±JITTER)大于相邻 rank 的基础半径差,相邻两星可局部互换内外——有意设计(spec §五:半径上叠加稳定抖动,时间叙事只需核心旧/边缘新的宏观序),勿因强单调假设"修复"抖动
    // 封顶 2.45:超大曲库外圈不出软边界(bound 2.7),晚期新星挤在外环带可接受
    const r = Math.min(2.45, LAYOUT_R0 + LAYOUT_K * Math.sqrt(i)) + (hash01(s * 1.37) - 0.5) * JITTER * 2
    const theta = (i % ARM_COUNT) * ((Math.PI * 2) / ARM_COUNT) + r * LAYOUT_TWIST
      + (hash01(s * 2.71) - 0.5) * (JITTER * 2 / Math.max(r, 0.2)) // 切向抖动按半径归一（内圈弧短）
    return {
      x: Math.cos(theta) * r,
      y: (hash01(s * 3.14) - 0.5) * DISK_THICKNESS,
      z: Math.sin(theta) * r,
    }
  })
}

/** 最外星理论半径 + 抖动余量（GalaxyCamera 基准距离用；稀疏态半径小 → 镜头自然贴近） */
export function galaxyRadius(count: number): number {
  return Math.max(0.6, Math.min(2.45, LAYOUT_R0 + LAYOUT_K * Math.sqrt(Math.max(0, count - 1))) + JITTER)
}
