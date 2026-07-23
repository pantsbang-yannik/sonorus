import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../../electron/settings'
import { defaultRhythmPreset } from '../../src/scenes/nebula/mapping/spec'
import { DEFAULT_LYRICS_SETTINGS } from '../../src/scenes/nebula/lyrics/lyrics-fx'
import { DEFAULT_CAMERA_SETTINGS } from '../../src/scenes/nebula/camera-types'

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'audelyra-settings-')), 'settings.json')

describe('sanitizeSettings', () => {
  it('非对象输入回退全默认', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('逐字段校验：非法字段回退默认，合法字段保留', () => {
    // showTrackBadge 已退役（亲验期拍板：角标恒显示不可配）——旧存档残留该键走"多余字段被丢弃"路径
    const s = sanitizeSettings({ tier: 'ultra', showTrackBadge: false, winBounds: 'xl', preventSleep: 1 })
    expect(s.tier).toBe('auto') // 'ultra' 不在设置枚举（面板只暴露 自动/高/中/低）
    expect('showTrackBadge' in s).toBe(false)
    expect(s.winBounds).toBeNull()
    expect(s.preventSleep).toBe(false)
  })

  it('title：默认 {timed,1}，合法透传，scale 钳位，旧字段 showParticleTitle=false 迁移为 off', () => {
    expect(sanitizeSettings({}).title).toEqual({ mode: 'timed', position: 1.35, scale: 1, brightness: 1 })
    expect(sanitizeSettings({ title: { mode: 'always', position: -1.35, scale: 1.4, brightness: 0.6 } }).title).toEqual({ mode: 'always', position: -1.35, scale: 1.4, brightness: 0.6 })
    // position 旧三档字符串（'bottom'）与非法字符串（'left'）都走 sanitizePositionY 迁移/回默认（歌词位置滑块 spec §3）
    expect(sanitizeSettings({ title: { mode: 'always', position: 'bottom', scale: 1.4, brightness: 0.6 } }).title).toEqual({ mode: 'always', position: -1.35, scale: 1.4, brightness: 0.6 })
    expect(sanitizeSettings({ title: { mode: 'huge', position: 'left', scale: 99, brightness: 99 } }).title).toEqual({ mode: 'timed', position: 1.35, scale: 2, brightness: 2 })
    expect(sanitizeSettings({ showParticleTitle: false }).title.mode).toBe('off') // 首版布尔存档迁移
    expect(sanitizeSettings({ showParticleTitle: true }).title.mode).toBe('timed')
  })

  it('lyrics 字段：缺失回默认（DEFAULT_LYRICS_SETTINGS），非法逐字段回退', () => {
    expect(sanitizeSettings({}).lyrics).toEqual(DEFAULT_LYRICS_SETTINGS)
    expect(sanitizeSettings({ lyrics: { enabled: false, scale: 0.7, position: 'top' } }).lyrics)
      .toEqual({ ...DEFAULT_LYRICS_SETTINGS, enabled: false, position: 1.35, scale: 0.7 })
    expect(sanitizeSettings({ lyrics: { position: 'left' } }).lyrics.position).toBe(DEFAULT_LYRICS_SETTINGS.position) // 非法档回退
  })

  it('winBounds：合法对象（四字段有限数、width/height 落在 [200,8192]）原样保留', () => {
    const b = { x: 10, y: 20, width: 400, height: 300 }
    expect(sanitizeSettings({ winBounds: b }).winBounds).toEqual(b)
  })

  it('winBounds：非法输入一律回退 null（缺字段/非数字/越界/非对象）', () => {
    expect(sanitizeSettings({ winBounds: null }).winBounds).toBeNull()
    expect(sanitizeSettings({ winBounds: undefined }).winBounds).toBeNull()
    expect(sanitizeSettings({ winBounds: 'nope' }).winBounds).toBeNull()
    expect(sanitizeSettings({ winBounds: { x: 0, y: 0, width: 400 } }).winBounds).toBeNull() // 缺 height
    expect(sanitizeSettings({ winBounds: { x: 0, y: 0, width: '400', height: 300 } }).winBounds).toBeNull() // 非数字
    expect(sanitizeSettings({ winBounds: { x: 0, y: 0, width: 199, height: 300 } }).winBounds).toBeNull() // width 越界下限
    expect(sanitizeSettings({ winBounds: { x: 0, y: 0, width: 400, height: 8193 } }).winBounds).toBeNull() // height 越界上限
  })

  it('多余字段被丢弃', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, evil: 'x' }) as unknown as Record<string, unknown>
    expect('evil' in s).toBe(false)
  })

  it('updateCheck（发布准备②）：缺失回默认 {enabled:true,null}；skippedVersion 须合法 semver 否则清空', () => {
    expect(sanitizeSettings({}).updateCheck).toEqual({ enabled: true, skippedVersion: null })
    expect(sanitizeSettings({ updateCheck: { enabled: false, skippedVersion: '0.2.0' } }).updateCheck)
      .toEqual({ enabled: false, skippedVersion: '0.2.0' })
    expect(sanitizeSettings({ updateCheck: { enabled: 'yes', skippedVersion: 'v2' } }).updateCheck)
      .toEqual({ enabled: true, skippedVersion: null })
    expect(sanitizeSettings({ updateCheck: 'junk' }).updateCheck).toEqual({ enabled: true, skippedVersion: null })
  })
})

