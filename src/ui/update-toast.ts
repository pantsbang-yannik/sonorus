// 更新提示（发布准备② spec）：可选更新=右下角轻提示卡（不打断画面，无自动消失——更新低频错过成本高）；
// 强更=不可关闭的阻断层。动作全部上行（openDownload/skip 经 IPC 回主进程），本组件不做版本判断。
// 风格随 savedToast/MediaPreview：暗玻璃卡 + 文字按钮 + opacity/blur 显影；显隐用显式属性写（FakeEl 测试惯例）。
const FONT = `-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`
const TRANSITION = `opacity 400ms cubic-bezier(0.33, 1, 0.68, 1), filter 400ms cubic-bezier(0.33, 1, 0.68, 1)`

export interface UpdateManifestView {
  version: string
  minVersion: string
  publishedAt: string | null
  notes: string | null
  downloadUrl: string
  mirrorUrl: string | null
}

/** 主进程 update:status 载荷（preload onUpdateStatus 同构）：none/unreachable 只在手动检查时出现。
 * 判别字面量逐成员拆开——kind 为联合字面量时 TS 控制流收窄不掉无清单分支 */
export type UpdateStatusMsg =
  | { kind: 'optional'; manual: boolean; manifest: UpdateManifestView }
  | { kind: 'forced'; manual: boolean; manifest: UpdateManifestView }
  | { kind: 'none'; manual: true }
  | { kind: 'unreachable'; manual: true }

export interface UpdateNoticeDeps {
  openDownload: (url: string) => void
  skip: (version: string) => void
  /** 手动检查的「已是最新 / 检查失败」回音，复用装配层通用轻提示 */
  showMessage: (text: string) => void
  /** 强更阻断上报模态（Esc 仲裁 + 面板退台语义，同 MediaPreview 装配层包裹先例） */
  setModal: (open: boolean) => void
}

function textButton(label: string, role: string, emphasized: boolean, onClick: () => void): HTMLElement {
  const el = document.createElement('span')
  el.textContent = label
  el.setAttribute('data-role', role)
  const base = emphasized ? 0.85 : 0.55
  el.style.cssText = `cursor: pointer; pointer-events: auto; font-size: 13px;
    font-weight: ${emphasized ? 400 : 300}; letter-spacing: 0.06em; color: rgba(255, 255, 255, ${base});`
  el.addEventListener('click', onClick)
  el.addEventListener('mouseenter', () => { el.style.color = 'rgba(255, 255, 255, 0.95)' })
  el.addEventListener('mouseleave', () => { el.style.color = `rgba(255, 255, 255, ${base})` })
  return el
}

export class UpdateNotice {
  private card: HTMLElement
  private cardTitle: HTMLElement
  private cardNotes: HTMLElement
  private cardMirrorBtn: HTMLElement
  private forced: HTMLElement
  private forcedTitleEl: HTMLElement
  private forcedMirrorBtn: HTMLElement
  private manifest: UpdateManifestView | null = null
  private forcedShown = false

