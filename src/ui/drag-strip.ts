// DragStrip —— 普通窗顶部 28px 隐形拖拽条（2026-07-06 拍板：小窗/整窗拖拽泵退役，
// 改用 OS 原生 `-webkit-app-region: drag` 幽灵标题栏，移窗交给系统而非渲染层）。
//
// 已知取舍：OS 级拖拽区会吞掉本条内的 DOM 鼠标事件（这也是当初弃用 CSS app-region、
// 改走手动拖拽泵的原因——见已删除的 electron/drag.ts）；本轮用户拍板顶部 28px 让渡给移窗，
// 该区域内不再指望收到点击/双击。macOS 下双击拖拽区可能触发系统 zoom 行为，属已知边缘情况。
export class DragStrip {
  private readonly el: HTMLElement

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.id = 'drag-strip'
    this.el.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 28px;
      pointer-events: auto;
      display: none;
    `
    ;(this.el.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'drag'
    parent.appendChild(this.el)
  }

  /** windowed 显示（可拖窗）；fullscreen 隐藏（不需要移窗，且避免顶部 28px 吞掉运镜手势） */
  setMode(m: 'fullscreen' | 'windowed'): void {
    this.el.style.display = m === 'windowed' ? 'block' : 'none'
  }

  dispose(): void {
    this.el.remove()
  }
}