describe('settings.mapping 持久化', () => {
  it('DEFAULT_SETTINGS 带默认预设', () => {
    expect(DEFAULT_SETTINGS.mapping).toEqual(defaultRhythmPreset())
  })
  it('缺失 mapping 回退默认预设', () => {
    const s = sanitizeSettings({ tier: 'auto' })
    expect(s.mapping).toEqual(defaultRhythmPreset())
  })
  it('非法 mapping 被 sanitize（非法 source 回退）', () => {
    const raw = { ...DEFAULT_SETTINGS, mapping: { version: 1, targets: { thickness: { primary: { source: 'high' } } } } }
    const s = sanitizeSettings(raw)
    expect(s.mapping.targets.thickness.primary.source).toBe('low')
  })
})

describe('SettingsStore', () => {
  it('文件不存在时启动为默认值，不写盘', () => {
    const f = tmpFile()
    const store = new SettingsStore(f)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(existsSync(f)).toBe(false)
  })

  it('set 合并 patch、落盘、可被新实例读回（持久化闭环）', () => {
    const f = tmpFile()
    new SettingsStore(f).set({ tier: 'low', onboarded: true })
    const reloaded = new SettingsStore(f)
    expect(reloaded.get().tier).toBe('low')
    expect(reloaded.get().onboarded).toBe(true)
    expect(reloaded.get().preventSleep).toBe(false) // 未 patch 字段保持默认
  })

  it('损坏 JSON 回退默认值，不抛', () => {
    const f = tmpFile()
    writeFileSync(f, '{ tier: "high", 这不是合法JSON')
    expect(new SettingsStore(f).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('set 通知订阅者，退订后不再通知', () => {
    const store = new SettingsStore(tmpFile())
    const seen: string[] = []
    const off = store.subscribe((s) => seen.push(s.tier))
    store.set({ tier: 'mid' })
    off()
    store.set({ tier: 'high' })
    expect(seen).toEqual(['mid'])
  })

  it('落盘文件是合法 JSON（原子写不留 tmp 残骸）', () => {
    const f = tmpFile()
    new SettingsStore(f).set({ preventSleep: true })
    expect(JSON.parse(readFileSync(f, 'utf8')).preventSleep).toBe(true)
    expect(existsSync(f + '.tmp')).toBe(false)
  })

  it('set 无实际变化：不通知订阅者、不写盘', () => {
    const f = tmpFile()
    const store = new SettingsStore(f)
    store.set({ tier: 'low' })
    const seen: string[] = []
    store.subscribe((s) => seen.push(s.tier))
    store.set({ tier: 'low' }) // 同值
    store.set({}) // 空 patch
    expect(seen).toEqual([])
  })

  it('get 返回拷贝：外部改动不污染内部状态（含嵌套 winBounds）', () => {
    const store = new SettingsStore(tmpFile())
    store.set({ winBounds: { x: 1, y: 2, width: 400, height: 300 } })
    const snap = store.get()
    ;(snap as { tier: string }).tier = 'low'
    snap.winBounds!.x = 999
    expect(store.get().tier).toBe('auto')
    expect(store.get().winBounds!.x).toBe(1)
  })

  it('winBounds 同值重复 set 不通知订阅者（sanitize 每次生成新对象引用，changed 判断需按值比较）', () => {
    const store = new SettingsStore(tmpFile())
    const bounds = { x: 10, y: 20, width: 400, height: 300 }
    store.set({ winBounds: bounds })
    const seen: unknown[] = []
    store.subscribe((s) => seen.push(s.winBounds))
    store.set({ winBounds: { x: 10, y: 20, width: 400, height: 300 } }) // 值相同、新对象引用
    expect(seen).toEqual([])
    store.set({ winBounds: { x: 11, y: 20, width: 400, height: 300 } }) // 真变化
    expect(seen.length).toBe(1)
  })
})

describe('shape 设置（Phase B1 T8）', () => {
  it('sanitize：坏枚举/缺字段回默认 {nebula, coverPriority:false}（发布准备③ 封面默认关）', () => {
    const s = sanitizeSettings({ shape: { current: 'cube', coverPriority: 1 } })
    expect(s.shape).toEqual({ current: 'nebula', customCurrent: null, customShapes: [], coverPriority: false })
    expect(sanitizeSettings({}).shape).toEqual({ current: 'nebula', customCurrent: null, customShapes: [], coverPriority: false })
  })

  it('set/get 往返保留合法值，get 返回深拷贝（改返回值不污染内部）', () => {
    const store = new SettingsStore(tmpFile())
    const out = store.set({ shape: { current: 'sphere', coverPriority: false, customCurrent: null, customShapes: [] } })
    expect(out.shape).toEqual({ current: 'sphere', customCurrent: null, customShapes: [], coverPriority: false })
    out.shape.current = 'nebula'
    expect(store.get().shape.current).toBe('sphere')
  })

  it('防回声（评审 I4）：set 无关字段不误判 shape 变更——不广播', () => {
    const store = new SettingsStore(tmpFile())
    store.set({ shape: { current: 'sphere', coverPriority: true, customCurrent: null, customShapes: [] } })
    let calls = 0
    store.subscribe(() => { calls++ })
    store.set({ preventSleep: true }) // 无关标量：应且仅应广播这一次
    expect(calls).toBe(1)
    store.set({ preventSleep: true }) // 完全无变化：不广播（shape 若被误判会破坏此短路）
    expect(calls).toBe(1)
    store.set({ shape: { current: 'sphere', coverPriority: true, customCurrent: null, customShapes: [] } }) // shape 同值：不广播
    expect(calls).toBe(1)
  })
})

describe('motion 设置（Phase C2 T1）', () => {
  it('motion 字段坏数据回默认、出界钳限幅', () => {
    const s = sanitizeSettings({ motion: { bombIntensity: 99, strobeEnabled: 'yes' } })
    expect(s.motion.bombIntensity).toBe(2)
    expect(s.motion.strobeEnabled).toBe(true)
  })
})

describe('camera 设置（Phase D）', () => {
  it('camera 字段坏数据回默认、出界钳限幅', () => {
    const s = sanitizeSettings({ camera: { liveliness: 99 } })
    expect(s.camera.liveliness).toBe(2)
    expect(sanitizeSettings({}).camera.liveliness).toBe(DEFAULT_CAMERA_SETTINGS.liveliness)
  })
})

describe('lyrics 设置（歌词二期批1 T5）', () => {
  it('lyrics 变更触发落盘广播（OBJECT_KEYS 按值比较）', () => {
    const store = new SettingsStore(tmpFile())
    const before = store.get().lyrics.enabled
    store.set({ lyrics: { ...store.get().lyrics, enabled: !before } })
    expect(store.get().lyrics.enabled).toBe(!before)
  })
})

describe('background 设置（虚空之镜 Task 1）', () => {
  it('background 字段：缺失回默认、出界钳限幅、坏 patch 不落盘', () => {
    expect(sanitizeSettings({}).background).toEqual({ aurora: 1, ripple: 1, dust: 0.7, dustSize: 1, dustBright: 1, mirror: true, customBackgrounds: [], current: 'aurora', bgOpacity: 0.8, bgSaturation: 1, bgBreathe: true, bgShowBodies: false })
    expect(sanitizeSettings({ background: { aurora: 5, ripple: -2, dust: 2 } }).background)
      .toEqual({ aurora: 1, ripple: 0, dust: 1, dustSize: 1, dustBright: 1, mirror: true, customBackgrounds: [], current: 'aurora', bgOpacity: 0.8, bgSaturation: 1, bgBreathe: true, bgShowBodies: false })
  })
})