  constructor(parent: HTMLElement, private deps: UpdateNoticeDeps) {
    // ---- 可选更新轻提示卡（右下角；bottom 预留操作坞高度） ----
    this.card = document.createElement('div')
    this.card.setAttribute('data-role', 'update-card')
    this.card.style.cssText = `position: fixed; right: 24px; bottom: 96px; max-width: 320px;
      padding: 14px 18px; border-radius: 10px; background: rgba(20, 26, 36, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      font-family: ${FONT}; z-index: 9996; transition: ${TRANSITION};`
    this.card.style.opacity = '0'
    this.card.style.filter = 'blur(6px)'
    this.card.style.pointerEvents = 'none'

    this.cardTitle = document.createElement('div')
    this.cardTitle.setAttribute('data-role', 'update-card-title')
    this.cardTitle.style.cssText = `color: rgba(255, 255, 255, 0.9); font-size: 13px; font-weight: 400;
      letter-spacing: 0.04em; margin-bottom: 4px;`
    this.card.appendChild(this.cardTitle)

    this.cardNotes = document.createElement('div')
    this.cardNotes.setAttribute('data-role', 'update-card-notes')
    this.cardNotes.style.cssText = `color: rgba(255, 255, 255, 0.55); font-size: 12px; font-weight: 300;
      letter-spacing: 0.03em; margin-bottom: 10px; white-space: pre-line;`
    this.card.appendChild(this.cardNotes)

    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 20px; align-items: center; flex-wrap: wrap;'
    row.appendChild(textButton('下载', 'update-btn-download', true, () => {
      if (this.manifest) this.deps.openDownload(this.manifest.downloadUrl)
    }))
    this.cardMirrorBtn = textButton('镜像下载', 'update-btn-mirror', false, () => {
      if (this.manifest?.mirrorUrl) this.deps.openDownload(this.manifest.mirrorUrl)
    })
    row.appendChild(this.cardMirrorBtn)
    row.appendChild(textButton('跳过此版本', 'update-btn-skip', false, () => {
      if (this.manifest) this.deps.skip(this.manifest.version)
      this.hideCard()
    }))
    row.appendChild(textButton('稍后', 'update-btn-later', false, () => this.hideCard()))
    this.card.appendChild(row)
    parent.appendChild(this.card)

    // ---- 强更阻断层（不可关闭；z 压过 tooltip 的 2147483000，真正高于一切，审②M2） ----
    this.forced = document.createElement('div')
    this.forced.setAttribute('data-role', 'update-forced')
    this.forced.style.cssText = `position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px; background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); font-family: ${FONT};
      z-index: 2147483200; transition: ${TRANSITION};`
    this.forced.style.opacity = '0'
    this.forced.style.filter = 'blur(6px)'
    this.forced.style.pointerEvents = 'none'
    this.forced.style.visibility = 'hidden'

    this.forcedTitleEl = document.createElement('div')
    this.forcedTitleEl.setAttribute('data-role', 'update-forced-title')
    this.forcedTitleEl.style.cssText = `color: rgba(255, 255, 255, 0.92); font-size: 16px; font-weight: 400; letter-spacing: 0.08em;`
    this.forced.appendChild(this.forcedTitleEl)

    const forcedSub = document.createElement('div')
    forcedSub.textContent = '请下载新版继续使用'
    forcedSub.style.cssText = `color: rgba(255, 255, 255, 0.55); font-size: 13px; font-weight: 300;
      letter-spacing: 0.05em; margin-bottom: 16px;`
    this.forced.appendChild(forcedSub)

    const forcedRow = document.createElement('div')
    forcedRow.style.cssText = 'display: flex; gap: 40px; align-items: center;'
    forcedRow.appendChild(textButton('前往下载', 'update-forced-download', true, () => {
      if (this.manifest) this.deps.openDownload(this.manifest.downloadUrl)
    }))
    this.forcedMirrorBtn = textButton('镜像下载', 'update-forced-mirror', false, () => {
      if (this.manifest?.mirrorUrl) this.deps.openDownload(this.manifest.mirrorUrl)
    })
    forcedRow.appendChild(this.forcedMirrorBtn)
    this.forced.appendChild(forcedRow)
    parent.appendChild(this.forced)
  }

  /** 唯一入口：主进程每条 update:status 都进这里；forced 一经出现压过一切后续 optional */
  handleStatus(msg: UpdateStatusMsg): void {
    // 合并判别（TS 收窄需要一次排除整个无清单分支）：none/unreachable 只是手动检查的回音
    if (msg.kind === 'none' || msg.kind === 'unreachable') {
      this.deps.showMessage(msg.kind === 'none' ? '已是最新版本' : '检查更新失败，请稍后再试')
      return
    }
    this.manifest = msg.manifest
    if (msg.kind === 'forced') {
      this.hideCard()
      this.showForced()
      return
    }
    if (this.forcedShown) return // 阻断层在场时忽略 optional（不该发生，纵深）
    this.showCard()
  }

  private showCard(): void {
    const m = this.manifest!
    this.cardTitle.textContent = `Audelyra ${m.version} 已发布`
    this.cardNotes.textContent = m.notes ?? ''
    this.cardNotes.style.display = m.notes ? 'block' : 'none'
    this.cardMirrorBtn.style.display = m.mirrorUrl ? 'inline' : 'none'
    this.card.style.opacity = '1'
    this.card.style.filter = 'blur(0)'
    this.card.style.pointerEvents = 'auto'
  }

  private hideCard(): void {
    this.card.style.opacity = '0'
    this.card.style.filter = 'blur(6px)'
    this.card.style.pointerEvents = 'none'
  }

  private showForced(): void {
    const m = this.manifest!
    this.forcedTitleEl.textContent = `当前版本已停止服务（需 ${m.version}+）`
    this.forcedMirrorBtn.style.display = m.mirrorUrl ? 'inline' : 'none'
    this.forced.style.visibility = 'visible'
    this.forced.style.opacity = '1'
    this.forced.style.filter = 'blur(0)'
    this.forced.style.pointerEvents = 'auto'
    if (!this.forcedShown) {
      this.forcedShown = true
      this.deps.setModal(true) // 只上报一次（renderer:ready 补发会重复进来，幂等）
    }
  }
}
