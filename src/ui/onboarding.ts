// src/ui/onboarding.ts
// 首启引导——星云舞台上的一幕，四幕（intro/listening/denied/success）由 OnboardingLogic 驱动。
// 发布准备③新增「序幕」：四幕之前的进化史变形秀（onboarding-demo 剧本），点击推进、可跳过，
// 终点站（星云）落幕交给 intro 幕。序幕不改四幕文案与交互（已验收），只后移 intro 的出场时机。
// 结构跟随 M3 角标同款模糊显影语言（track-badge.ts / settings-panel.ts 同款 transition）：
// 容器默认 pointer-events: none（不挡舞台交互），仅按钮与序幕点击层显式开 auto。
import { OnboardingLogic, type OnboardingState } from './onboarding-logic'

/** 序幕接线（发布准备③）：剧本状态与形体切换全在外部（onboarding-demo + 编排层），本层只管点击与显影 */
export interface OnboardingPrologueDeps {
  /** 推进一站；返回 true = 已到终点（星云），序幕落幕、intro 显影 */
  advance: () => boolean
  /** 直达终点（外部负责把形体切到位） */
  skip: () => void
  /** 当前站引导文案（③亲验反馈：逐站换词）；空串=无文案 */
  hint: () => string
  /** 切换配乐静音（亲验反馈轮②）；返回切换后的静音态（true=已静音），按钮据此换标签 */
  toggleAudio: () => boolean
}

export interface OnboardingDeps {
  parent: HTMLElement
  latestHasAudio: () => boolean // 原始 PCM 帧能量探针（pcm-energy）——demo 回放灌 bus 不会造成假成功
  hasTrack: () => boolean // onTrack 缓存的最近事件 kind === 'change'
  restartCapture: () => void
  openAudioPrefs: () => void
  /** null = 无序幕（demo 资产缺失），保持四幕现状直接 intro */
  prologue: OnboardingPrologueDeps | null
  onOpenStateChanged: (open: boolean) => void // 接 setModalOpen（同 T8 面板）；③起不再退台——序幕要全亮表演
  onDone: () => void // 写 onboarded 标记由调用方做
}

const SAMPLE_INTERVAL_MS = 250
const SUCCESS_HOLD_MS = 1200
const FADE_MS = 500
const FONT = `-apple-system, "SF Pro Display", sans-serif`
const SCENE_TRANSITION = `
  transition: opacity ${FADE_MS}ms cubic-bezier(0.33, 1, 0.68, 1),
              filter ${FADE_MS}ms cubic-bezier(0.33, 1, 0.68, 1);
`
const BTN_BASE_OPACITY = '0.55'
const BTN_HOVER_OPACITY = '0.85'

/** 细体文字按钮——跟随 settings-panel 选项同款交互（cursor pointer + hover 提亮，无过渡动画）。
 * 导出供 idle-hint 复用（发布准备③：空状态权限指引与 denied 幕同款按钮语言） */
export function makeTextButton(label: string, onClick: () => void): HTMLElement {
  const el = document.createElement('span')
  el.textContent = label
  el.style.cssText = `
    cursor: pointer;
    pointer-events: auto;
    font-size: 13px;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, ${BTN_BASE_OPACITY});
  `
  el.addEventListener('click', onClick)
  el.addEventListener('mouseenter', () => { el.style.color = `rgba(255, 255, 255, ${BTN_HOVER_OPACITY})` })
  el.addEventListener('mouseleave', () => { el.style.color = `rgba(255, 255, 255, ${BTN_BASE_OPACITY})` })
  return el
}

/** 幽灵按钮——透明底 + 细描边胶囊，intro 幕唯一主行动点用（denied 幕的次级操作仍用文字按钮） */
function makeGhostButton(label: string, onClick: () => void): HTMLElement {
  const el = document.createElement('span')
  el.textContent = label
  el.style.cssText = `
    cursor: pointer;
    pointer-events: auto;
    font-size: 13px;
    font-weight: 300;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.75);
    padding: 9px 36px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 999px;
    transition: border-color 200ms ease, color 200ms ease, background-color 200ms ease;
  `
  el.addEventListener('click', onClick)
  el.addEventListener('mouseenter', () => {
    el.style.borderColor = 'rgba(255, 255, 255, 0.6)'
    el.style.color = 'rgba(255, 255, 255, 0.95)'
    el.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
  })
  el.addEventListener('mouseleave', () => {
    el.style.borderColor = 'rgba(255, 255, 255, 0.28)'
    el.style.color = 'rgba(255, 255, 255, 0.75)'
    el.style.backgroundColor = 'transparent'
  })
  return el
}

/** 一幕的居中容器——四幕重叠铺满，同一时刻只有一幕经 opacity/filter 显影可见。
 * 导出供 idle-hint 复用（发布准备③：同一显影语言） */
