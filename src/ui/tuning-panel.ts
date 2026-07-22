// 调音台面板——收敛到 BasePanel（Phase A2 T3）：外壳/显影/开合/Esc/点外部关/固定标题均由基座提供，
// 本文件只留内容（五类 VisualTarget 分组 + rule 编辑器）与 preview/commit/draft 逻辑。
// 与 settings-panel 的严格单向环不同：这里刻意维护本地乐观 draft（拖动实时反馈），
// 播种只发生一次（getMapping），此后控件事件直接改 draft + preview(拖动中)/commit(松手落盘)。
// 退台 profile='camera'（仅镜头后拉，不像设置那样接管整场景，spec §9）——是否触发/如何与设置
// 互斥交给 PanelCoordinator（Task 2），本文件不接 uiStage。
import { BasePanel } from './base-panel'
import { ToggleSwitch } from './toggle-switch'
import { makeInfoIcon } from './info-icon'
import {
  VISUAL_TARGETS,
  type AudioFeature,
  type MappingRule,
  type MappingValues,
  type VisualTarget,
} from '../scenes/nebula/mapping/types'
import { GAIN_MAX, MAPPING_SPEC, SMOOTHING_MAX_MS, type MappingSlotSpec } from '../scenes/nebula/mapping/spec'
import { shapeById } from '../scenes/nebula/shapes'
import { mixerGroupsFor } from '../scenes/nebula/shapes/mixer-contract'
import type { ShapeId, ShapeSettings } from '../scenes/nebula/shapes/types'
import { MOTION_LIMITS, type MotionSettings } from '../scenes/nebula/motion/types'
import { CAMERA_LIMITS, type CameraSettings } from '../scenes/nebula/camera-types'
import { TITLE_SCALE_MIN, TITLE_SCALE_MAX, TITLE_BRIGHTNESS_MIN, TITLE_BRIGHTNESS_MAX, POS_Y_MAX, POSITION_SNAP_NODES, snapToNodes, type TitleSettings } from '../scenes/nebula/title-fx'
import {
  LYRICS_SCALE_MIN, LYRICS_SCALE_MAX, LYRICS_BRIGHTNESS_MIN, LYRICS_BRIGHTNESS_MAX,
  LYRICS_DYNAMICS_GAIN_MIN, LYRICS_DYNAMICS_GAIN_MAX, type LyricsSettings
} from '../scenes/nebula/lyrics/lyrics-fx'
import { BACKGROUND_LIMITS, type BackgroundSettings } from '../scenes/nebula/background-types'

export interface TuningPanelDeps {
  getMapping: () => Promise<MappingValues>
  previewMapping: (m: MappingValues) => void
  commitMapping: (m: MappingValues) => void
  getShape: () => Promise<ShapeSettings>
  setShape: (s: ShapeSettings) => void
  onShapeChanged: (cb: (s: ShapeSettings) => void) => void
  getMotion: () => Promise<MotionSettings>
  previewMotion: (m: MotionSettings) => void
  commitMotion: (m: MotionSettings) => void
  getCamera: () => Promise<CameraSettings>
  previewCamera: (c: CameraSettings) => void
  commitCamera: (c: CameraSettings) => void
  // 歌词歌名 tab（批2）：preview=直调场景 apply 不落盘，commit=setSettings 落盘
  getTitleFx: () => Promise<TitleSettings>
  previewTitleFx: (t: TitleSettings) => void
  commitTitleFx: (t: TitleSettings) => void
  getLyricsFx: () => Promise<LyricsSettings>
  previewLyricsFx: (s: LyricsSettings) => void
  commitLyricsFx: (s: LyricsSettings) => void
  // 背景 tab（虚空之镜）：preview=直调场景 apply 不落盘，commit=setSettings 落盘
  getBackgroundFx: () => Promise<BackgroundSettings>
  previewBackgroundFx: (b: BackgroundSettings) => void
  commitBackgroundFx: (b: BackgroundSettings) => void
  /** 背景设置回流（自定义背景 v1）：shape-picker 也会改 background（选卡/入藏/删卡），
   * draft 不吃回流会在下次 commit 把过期 customBackgrounds/current 整包写回（静默撤销选择） */
  onBackgroundChanged: (cb: (b: BackgroundSettings) => void) => void
}

/** 目标（英文枚举）→ 中文显示。仅用于渲染，底层 patch/白名单一律走英文枚举（item 5.1 铁律）。 */
const TARGET_LABELS: Record<VisualTarget, string> = {
  space: '空间', brightness: '亮度', density: '密度', thickness: '厚度', speed: '速度',
}

/** 组标题 ⓘ 的简述文案——只讲这个目标是什么，不重复组名/规则名（item 6：组标题 ⓘ 不再借用 primary spec.label） */
const TARGET_DESC: Record<VisualTarget, string> = {
  speed: '整体运动的快慢',
  density: '看到的粒子多少（不等于真实总数）',
  space: '扩张、收缩、朝相机的纵深',
  brightness: '明暗与闪光',
  thickness: '粒径与光丝的厚重',
}

/** 来源（AudioFeature 英文枚举）→ 中文显示。同上，只在显示层生效。 */
const SOURCE_LABELS: Record<AudioFeature, string> = {
  beat: '鼓点', downbeat: '重拍', low: '低频', mid: '中频', high: '高频',
  energy: '能量', drop: '爆点', loudness: '响度', silence: '静默', tempo: '节奏速度',
}

// 透明度层级——与 settings-panel 完全同源（label/未选/hover/选中）
const LABEL_OPACITY = '0.5'
const SELECTED_OPACITY = '0.85'
const UNSELECTED_OPACITY = '0.35'
const HOVER_OPACITY = '0.6'

// 设计规范：模块分隔线 + 标题层级（item 4）——数值集中在此，供面板系统内其它分组场景复用
const GROUP_TITLE_FONT_SIZE = '15px'
const GROUP_TITLE_OPACITY = '0.7'
const GROUP_DIVIDER = '1px solid rgba(255, 255, 255, 0.07)'

