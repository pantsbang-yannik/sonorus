// electron/diagnostics.ts
// 导出诊断（发布准备③ spec §3）：纯逻辑——环形事件日志 + 文本报告拼装，零 electron/零 IO。
// 隐私铁律：报告不含任何曲目/听歌数据——采集点只喂错误类别与状态，绝不喂歌名；
// 日志纯内存不落盘，只有用户在设置面板点「导出报告」才产出文件（零上报）。

export type DiagLevel = 'info' | 'warn' | 'error'

export interface DiagEntry {
  at: string
  level: DiagLevel
  source: string
  message: string
}

/** 文件/目录体检项：文件报字节数（entries=null），目录报条目数（bytes=null） */
export interface DiagFileStat {
  name: string
  exists: boolean
  bytes: number | null
  entries: number | null
}

export interface DiagEnv {
  appVersion: string
  os: string
  runtime: string
  locale: string
}

const CAP_DEFAULT = 300
const MESSAGE_MAX = 500 // 渲染层未捕获错误可能带整条堆栈，钳长防单条撑爆报告

export class DiagnosticsLog {
  private buf: DiagEntry[] = []

  constructor(private cap = CAP_DEFAULT, private now: () => Date = () => new Date()) {}

  push(level: DiagLevel, source: string, message: string): void {
    this.buf.push({ at: this.now().toISOString(), level, source, message: String(message).slice(0, MESSAGE_MAX) })
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap) // 满员淘汰最旧
  }

  entries(): readonly DiagEntry[] {
    return this.buf
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtFile(f: DiagFileStat): string {
  if (!f.exists) return `${f.name}: 不存在`
  if (f.entries !== null) return `${f.name}: ${f.entries} 项`
  return `${f.name}: ${fmtBytes(f.bytes ?? 0)}`
}

/** 报告用设置脱敏（审②P1-4）：自定义文字形状的原文是用户任意输入（可能正是歌名/人名），
 * 违背「报告不含曲目数据」承诺——替换为长度记账。其余字段均为布尔/数值/枚举/几何，逐项审过无泄露面 */
export function redactSettings(settings: unknown): unknown {
  if (typeof settings !== 'object' || settings === null) return settings
  const s = settings as Record<string, unknown>
  const shape = s['shape']
  if (typeof shape !== 'object' || shape === null) return settings
  const sh = shape as Record<string, unknown>
  const list = sh['customShapes']
  if (!Array.isArray(list)) return settings
  return {
    ...s,
    shape: {
      ...sh,
      customShapes: list.map((m) => {
        if (typeof m !== 'object' || m === null) return m
        const meta = m as Record<string, unknown>
        return typeof meta['text'] === 'string' ? { ...meta, text: `<已略去，${meta['text'].length} 字>` } : m
      })
    }
  }
}

/** 人类可读文本报告。settings 应经 redactSettings 脱敏后传入；
 * homeDir 提供时把主目录缩写为 ~（审②P2-6：日志/路径不暴露 macOS 用户名） */
export function renderDiagnostics(opts: {
  env: DiagEnv
  captureStatus: string
  settings: unknown
  files: DiagFileStat[]
  log: readonly DiagEntry[]
  generatedAt: Date
  homeDir?: string
}): string {
  const text = [
    'Sonorus 诊断报告',
    `生成时间: ${opts.generatedAt.toISOString()}`,
    '说明: 本报告在本机生成，仅当你主动分享才会离开设备；内容可能含本机文件路径（主目录已缩写为 ~）。',
    '',
    '== 环境 ==',
    `App 版本: ${opts.env.appVersion}`,
    `系统: ${opts.env.os}`,
    `运行时: ${opts.env.runtime}`,
    `语言: ${opts.env.locale}`,
    '',
    '== 系统音频捕获 ==',
    `当前状态: ${opts.captureStatus}`,
    '',
    '== 数据文件 ==',
    ...opts.files.map(fmtFile),
    '',
    '== 设置快照 ==',
    JSON.stringify(opts.settings, null, 2),
    '',
    `== 事件日志（最近 ${opts.log.length} 条）==`,
    ...opts.log.map((e) => `${e.at} [${e.level}] ${e.source}: ${e.message}`),
    ''
  ].join('\n')
  return opts.homeDir ? text.split(opts.homeDir).join('~') : text
}
