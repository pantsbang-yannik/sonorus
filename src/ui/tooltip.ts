/**
 * 给图标按钮挂上悬停显影的自定义 tooltip——替代浏览器原生 title 提示，贴合产品气质。
 * 统一显影（opacity/filter blur）、统一字体、半透明深色 + backdrop-blur。
 * tooltip 节点 position:fixed、pointer-events:none；placement 决定挂靠方向：
 * 'top'（默认，操作坞在右下角，朝上不出屏）在 target 上方、水平居中；
 * 'bottom'（右上角全屏按钮，朝上会出界）在 target 下方、水平居中；
 * 'left'（贴右边缘的面板内信息图标，朝右会出屏）在 target 左侧、垂直居中。
 * 第 4 参 shortcut 追加弱化快捷键后缀。
 * @returns cleanup 函数：移除监听并摘除 tooltip 节点，防泄漏（rebuild/dispose 时调用）
 */
export function attachTooltip(target: HTMLElement, text: string, placement: 'top' | 'bottom' | 'left' = 'top', shortcut?: string): () => void {
  let tip: HTMLElement | null = null

  const ensureTip = (): HTMLElement => {
    if (tip) return tip
    const el = document.createElement('div')
    el.setAttribute('data-tooltip', '')
    el.textContent = text
    el.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483000;
      padding: 4px 9px;
      border-radius: 6px;
      background: rgba(20, 20, 26, 0.72);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: rgba(255, 255, 255, 0.85);
      font-family: -apple-system, "SF Pro Display", sans-serif;
      font-weight: 300;
      font-size: 12px;
      letter-spacing: 0.06em;
      white-space: nowrap;
      opacity: 0;
      filter: blur(6px);
      transition: opacity 180ms cubic-bezier(0.33, 1, 0.68, 1),
                  filter 180ms cubic-bezier(0.33, 1, 0.68, 1);
    `
    if (shortcut) {
      const kbd = document.createElement('span')
      kbd.textContent = shortcut
      kbd.style.cssText = 'opacity: 0.55; margin-left: 7px; font-size: 11px; letter-spacing: 0.08em;'
      el.appendChild(kbd)
    }
    document.body.appendChild(el)
    tip = el
    return el
  }

  const onEnter = (): void => {
    const el = ensureTip()
    const rect = target.getBoundingClientRect()
    if (placement === 'left') {
      el.style.left = `${rect.left - 8}px`
      el.style.top = `${rect.top + rect.height / 2}px`
      el.style.transform = 'translate(-100%, -50%)'
    } else {
      el.style.left = `${rect.left + rect.width / 2}px`
      if (placement === 'bottom') {
        el.style.top = `${rect.bottom + 8}px`
        el.style.transform = 'translate(-50%, 0)'
      } else {
        el.style.top = `${rect.top - 8}px`
        el.style.transform = 'translate(-50%, -100%)'
      }
    }
    // 强制回流，确保首次 hover 也能从 opacity:0 平滑淡入而非瞬现
    void el.offsetWidth
    el.style.opacity = '1'
    el.style.filter = 'blur(0)'
  }

  const onLeave = (): void => {
    if (!tip) return
    tip.style.opacity = '0'
    tip.style.filter = 'blur(6px)'
  }

  target.addEventListener('mouseenter', onEnter)
  target.addEventListener('mouseleave', onLeave)

  return () => {
    target.removeEventListener('mouseenter', onEnter)
    target.removeEventListener('mouseleave', onLeave)
    if (tip) { tip.remove(); tip = null }
  }
}