// tab 栏（Phase B1 亲验反馈①：两分区堆叠太长，改 tab 切换，titlebar 下方常驻）
const TAB_FONT_SIZE = '13px'
const TAB_LETTER_SPACING = '1px'
const TAB_ACTIVE_BORDER = '2px solid rgba(255, 255, 255, 0.4)'
const TAB_INACTIVE_BORDER = '2px solid transparent'

// 沉睡态提示（Phase B1 亲验反馈②反转，spec §4.6：切形状=临时唤醒展示，无音乐自动回睡）
const SHAPE_SLEEP_HINT_STYLE = 'font-size: 11px; color: rgba(255, 255, 255, 0.35); margin: 8px 0 4px;'

/** tab 标识——四处联合类型重复处（activeTab 声明/makeTab/paint/showTab）收拢到此（fb3：通用调试拆为音画映射+镜头） */
type TabId = 'general' | 'camera' | 'shape' | 'lyrics' | 'background'

interface RangeSpec {
  label: string
  /** 参数解释——有值时在 label 旁渲染信息图标，hover 出 tooltip（朝左，防面板贴右边缘出屏） */
  help?: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
  /** 轻吸附（歌词位置滑块）：input/change 的原始值先过此函数再显示与回调（如 snapToNodes） */
  snap?: (v: number) => number
  /** 轨道刻度点（歌词位置滑块）：在滑杆下方按量程百分比画小点标出吸附节点位置 */
  ticks?: readonly number[]
  onInput: (v: number) => void
  onCommit: (v: number) => void
}

export class TuningPanel extends BasePanel {
  private body: HTMLElement
  /** 本地乐观 draft——由 getMapping 播种一次，此后控件事件直接原地改（已深拷贝，不污染播种源） */
  private draft: MappingValues | null = null
  /** 每个信息图标的 dispose（摘 tooltip 节点 + 卸监听）——buildRows 重建前 drain，防孤儿 tooltip（Phase B 重建铺路） */
  private infoDisposers: Array<() => void> = []
  /** makeLabelWithHelp 造图标时该 push 进哪个 disposer 桶——默认通用区的 infoDisposers，
   * buildShapeSection 造行期间临时指向 shapeDisposers，使两区各自 drain 互不牵连（见下方定案实现说明） */
  private helpSink: Array<() => void> | null = null

  /** 形状区状态：getShape 播种 + onShapeChanged 持续回流（离散设置语义同 settings-panel，
   * 区别于映射区的乐观 draft——评审 I5：与 B2 选择器双入口同步全靠回流重绘） */
  private shape: ShapeSettings | null = null
  private shapeBody: HTMLElement
  private shapeDisposers: Array<() => void> = []

  /** 运动旋钮的本地乐观 draft（Phase C2）：与映射区同款——播种一次，此后拖动改 draft + preview/commit，
   * onShapeChanged 回流只重绘 DOM，值恒取自本地 draft，不被 settings 回声冲掉 */
  private motionDraft: MotionSettings | null = null

  /** 镜头旋钮的本地乐观 draft（Phase D；fb3 拆出独立「镜头」tab）：与 motion 同款——播种一次，此后拖动改 draft + preview/commit */
  private cameraDraft: CameraSettings | null = null
  private cameraBody!: HTMLElement
  private cameraDisposers: Array<() => void> = []

  /** 歌词歌名 tab 的乐观 draft（批2）：与 motion/camera 同款——播种一次，此后控件改 draft + preview/commit */
  private titleDraft: TitleSettings | null = null
  private lyricsDraft: LyricsSettings | null = null
  private lyricsBody: HTMLElement
  private lyricsDisposers: Array<() => void> = []

  /** 背景 tab（虚空之镜）的乐观 draft：与 lyrics 同款——播种一次，此后控件改 draft + preview/commit */
  private backgroundDraft: BackgroundSettings | null = null
  private backgroundBody: HTMLElement
  private backgroundDisposers: Array<() => void> = []

  /** tab 栏状态：切 tab 只做 display 显隐，body/cameraBody/shapeBody/lyricsBody/backgroundBody 全程留在 DOM——映射区乐观 draft 与
   * 形状区 onShapeChanged 回流环都不许被切换打断。 */
  private activeTab: TabId = 'general'
  private generalTabEl!: HTMLElement
  private cameraTabEl!: HTMLElement
  private shapeTabEl!: HTMLElement
  private lyricsTabEl!: HTMLElement
  private backgroundTabEl!: HTMLElement

