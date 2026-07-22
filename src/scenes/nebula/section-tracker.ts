/** 段落检测：快均值（2s）对慢均值（8s）的台阶差超阈值 → 段落边沿。
 *  运镜铁律（4.6 第 5 条）的机制保障：机位只在段落边沿切换。 */
export class SectionTracker {
  private fast = 0
  private slow = 0
  private sinceEdge = Infinity
  private readonly minSectionSec: number
  private readonly threshold: number

  constructor(opts: { minSectionSec?: number; threshold?: number } = {}) {
    this.minSectionSec = opts.minSectionSec ?? 12
    this.threshold = opts.threshold ?? 0.18
  }

  update(energy: number, dt: number): boolean {
    const aFast = 1 - Math.exp(-dt / 2)
    const aSlow = 1 - Math.exp(-dt / 8)
    this.fast += aFast * (energy - this.fast)
    this.slow += aSlow * (energy - this.slow)
    this.sinceEdge += dt
    // 只认向上的台阶（副歌进入）；渐强时 fast/slow 同步爬升，差值小不触发
    if (this.fast - this.slow > this.threshold && this.sinceEdge >= this.minSectionSec) {
      this.sinceEdge = 0
      return true
    }
    return false
  }
}
