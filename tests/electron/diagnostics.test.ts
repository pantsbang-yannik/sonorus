// 导出诊断（发布准备③）：环形日志淘汰/钳长 + 报告拼装的纯逻辑用例
import { describe, expect, it } from 'vitest'
import { DiagnosticsLog, renderDiagnostics, redactSettings, type DiagEntry } from '../../electron/diagnostics'

const fixedNow = (): Date => new Date('2026-07-21T12:00:00.000Z')

describe('DiagnosticsLog', () => {
  it('按注入时钟打时间戳', () => {
    const log = new DiagnosticsLog(10, fixedNow)
    log.push('info', 'capture', '状态: running')
    expect(log.entries()).toEqual([
      { at: '2026-07-21T12:00:00.000Z', level: 'info', source: 'capture', message: '状态: running' }
    ])
  })

  it('满员淘汰最旧，保留最新（突变验证：淘汰方向不可反）', () => {
    const log = new DiagnosticsLog(3, fixedNow)
    for (let i = 1; i <= 5; i++) log.push('info', 's', `m${i}`)
    expect(log.entries().map((e) => e.message)).toEqual(['m3', 'm4', 'm5'])
  })

  it('超长消息钳到 500 字符（渲染层堆栈防撑爆）', () => {
    const log = new DiagnosticsLog(10, fixedNow)
    log.push('error', 'renderer:window', 'x'.repeat(2000))
    expect(log.entries()[0].message).toHaveLength(500)
  })
})

describe('renderDiagnostics', () => {
  const baseOpts = {
    env: { appVersion: '0.3.0', os: 'macOS 15.5 (arm64)', runtime: 'Electron 31', locale: 'zh-CN' },
    captureStatus: 'running',
    settings: { tier: 'auto', onboarded: true },
    files: [
      { name: 'settings.json', exists: true, bytes: 1234, entries: null },
      { name: 'history/artwork', exists: true, bytes: null, entries: 7 },
      { name: 'lyrics-cache', exists: false, bytes: null, entries: null }
    ],
    log: [{ at: '2026-07-21T11:00:00.000Z', level: 'warn', source: 'capture', message: 'tap 报错' }] as DiagEntry[],
    generatedAt: fixedNow()
  }

  it('环境/捕获状态/文件体检/设置快照/日志全部落进报告', () => {
    const text = renderDiagnostics(baseOpts)
    expect(text).toContain('App 版本: 0.3.0')
    expect(text).toContain('macOS 15.5 (arm64)')
    expect(text).toContain('当前状态: running')
    expect(text).toContain('settings.json: 1.2 KB')
    expect(text).toContain('history/artwork: 7 项')
    expect(text).toContain('lyrics-cache: 不存在')
    expect(text).toContain('"onboarded": true')
    expect(text).toContain('2026-07-21T11:00:00.000Z [warn] capture: tap 报错')
  })

  it('隐私（注入验证，审②P2-5）：自定义文字形状原文脱敏为长度，主目录路径缩写为 ~', () => {
    const settings = redactSettings({
      tier: 'auto',
      shape: {
        current: 'nebula',
        customCurrent: null,
        coverPriority: true,
        customShapes: [
          { id: 'x', kind: 'text', text: '我的秘密歌名' }, // 用户输入完全可能是歌名/人名
          { id: 'y', kind: 'image' }
        ]
      }
    })
    const text = renderDiagnostics({
      ...baseOpts,
      settings,
      homeDir: '/Users/tester',
      log: [{ at: '2026-07-21T11:00:00.000Z', level: 'warn', source: 'capture', message: 'tap 二进制不存在: /Users/tester/dev/audelyra-tap' }]
    })
    expect(text).not.toContain('我的秘密歌名')
    expect(text).toContain('已略去，6 字')
    expect(text).not.toContain('/Users/tester') // macOS 用户名不出报告
    expect(text).toContain('~/dev/audelyra-tap')
    expect(text).toContain('"kind": "image"') // 非文字条目原样保留
  })

  it('redactSettings 对畸形输入原样放行（报告生成永不因脱敏炸掉）', () => {
    expect(redactSettings(null)).toBeNull()
    expect(redactSettings({ shape: 'oops' })).toEqual({ shape: 'oops' })
    expect(redactSettings({ shape: { customShapes: 'oops' } })).toEqual({ shape: { customShapes: 'oops' } })
  })
})