  constructor(parent: HTMLElement, private deps: TuningPanelDeps) {
    super(parent, { id: 'tuning-panel', title: '调音台', retreatProfile: 'camera' })

    // 细轨滑块——inline style 够不到 ::-webkit-slider-* 伪元素，用一枚 <style> 补足；
    // 全局样式表（非 shadow scoped），靠 .tp-slider 唯一类名避免碰撞。
    // <style> 作为普通子节点挂在内容区内也生效（HTML 规范允许，非仅限 head）
    const sliderStyle = document.createElement('style')
    sliderStyle.textContent = `
      .tp-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 14px; background: transparent; cursor: pointer; margin: 2px 0; }
      .tp-slider::-webkit-slider-runnable-track { height: 2px; background: rgba(255, 255, 255, 0.15); border-radius: 1px; }
      .tp-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 10px; height: 10px; margin-top: -4px; border-radius: 50%; background: rgba(255, 255, 255, 0.55); }
      .tp-slider::-moz-range-track { height: 2px; background: rgba(255, 255, 255, 0.15); border-radius: 1px; }
      .tp-slider::-moz-range-thumb { width: 10px; height: 10px; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.55); }
    `
    this.appendRow(sliderStyle)

    this.appendRow(this.buildTabBar())

    this.body = document.createElement('div')
    const loading = document.createElement('div')
    loading.textContent = '加载中…'
    loading.style.cssText = `color: rgba(255, 255, 255, ${LABEL_OPACITY});`
    this.body.appendChild(loading)
    this.appendRow(this.body)

    // 唯一播种点：面板构造时读一次初始 mapping，深拷贝成本地 draft，此后不再回流覆盖
    // （区别于 settings-panel 的 onSettingsChanged 持续回流——拖动语义要求乐观本地态）
    void deps.getMapping().then((m) => {
      this.draft = structuredClone(m)
      this.buildRows()
    })

    this.shapeBody = document.createElement('div')
    this.shapeBody.style.display = 'none' // 默认激活「音画映射」tab，形状分区初始隐藏；此后显隐只由 showTab 改动
    this.appendRow(this.shapeBody)
    void deps.getShape().then((s) => {
      this.shape = s
      this.buildShapeSection()
    })
    deps.onShapeChanged((s) => {
      this.shape = s
      this.buildShapeSection() // 回流全量重绘：双入口（B2 选择器/本区）状态必然一致
    })

    // 运动旋钮与映射区同款乐观 draft：播种一次，此后拖动改 draft + preview/commit——
    // onShapeChanged 回流只重绘 DOM，值恒取自本地 draft，不被 settings 回声冲掉
    void deps.getMotion().then((m) => {
      this.motionDraft = structuredClone(m)
      this.buildShapeSection()
    })

    this.cameraBody = document.createElement('div')
    this.cameraBody.style.display = 'none' // 显隐只由 showTab 改动（同 shapeBody 纪律）
    this.appendRow(this.cameraBody)
    // 镜头旋钮播种（Phase D；fb3 搬入独立「镜头」tab）：draft 纪律与 motion 同款
    void deps.getCamera().then((c) => {
      this.cameraDraft = structuredClone(c)
      this.buildCameraSection()
    })

    this.lyricsBody = document.createElement('div')
    this.lyricsBody.style.display = 'none' // 显隐只由 showTab 改动（同 shapeBody 纪律）
    this.appendRow(this.lyricsBody)
    void deps.getTitleFx().then((t) => {
      this.titleDraft = structuredClone(t)
      this.buildLyricsSection()
    })
    void deps.getLyricsFx().then((s) => {
      this.lyricsDraft = structuredClone(s)
      this.buildLyricsSection()
    })

    this.backgroundBody = document.createElement('div')
    this.backgroundBody.style.display = 'none' // 显隐只由 showTab 改动（同 shapeBody 纪律）
    this.appendRow(this.backgroundBody)
    void deps.getBackgroundFx().then((b) => {
      this.backgroundDraft = structuredClone(b)
      this.buildBackgroundSection()
    })
    deps.onBackgroundChanged((b) => {
      // 同 channel 多订阅者共享同一广播对象，draft 就地突变会污染 shape-picker/场景的快照，须 clone 隔离
      this.backgroundDraft = structuredClone(b)
      this.buildBackgroundSection() // 全量重建：置灰态跟随 current 翻转（拖动中 commit 才触发回流，无中断风险）
    })
  }

  /** 拖动中：只 preview，不落盘 */
  private preview(): void {
    if (this.draft) this.deps.previewMapping(this.draft)
  }

  /** 松手/离散选择：preview 收尾 + 落盘 */
  private commit(): void {
    if (!this.draft) return
    this.deps.previewMapping(this.draft)
    this.deps.commitMapping(this.draft)
  }

  private buildRows(): void {
    if (!this.draft) return
    // 重建前先 drain 上一批信息图标（摘 tooltip 节点 + 卸监听），防 body.innerHTML='' 后孤儿化 <div data-tooltip>
    this.infoDisposers.forEach((d) => d())
    this.infoDisposers = []
    this.body.innerHTML = ''

    VISUAL_TARGETS.forEach((target, i) => {
      const slot = MAPPING_SPEC[target]
      // 组标题——原「组名 + 独立解释文字行」收拢成一行：组名 + 信息图标（hover 出 primary 规则的解释）
      const groupHeader = document.createElement('div')
      groupHeader.style.cssText = `
        display: flex;
        align-items: center;
        font-size: ${GROUP_TITLE_FONT_SIZE};
        color: rgba(255, 255, 255, ${GROUP_TITLE_OPACITY});
        margin-top: 18px;
        padding-top: ${i === 0 ? '0' : '14px'};
        border-top: ${i === 0 ? 'none' : GROUP_DIVIDER};
      `
      const groupTitle = document.createElement('span')
      groupTitle.textContent = TARGET_LABELS[target]
      groupHeader.appendChild(groupTitle)
      const groupIcon = makeInfoIcon(TARGET_DESC[target])
      groupHeader.appendChild(groupIcon.el)
      this.infoDisposers.push(groupIcon.dispose)
      this.body.appendChild(groupHeader)
      this.body.appendChild(this.buildRuleEditor(target, 'primary', slot.primary))
      if (slot.secondary) this.body.appendChild(this.buildRuleEditor(target, 'secondary', slot.secondary))
    })
  }

  /** 镜头 tab（fb3 从「通用调试」拆出）：Phase D 运镜旋钮原样搬家，draft/preview/commit 链路不变 */
  private buildCameraSection(): void {
    if (!this.cameraDraft) return
    this.cameraDisposers.forEach((d) => d())
    this.cameraDisposers = []
    this.cameraBody.innerHTML = ''
    const d = this.cameraDraft
    try {
      this.helpSink = this.cameraDisposers
      this.cameraBody.appendChild(this.makeGroupHeader(
        '镜头', '自动运镜的手感：站位远近、环绕、重拍冲击、爆发拉远', true))
      const lim = CAMERA_LIMITS.liveliness
      this.cameraBody.appendChild(this.makeRange({
        label: '运镜活跃度',
        help: '左=纪录片式沉稳（环绕/冲击/拉远全关），右=MV 式活跃；不影响呼吸与手持漂移',
        min: lim.min, max: lim.max, step: lim.step, value: d.liveliness,
        onInput: (v) => { d.liveliness = v; this.deps.previewCamera(d) },
        onCommit: (v) => { d.liveliness = v; this.deps.previewCamera(d); this.deps.commitCamera(d) },
      }))
      const distLim = CAMERA_LIMITS.distScale
      this.cameraBody.appendChild(this.makeRange({
        label: '默认距离',
        help: '镜头站位的远近偏好：左=贴近细看，右=远观全貌（所有机位等比缩放，滚轮临时缩放不受影响）',
        min: distLim.min, max: distLim.max, step: distLim.step, value: d.distScale,
        onInput: (v) => { d.distScale = v; this.deps.previewCamera(d) },
        onCommit: (v) => { d.distScale = v; this.deps.previewCamera(d); this.deps.commitCamera(d) },
      }))
    } finally {
      this.helpSink = null
    }
  }