export function makeSceneWrapper(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 12px;
    pointer-events: none;
    opacity: 0;
    filter: blur(6px);
    visibility: hidden;
    font-family: ${FONT};
    ${SCENE_TRANSITION}
  `
  return el
}

export function runOnboarding(deps: OnboardingDeps): { dispose: () => void } {
  const logic = new OnboardingLogic()

  const container = document.createElement('div')
  container.id = 'onboarding'
  container.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
  `

  // ===== intro 幕：字标 + 副文案 + 唯一按钮「开始」=====
  const introScene = makeSceneWrapper()
  const title = document.createElement('div')
  title.textContent = 'AUDELYRA'
  title.style.cssText = `
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 300;
    letter-spacing: 0.35em;
    color: rgba(255, 255, 255, 0.9);
  `
  const subtitle = document.createElement('div')
  subtitle.textContent = '让声音显形'
  subtitle.style.cssText = `
    font-size: 14px;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 20px;
  `
  const startBtn = makeGhostButton('开始', () => {
    logic.start()
    deps.restartCapture() // 拉起 tap 触发系统授权弹窗
    render()
  })
  introScene.append(title, subtitle, startBtn)

  // ===== listening 幕：随 logic 输出显影切换的一行状态文字 =====
  const listeningScene = makeSceneWrapper()
  const statusEl = document.createElement('div')
  statusEl.style.cssText = `
    font-size: 15px;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.7);
  `
  listeningScene.append(statusEl)

  // ===== denied 幕：指引文案 + 「打开系统设置」「重试」=====
  const deniedScene = makeSceneWrapper()
  const deniedLine1 = document.createElement('div')
  deniedLine1.textContent = 'Audelyra 需要「系统音频录制」权限'
  deniedLine1.style.cssText = `
    font-size: 15px;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.85);
  `
  const deniedLine2 = document.createElement('div')
  deniedLine2.textContent = '系统设置 → 隐私与安全性 → 系统音频录制，打开 Audelyra'
  deniedLine2.style.cssText = `
    font-size: 12px;
    font-weight: 300;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 20px;
  `
  const deniedButtons = document.createElement('div')
  deniedButtons.style.cssText = 'display: flex; gap: 32px;'
  const openPrefsBtn = makeTextButton('打开系统设置', () => deps.openAudioPrefs())
  const retryBtn = makeTextButton('重试', () => {
    deps.restartCapture()
    logic.retry()
    render()
  })
  deniedButtons.append(openPrefsBtn, retryBtn)
  deniedScene.append(deniedLine1, deniedLine2, deniedButtons)

  // ===== success 幕：「听到了」显影后整幕淡出落幕 =====
  const successScene = makeSceneWrapper()
  const successText = document.createElement('div')
  successText.textContent = '听到了'
  successText.style.cssText = `
    font-size: clamp(20px, 3vw, 32px);
    font-weight: 300;
    letter-spacing: 0.2em;
    color: rgba(255, 255, 255, 0.9);
  `
  successScene.append(successText)

  // ===== 序幕（发布准备③）：全屏点击层 + 弱提示 + 跳过，形体切换经 deps.prologue 回调外部 =====
  let inPrologue = deps.prologue !== null
  let clickLayer: HTMLElement | null = null
  let prologueScene: HTMLElement | null = null
  let skipBtn: HTMLElement | null = null
  let muteBtn: HTMLElement | null = null
  if (deps.prologue) {
    const prologue = deps.prologue
    // 点击层避开顶部 28px 拖拽区（铁律：拖拽区内不放可点元素）；先挂——四幕按钮层叠其上不受影响
    clickLayer = document.createElement('div')
    clickLayer.setAttribute('data-role', 'onboarding-prologue-click')
    clickLayer.style.cssText = `
      position: absolute;
      inset: 28px 0 0 0;
      pointer-events: auto;
      cursor: pointer;
    `
    prologueScene = makeSceneWrapper()
    const hintEl = document.createElement('div')
    hintEl.setAttribute('data-role', 'onboarding-prologue-hint')
    hintEl.textContent = prologue.hint() // 首站文案（逐站换词的单一来源在 onboarding-demo）
    hintEl.style.cssText = `
      position: absolute;
      bottom: 18vh;
      font-size: 13px;
      font-weight: 300;
      letter-spacing: 0.1em;
      color: rgba(255, 255, 255, 0.45);
      opacity: 0;
      transition: opacity 800ms cubic-bezier(0.33, 1, 0.68, 1);
    `
    prologueScene.appendChild(hintEl)
    skipBtn = makeTextButton('跳过', () => {
      prologue.skip()
      endPrologue()
    })
    skipBtn.setAttribute('data-role', 'onboarding-prologue-skip')
    skipBtn.style.position = 'absolute'
    skipBtn.style.right = '28px'
    skipBtn.style.bottom = '28px'
    // 配乐静音钮（亲验反馈轮②）：跳过左侧同排；标签随静音态翻转
    muteBtn = makeTextButton('关闭音乐', () => {
      const muted = prologue.toggleAudio()
      muteBtn!.textContent = muted ? '打开音乐' : '关闭音乐'
    })
    muteBtn.setAttribute('data-role', 'onboarding-prologue-mute')
    muteBtn.style.position = 'absolute'
    muteBtn.style.right = '96px'
    muteBtn.style.bottom = '28px'
    clickLayer.addEventListener('click', () => {
      if (!inPrologue) return
      if (prologue.advance()) { endPrologue(); return }
      // 逐站换词（③亲验反馈）：叙事推着点击走；首点若早于 3s 淡入定时器也直接显影——用户已会点击
      hintEl.textContent = prologue.hint()
      hintEl.style.opacity = '1'
    })
    container.append(clickLayer, prologueScene, skipBtn, muteBtn)
  }

  container.append(introScene, listeningScene, deniedScene, successScene)
  deps.parent.appendChild(container)

  const scenes: Record<OnboardingState, HTMLElement> = {
    intro: introScene,
    listening: listeningScene,
    denied: deniedScene,
    success: successScene
  }

  let lastState: OnboardingState | null = null
  const pendingTimers: ReturnType<typeof setTimeout>[] = []
  let disposed = false
  let doneNotified = false

  /** 序幕开演：第一站显影 + 3s 后淡入点击提示（提示元素在幕内，随幕显影语言走） */
  function startPrologue(): void {
    if (!prologueScene) return
    prologueScene.style.visibility = 'visible'
    prologueScene.style.opacity = '1'
    prologueScene.style.filter = 'blur(0)'
    const hint = prologueScene.firstElementChild as HTMLElement | null
    pendingTimers.push(setTimeout(() => { if (hint) hint.style.opacity = '1' }, 3000))
  }

  /** 序幕落幕：点击层/提示/跳过全部退场，intro 幕接管（render 恢复常规四幕显影） */
  function endPrologue(): void {
    if (!inPrologue) return
    inPrologue = false
    if (clickLayer) clickLayer.style.pointerEvents = 'none'
    if (prologueScene) {
      prologueScene.style.visibility = 'hidden'
      prologueScene.style.opacity = '0'
      prologueScene.style.filter = 'blur(6px)'
    }
    if (skipBtn) skipBtn.style.display = 'none'
    if (muteBtn) muteBtn.style.display = 'none'
    render()
  }

  // 幕容器始终 pointer-events: none，仅按钮自身 auto（makeTextButton）——
  // 非激活幕 visibility: hidden 会被幕内元素继承，按钮随之不可命中，无需动容器的 pointerEvents
  function showScene(name: OnboardingState): void {
    for (const key of Object.keys(scenes) as OnboardingState[]) {
      const el = scenes[key]
      if (key === name) {
        el.style.visibility = 'visible'
        el.style.opacity = '1'
        el.style.filter = 'blur(0)'
      } else {
        el.style.visibility = 'hidden'
        el.style.opacity = '0'
        el.style.filter = 'blur(6px)'
      }
    }
  }

  function updateListeningText(): void {
    statusEl.textContent = logic.needsMusicHint ? '放一首歌试试' : '正在聆听系统声音…'
  }

  /** 装饰性落幕（1.2s hold + 淡出 + 拆台）——onboarded 持久化不在这条链上，可被 dispose 安全取消 */
  function scheduleSuccessFinish(): void {
    pendingTimers.push(setTimeout(() => {
      container.style.transition = `opacity ${FADE_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`
      container.style.opacity = '0'
      pendingTimers.push(setTimeout(() => cleanup(), FADE_MS))
    }, SUCCESS_HOLD_MS))
  }

  function render(): void {
    if (inPrologue) return // 序幕期四幕全隐，落幕后本函数恢复常规显影
    const s = logic.state
    if (s !== lastState) {
      lastState = s
      showScene(s)
      if (s === 'success') {
        // 持久化与淡出解耦：确认听到的当刻立即写标记（一次性），
        // 否则用户在 ~1.7s 落幕动画内退出会丢 onboarded，下次启动引导重放
        if (!doneNotified) {
          doneNotified = true
          deps.onDone()
        }
        scheduleSuccessFinish()
      }
    }
    if (s === 'listening') updateListeningText()
  }

  // 首帧先让初始隐藏态落地，下一帧再显影，transition 才有起点可动画（同显影语言惯例）
  const introRaf = requestAnimationFrame(() => {
    if (inPrologue) startPrologue()
    else render()
  })

  const interval = setInterval(() => {
    logic.sample({ hasAudio: deps.latestHasAudio(), hasTrack: deps.hasTrack(), dt: SAMPLE_INTERVAL_MS / 1000 })
    render()
  }, SAMPLE_INTERVAL_MS)

  function cleanup(): void {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(introRaf)
    clearInterval(interval)
    for (const t of pendingTimers) clearTimeout(t)
    container.remove()
    deps.onOpenStateChanged(false)
  }

  deps.onOpenStateChanged(true) // 引导期间模态仲裁 + dock/corner 屏蔽（③起不退台），全程只此一次 open

  return { dispose: cleanup }
}