  /** 形状专属分区（B1：区结构 + 临时下拉 + 封面优先。真形状专属参数 Phase C 产生；
   * 临时下拉在 B2 选择器上线后连测试一起删，分区结构保留） */
  private buildShapeSection(): void {
    if (!this.shape) return
    this.shapeDisposers.forEach((d) => d())
    this.shapeDisposers = []
    this.shapeBody.innerHTML = ''

    // 沉睡态提示（亲验反馈②反转）：无音乐时切形状会临时唤醒展示片刻，之后自动回睡——常驻小字说明
    const sleepHint = document.createElement('div')
    sleepHint.textContent = '切换即时生效；无音乐时展示片刻后休眠'
    sleepHint.style.cssText = SHAPE_SLEEP_HINT_STYLE
    this.shapeBody.appendChild(sleepHint)

    // makeLabelWithHelp/makeToggleRow 内部经 makeLabelWithHelp 造 ⓘ 时把 dispose 推进 helpSink——
    // 重建期间借道指向 shapeDisposers，使本区重绘只 drain 自己的图标，不动通用区（评审 I5）
    try {
      this.helpSink = this.shapeDisposers

      // 只读当前形状（B2：临时下拉退役，切换入口=操作坞形状选择器；此处仅展示，回流更新）
      const currentRow = document.createElement('div')
      currentRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-top: 4px;'
      const currentLabel = this.makeLabelWithHelp('当前形状', '切换请用操作坞的形状选择器')
      const currentValue = document.createElement('span')
      currentValue.textContent = shapeById(this.shape!.current).label
      currentValue.style.cssText = `color: rgba(255, 255, 255, ${SELECTED_OPACITY});`
      currentRow.append(currentLabel, currentValue)
      this.shapeBody.appendChild(currentRow)

      this.shapeBody.appendChild(this.makeToggleRow(
        '封面优先', '打开后，歌曲有封面时优先吸成封面粒子；关闭则永远保持所选形状',
        () => this.shape!.coverPriority,
        (v) => { this.deps.setShape({ ...this.shape!, coverPriority: v }) },
      ))

      // fb3 自适应分组：分区随当前形状显隐——粒子运动组常驻（封面优先开着时封面随时可能接管，
      // 封面=粒子体），线条组只在选中频谱环/波形线时出现；自定义形状也是粒子体
      const body = this.shape.customCurrent ? 'particles' : shapeById(this.shape.current).body ?? 'particles'

      // —— 契约驱动分组（调音台规范化）：body → mixerGroupsFor 查表渲染。
      // 分组清单/文案/绑定键全部来自 shapes/mixer-contract.ts 单一事实源，量程仍取 MOTION_LIMITS
      if (this.motionDraft) {
        const d = this.motionDraft
        for (const g of mixerGroupsFor(body)) {
          const header = document.createElement('div')
          header.textContent = g.title
          header.style.cssText = `font-size: ${GROUP_TITLE_FONT_SIZE}; color: rgba(255, 255, 255, ${GROUP_TITLE_OPACITY}); margin-top: 18px; padding-top: 14px; border-top: ${GROUP_DIVIDER};`
          this.shapeBody.appendChild(header)
          for (const k of g.knobs) {
            const lim = MOTION_LIMITS[k.key]
            this.shapeBody.appendChild(this.makeRange({
              label: k.label, help: k.help, min: lim.min, max: lim.max, step: lim.step, value: d[k.key],
              onInput: (v) => { d[k.key] = v; this.deps.previewMotion(d) },
              onCommit: (v) => { d[k.key] = v; this.deps.previewMotion(d); this.deps.commitMotion(d) },
            }))
          }
          for (const t of g.toggles ?? []) {
            this.shapeBody.appendChild(this.makeToggleRow(
              t.label, t.help,
              () => d[t.key],
              (v) => { d[t.key] = v; this.deps.commitMotion(d) }, // toggle 现状语义：只 commit 不 preview
            ))
          }
        }
      }
    } finally {
      this.helpSink = null
    }
    // 显隐不在这里管：innerHTML='' 只清子节点，shapeBody 自身的 style.display 不受重建影响，
    // 全程由 showTab 独立掌管（行为不变量「通用 tab 激活时回流重绘后形状区仍隐藏」有测试压阵）
  }

  /** tab 栏：titlebar 下方常驻，切 tab 只做 body/cameraBody/shapeBody/backgroundBody/lyricsBody 的 display 显隐——五容器全程留在 DOM，
   * 映射区乐观 draft 与形状区回流环都不因切换重建（亲验反馈①：两分区堆叠太长） */
  private buildTabBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.style.cssText = `display: flex; gap: 20px; margin-top: 4px; padding-bottom: 8px; border-bottom: ${GROUP_DIVIDER};`

    const makeTab = (text: string, tab: TabId): HTMLElement => {
      const el = document.createElement('span')
      el.textContent = text
      el.style.cssText = `
        cursor: pointer;
        font-size: ${TAB_FONT_SIZE};
        letter-spacing: ${TAB_LETTER_SPACING};
        padding-bottom: 6px;
      `
      el.addEventListener('click', () => this.showTab(tab))
      el.addEventListener('mouseenter', () => {
        if (this.activeTab !== tab) el.style.color = `rgba(255, 255, 255, ${HOVER_OPACITY})`
      })
      el.addEventListener('mouseleave', () => this.paintTabBar())
      return el
    }

    this.generalTabEl = makeTab('音画映射', 'general')
    this.cameraTabEl = makeTab('镜头', 'camera')
    this.shapeTabEl = makeTab('形状专属', 'shape')
    this.lyricsTabEl = makeTab('歌词歌名', 'lyrics')
    this.backgroundTabEl = makeTab('背景', 'background')
    bar.append(this.generalTabEl, this.cameraTabEl, this.shapeTabEl, this.lyricsTabEl, this.backgroundTabEl)
    this.paintTabBar()
    return bar
  }

  private paintTabBar(): void {
    const paint = (el: HTMLElement, tab: TabId): void => {
      const active = this.activeTab === tab
      el.style.color = `rgba(255, 255, 255, ${active ? SELECTED_OPACITY : UNSELECTED_OPACITY})`
      el.style.borderBottom = active ? TAB_ACTIVE_BORDER : TAB_INACTIVE_BORDER
    }
    paint(this.generalTabEl, 'general')
    paint(this.cameraTabEl, 'camera')
    paint(this.shapeTabEl, 'shape')
    paint(this.lyricsTabEl, 'lyrics')
    paint(this.backgroundTabEl, 'background')
  }

  /** 对外「打开并直落指定 tab」（卡片层编辑钮入口，v2 亲验反馈②）：先切页再开面板——
   * 开着时等效只切页；互斥退台由 PanelCoordinator 经 onOpenChange 仲裁，无需在此处理 */
  openToTab(tab: TabId): void {
    this.showTab(tab)
    this.open()
  }

  private showTab(tab: TabId): void {
    if (this.activeTab === tab) return
    this.activeTab = tab
    this.body.style.display = tab === 'general' ? '' : 'none'
    this.cameraBody.style.display = tab === 'camera' ? '' : 'none'
    this.shapeBody.style.display = tab === 'shape' ? '' : 'none'
    this.lyricsBody.style.display = tab === 'lyrics' ? '' : 'none'
    this.backgroundBody.style.display = tab === 'background' ? '' : 'none'
    this.paintTabBar()
  }

  private buildRuleEditor(target: VisualTarget, slotKey: 'primary' | 'secondary', spec: MappingSlotSpec): HTMLElement {
    // 每次调用都从 this.draft 重新取——不缓存引用快照，保证多个控件共享同一份最新 rule
    const rule = (): MappingRule => {
      const t = this.draft!.targets[target]
      return (slotKey === 'primary' ? t.primary : t.secondary)!
    }

    const wrap = document.createElement('div')
    wrap.style.cssText = 'margin: 4px 0 8px;'

    // 多规则组（有 secondary）：primary/secondary 各给一条文字子标题（规则子名，取 spec.label「·」后半段），
    // 让每条规则有真实标题而不是孤零零的信息图标（item 6）。单规则组不加子标题，控件直接跟组标题走。
    if (MAPPING_SPEC[target].secondary) {
      const subName = spec.label.includes('·') ? spec.label.split('·').pop()! : spec.label
      const subHeader = document.createElement('div')
      subHeader.textContent = subName
      subHeader.style.cssText = `
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 10px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
      `
      wrap.appendChild(subHeader)
    }

    wrap.appendChild(this.makeToggleRow(
      '启用', '关掉后这条不参与驱动',
      () => rule().enabled,
      (v) => { rule().enabled = v; this.commit() },
    ))

    wrap.appendChild(this.makeChoiceRow<AudioFeature>(
      '来源', '选择由哪个音频特征来驱动',
      spec.allowedSources.map((s) => ({ text: SOURCE_LABELS[s], value: s })),
      () => rule().source,
      (v) => { rule().source = v; this.commit() },
    ))

    wrap.appendChild(this.makeRange({
      label: '强度', help: '驱动这个目标的强弱倍数', min: 0, max: GAIN_MAX, step: 0.05, value: rule().gain,
      onInput: (v) => { rule().gain = v; this.preview() },
      onCommit: (v) => { rule().gain = v; this.commit() },
    }))
    wrap.appendChild(this.makeRange({
      label: '平滑', help: '越大，响应越缓越柔', min: 0, max: SMOOTHING_MAX_MS, step: 10, value: rule().smoothingMs,
      format: (v) => `${Math.round(v)}ms`,
      onInput: (v) => { rule().smoothingMs = v; this.preview() },
      onCommit: (v) => { rule().smoothingMs = v; this.commit() },
    }))
    wrap.appendChild(this.makeRange({
      label: '下限', help: '输出的最小值', min: 0, max: 1, step: 0.01, value: rule().outputMin,
      onInput: (v) => { rule().outputMin = v; this.preview() },
      onCommit: (v) => { rule().outputMin = v; this.commit() },
    }))
    wrap.appendChild(this.makeRange({
      label: '上限', help: '输出的最大值', min: 0, max: 1, step: 0.01, value: rule().outputMax,
      onInput: (v) => { rule().outputMax = v; this.preview() },
      onCommit: (v) => { rule().outputMax = v; this.commit() },
    }))

    return wrap
  }

  /** label + 可选信息图标——choice/toggle/range 三种行共用，help 有值时在文字右侧挂一个 ⓘ（hover 出解释） */
  private makeLabelWithHelp(label: string, help?: string): HTMLElement {
    const labelGroup = document.createElement('span')
    labelGroup.style.cssText = `display: inline-flex; align-items: center; color: rgba(255, 255, 255, ${LABEL_OPACITY});`
    const labelEl = document.createElement('span')
    labelEl.textContent = label
    labelGroup.appendChild(labelEl)
    if (help) {
      const helpIcon = makeInfoIcon(help)
      labelGroup.appendChild(helpIcon.el)
      ;(this.helpSink ?? this.infoDisposers).push(helpIcon.dispose)
    }
    return labelGroup
  }

  /** 离散可点选项行（启用/来源共用）——文字 span 风格，透明度层级仿 settings-panel：
   * 未选 UNSELECTED_OPACITY / hover HOVER_OPACITY / 选中 SELECTED_OPACITY。
   * 点击直接改 draft 后本地重绘——tuning-panel 的乐观本地环，非 settings-panel 的单向回流 */
  private makeChoiceRow<T>(
    label: string,
    help: string | undefined,
    options: Array<{ text: string; value: T }>,
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-top: 2px;'

    const labelEl = this.makeLabelWithHelp(label, help)

    const valuesEl = document.createElement('span')
    valuesEl.style.cssText = 'display: flex; flex-wrap: wrap; gap: 2px 14px;'

    const spans: HTMLElement[] = []
    const paint = (): void => {
      const current = get()
      options.forEach((opt, i) => {
        spans[i].style.color = `rgba(255, 255, 255, ${opt.value === current ? SELECTED_OPACITY : UNSELECTED_OPACITY})`
      })
    }
    for (const opt of options) {
      const span = document.createElement('span')
      span.textContent = opt.text
      span.style.cssText = 'cursor: pointer;'
      span.addEventListener('click', () => { set(opt.value); paint() })
      span.addEventListener('mouseenter', () => {
        if (opt.value !== get()) span.style.color = `rgba(255, 255, 255, ${HOVER_OPACITY})`
      })
      span.addEventListener('mouseleave', paint)
      spans.push(span)
      valuesEl.appendChild(span)
    }
    paint()

    row.append(labelEl, valuesEl)
    return row
  }

  /** 「启用」行——iOS 风格透明白开关（item 5），取代原文字开/关选项 */
  private makeToggleRow(label: string, help: string | undefined, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-top: 4px;'

    row.appendChild(this.makeLabelWithHelp(label, help))

    const toggleHost = document.createElement('span')
    row.appendChild(toggleHost)
    new ToggleSwitch(toggleHost, { checked: get(), onChange: set })

    return row
  }

  private makeRange(opts: RangeSpec): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; flex-direction: column; gap: 1px; margin-top: 2px;'

    const labelRow = document.createElement('div')
    labelRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between;'
    const labelGroup = this.makeLabelWithHelp(opts.label, opts.help)
    const valueEl = document.createElement('span')
    valueEl.style.cssText = `color: rgba(255, 255, 255, ${LABEL_OPACITY});`
    const fmt = opts.format ?? ((v: number) => opts.step % 1 === 0 ? String(Math.round(v)) : v.toFixed(2))
    valueEl.textContent = fmt(opts.value)
    labelRow.append(labelGroup, valueEl)

    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'tp-slider'
    input.min = String(opts.min)
    input.max = String(opts.max)
    input.step = String(opts.step)
    input.value = String(opts.value)
    input.style.cssText = 'pointer-events: auto;'
    // 拖动中：input 事件（每帧触发）→ 只 preview，不落盘；snap 前置——显示值=回调值=吸附后值。
    // 吸附命中时回写 thumb（亲验 fb1：只吸数值不吸钮感知不到——磁吸手感的视觉主体是钮跳到节点）
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const v = opts.snap ? opts.snap(raw) : raw
      if (v !== raw) input.value = String(v)
      valueEl.textContent = fmt(v)
      opts.onInput(v)
    })
    // 松手：change 事件（release/blur 触发一次）→ preview + commit 落盘；同款回写让钮停在节点上
    input.addEventListener('change', () => {
      const raw = Number(input.value)
      const v = opts.snap ? opts.snap(raw) : raw
      if (v !== raw) input.value = String(v)
      opts.onCommit(v)
    })

    // 节点刻度条：吸附节点的视觉锚（挂在轨道下方 1px，点足够淡不抢层级）
    if (opts.ticks && opts.ticks.length > 0) {
      const strip = document.createElement('div')
      strip.setAttribute('data-role', 'tick-strip')
      strip.style.position = 'relative'
      strip.style.height = '3px'
      strip.style.marginTop = '-4px' // 贴回轨道正下方（slider 自带 14px 高度含留白）
      for (const t of opts.ticks) {
        const dot = document.createElement('span')
        dot.setAttribute('data-role', 'tick')
        dot.style.position = 'absolute'
        dot.style.left = `${(((t - opts.min) / (opts.max - opts.min)) * 100).toFixed(1)}%`
        dot.style.width = '2px'
        dot.style.height = '2px'
        dot.style.borderRadius = '50%'
        dot.style.background = 'rgba(255, 255, 255, 0.28)'
        strip.appendChild(dot)
      }
      row.append(labelRow, input, strip)
      return row
    }
    row.append(labelRow, input)
    return row
  }

  /** 组标题行（歌词/背景/镜头 tab 共用）：组名 + ⓘ；first=组间分隔线有无 */
  private makeGroupHeader(label: string, desc: string, first: boolean): HTMLElement {
    const header = document.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      font-size: ${GROUP_TITLE_FONT_SIZE};
      color: rgba(255, 255, 255, ${GROUP_TITLE_OPACITY});
      margin-top: ${first ? '4px' : '18px'};
      padding-top: ${first ? '0' : '14px'};
      border-top: ${first ? 'none' : GROUP_DIVIDER};
    `
    const title = document.createElement('span')
    title.textContent = label
    header.appendChild(title)
    const icon = makeInfoIcon(desc)
    header.appendChild(icon.el)
    ;(this.helpSink ?? this.infoDisposers).push(icon.dispose)
    return header
  }

  /** 歌词歌名 tab（批2）：粒子歌名 4 行 + 歌词 5 行。两 draft 齐了才建；
   * 内容静态无回流重绘（搬家后调音台是唯一编辑入口），只建一次 */
  private buildLyricsSection(): void {
    if (!this.titleDraft || !this.lyricsDraft) return
    this.lyricsDisposers.forEach((d) => d())
    this.lyricsDisposers = []
    this.lyricsBody.innerHTML = ''
    const t = this.titleDraft
    const l = this.lyricsDraft
    try {
      this.helpSink = this.lyricsDisposers

      // —— 粒子歌名（切歌拼字，settings 键 title.*）——
      this.lyricsBody.appendChild(this.makeGroupHeader(
        '粒子歌名', '切歌时的粒子拼字（不是左下角的歌名角标）', true))
      this.lyricsBody.appendChild(this.makeChoiceRow<TitleSettings['mode']>(
        '展示', '切歌时拼出歌名的展示方式',
        [{ text: '5秒', value: 'timed' }, { text: '常驻', value: 'always' }, { text: '关', value: 'off' }],
        () => t.mode,
        (v) => { t.mode = v; this.deps.previewTitleFx(t); this.deps.commitTitleFx(t) },
      ))
      this.lyricsBody.appendChild(this.makeRange({
        label: '位置', help: '悬浮高度：负=下方、正=上方、0=画面中心；两端可能贴画面边缘，拖动实时看效果',
        min: -POS_Y_MAX, max: POS_Y_MAX, step: 0.01, value: t.position, snap: snapToNodes, ticks: POSITION_SNAP_NODES,
        onInput: (v) => { t.position = v; this.deps.previewTitleFx(t) },
        onCommit: (v) => { t.position = v; this.deps.previewTitleFx(t); this.deps.commitTitleFx(t) },
      }))
      this.lyricsBody.appendChild(this.makeRange({
        label: '大小', min: TITLE_SCALE_MIN, max: TITLE_SCALE_MAX, step: 0.05, value: t.scale,
        onInput: (v) => { t.scale = v; this.deps.previewTitleFx(t) },
        onCommit: (v) => { t.scale = v; this.deps.previewTitleFx(t); this.deps.commitTitleFx(t) },
      }))
      this.lyricsBody.appendChild(this.makeRange({
        label: '亮度', min: TITLE_BRIGHTNESS_MIN, max: TITLE_BRIGHTNESS_MAX, step: 0.05, value: t.brightness,
        onInput: (v) => { t.brightness = v; this.deps.previewTitleFx(t) },
        onCommit: (v) => { t.brightness = v; this.deps.previewTitleFx(t); this.deps.commitTitleFx(t) },
      }))

      // —— 歌词（settings 键 lyrics.*）——
      this.lyricsBody.appendChild(this.makeGroupHeader(
        '歌词', '逐行同步歌词（需要系统正在播放且抓得到词）', false))
      this.lyricsBody.appendChild(this.makeToggleRow(
        '显示', '关 = 不抓词不联网，整条歌词链路休眠；重新打开从下一首歌生效',
        () => l.enabled,
        (v) => { l.enabled = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      ))
      this.lyricsBody.appendChild(this.makeRange({
        label: '位置', help: '悬浮高度：负=下方、正=上方、0=画面中心；调低可避开主形状遮挡',
        min: -POS_Y_MAX, max: POS_Y_MAX, step: 0.01, value: l.position, snap: snapToNodes, ticks: POSITION_SNAP_NODES,
        onInput: (v) => { l.position = v; this.deps.previewLyricsFx(l) },
        onCommit: (v) => { l.position = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      }))
      this.lyricsBody.appendChild(this.makeRange({
        label: '大小', min: LYRICS_SCALE_MIN, max: LYRICS_SCALE_MAX, step: 0.05, value: l.scale,
        onInput: (v) => { l.scale = v; this.deps.previewLyricsFx(l) },
        onCommit: (v) => { l.scale = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      }))
      this.lyricsBody.appendChild(this.makeToggleRow(
        '节奏动态', '歌词跟着音乐呼吸、鼓点闪烁、爆点冲击；关 = 纯静态逐行拼字',
        () => l.dynamics,
        (v) => { l.dynamics = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      ))
      this.lyricsBody.appendChild(this.makeRange({
        label: '动态强度', help: '节奏三层动效的整体幅度；0≈纯静态，1=标准，调低可提高可读性',
        min: LYRICS_DYNAMICS_GAIN_MIN, max: LYRICS_DYNAMICS_GAIN_MAX, step: 0.05, value: l.dynamicsGain,
        onInput: (v) => { l.dynamicsGain = v; this.deps.previewLyricsFx(l) },
        onCommit: (v) => { l.dynamicsGain = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      }))
      this.lyricsBody.appendChild(this.makeRange({
        label: '亮度', min: LYRICS_BRIGHTNESS_MIN, max: LYRICS_BRIGHTNESS_MAX, step: 0.05, value: l.brightness,
        onInput: (v) => { l.brightness = v; this.deps.previewLyricsFx(l) },
        onCommit: (v) => { l.brightness = v; this.deps.previewLyricsFx(l); this.deps.commitLyricsFx(l) },
      }))
    } finally {
      this.helpSink = null
    }
  }

  /** 背景 tab（虚空之镜；亲验 fb1 修订①：倒影整体退役，滑杆随之删除；修订④新增尘埃密度）：
   * 极光/涟漪/尘埃三滑杆——归零即关闭对应效果（减少动态效果逃生通道） */
  private buildBackgroundSection(): void {
    if (!this.backgroundDraft) return
    this.backgroundDisposers.forEach((d) => d())
    this.backgroundDisposers = []
    this.backgroundBody.innerHTML = ''
    const b = this.backgroundDraft
    // 自定义背景 v1：current !== 'aurora' 即用户激活了上传背景——虚空之镜的极光/涟漪/镜面与
    // 上传背景互斥（spec §二），置灰提示不可调（行级样式，不动 makeRange/ToggleSwitch 内部）
    const locked = b.current !== 'aurora'
    try {
      this.helpSink = this.backgroundDisposers
      // 两分组（亲验 fb7）：镜面效果与尘埃各归各组——rows 渲染共用一个闭包，返回行元素数组
      // （而非直接 append）以便调用方决定是否套 lockRow
      const renderRows = (rows: Array<{ key: keyof typeof BACKGROUND_LIMITS; label: string; help: string }>): HTMLElement[] =>
        rows.map((r) => {
          const lim = BACKGROUND_LIMITS[r.key]
          return this.makeRange({
            label: r.label, help: r.help, min: lim.min, max: lim.max, step: lim.step, value: b[r.key],
            onInput: (v) => { b[r.key] = v; this.deps.previewBackgroundFx(b) },
            onCommit: (v) => { b[r.key] = v; this.deps.previewBackgroundFx(b); this.deps.commitBackgroundFx(b) },
          })
        })
      // 上传背景激活时置灰（spec §二互斥）：行级 opacity+pointerEvents，不动 makeRange/ToggleSwitch 内部
      const lockRow = (row: HTMLElement): HTMLElement => {
        row.setAttribute('data-role', 'bg-fx-row')
        if (locked) {
          row.style.opacity = '0.45'
          row.style.pointerEvents = 'none'
        }
        return row
      }
      this.backgroundBody.appendChild(this.makeGroupHeader(
        '深空水镜', '极光天空与镜面涟漪的强度；任一滑到 0 即完全关闭该效果', true))
      for (const row of renderRows([
        { key: 'aurora', label: '极光强度', help: '天空极光的亮度与呼吸幅度；0=近黑深空（星野保留）' },
        { key: 'ripple', label: '涟漪强度', help: '重拍敲在镜面上的涟漪；只响应强拍，0=永不起圈' },
      ])) this.backgroundBody.appendChild(lockRow(row))
      this.backgroundBody.appendChild(lockRow(this.makeToggleRow(
        '镜面', '地面镜面与拍点涟漪圈的总开关；部分形状关闭更空灵',
        () => b.mirror,
        (v) => { b.mirror = v; this.deps.previewBackgroundFx(b); this.deps.commitBackgroundFx(b) },
      )))
      if (locked) {
        const note = document.createElement('div')
        note.setAttribute('data-role', 'bg-locked-note')
        note.textContent = '使用自定义背景中——切回「星空极光」后可调'
        note.style.cssText = 'font-size: 11px; color: rgba(255, 255, 255, 0.45); margin-top: 6px;'
        this.backgroundBody.appendChild(note)
      }

      // ===== 自定义背景观感组（v2）：与上面虚空之镜组互为置灰镜像——任一时刻恰有一组可调 =====
      const lockCustomRow = (row: HTMLElement): HTMLElement => {
        row.setAttribute('data-role', 'bg-custom-row')
        if (!locked) {
          row.style.opacity = '0.45'
          row.style.pointerEvents = 'none'
        }
        return row
      }
      this.backgroundBody.appendChild(this.makeGroupHeader(
        '自定义背景', '上传图片/视频背景的观感调节；选中自定义背景后可调', false))
      for (const row of renderRows([
        { key: 'bgOpacity', label: '透明度', help: '往纯黑底压暗背景；1=原样、0=全黑。素材过亮时调低，保主体与歌词可读' },
        { key: 'bgSaturation', label: '饱和度', help: '背景色彩浓度；0=黑白' },
      ])) this.backgroundBody.appendChild(lockCustomRow(row))
      this.backgroundBody.appendChild(lockCustomRow(this.makeToggleRow(
        '呼吸', '背景随音乐响度轻微明暗起伏；关=纯静态',
        () => b.bgBreathe,
        (v) => { b.bgBreathe = v; this.deps.previewBackgroundFx(b); this.deps.commitBackgroundFx(b) },
      )))
      this.backgroundBody.appendChild(lockCustomRow(this.makeToggleRow(
        '显示主体', '把主体粒子形状请回背景之上；星尘与歌词不受影响',
        () => b.bgShowBodies,
        (v) => { b.bgShowBodies = v; this.deps.previewBackgroundFx(b); this.deps.commitBackgroundFx(b) },
      )))
      if (!locked) {
        const note = document.createElement('div')
        note.setAttribute('data-role', 'bg-custom-note')
        note.textContent = '上传并选中自定义背景后可调'
        note.style.cssText = 'font-size: 11px; color: rgba(255, 255, 255, 0.45); margin-top: 6px;'
        this.backgroundBody.appendChild(note)
      }

      this.backgroundBody.appendChild(this.makeGroupHeader(
        '尘埃', '漂浮星尘的密度/大小/亮度；密度 0=只剩零星点缀', false))
      for (const row of renderRows([
        { key: 'dust', label: '尘埃密度', help: '漂浮星尘的数量；鼓点会让星尘加速掠过，0=只剩零星点缀' },
        { key: 'dustSize', label: '尘埃大小', help: '每颗星尘的粒径倍率；调大后星尘更醒目' },
        { key: 'dustBright', label: '尘埃亮度', help: '星尘的发光强度；量程有安全上限，拉满不至于抢主体的戏' },
      ])) this.backgroundBody.appendChild(row)
    } finally {
      this.helpSink = null
    }
  }

  // 五分区容器只读测试口——fake DOM 按创建序扒容器脆，显隐断言走这里
  get generalBodyForTest(): HTMLElement { return this.body }
  get cameraBodyForTest(): HTMLElement { return this.cameraBody }
  get shapeBodyForTest(): HTMLElement { return this.shapeBody }
  get lyricsBodyForTest(): HTMLElement { return this.lyricsBody }
  get backgroundBodyForTest(): HTMLElement { return this.backgroundBody }

  override dispose(): void {
    // 先 drain 五区各自的信息图标（摘各自 tooltip 节点 + 卸监听），再走基座 dispose——防面板销毁后残留孤儿 tooltip
    this.infoDisposers.forEach((d) => d())
    this.infoDisposers = []
    this.cameraDisposers.forEach((d) => d())
    this.cameraDisposers = []
    this.shapeDisposers.forEach((d) => d())
    this.shapeDisposers = []
    this.lyricsDisposers.forEach((d) => d())
    this.lyricsDisposers = []
    this.backgroundDisposers.forEach((d) => d())
    this.backgroundDisposers = []
    super.dispose()
  }
}
