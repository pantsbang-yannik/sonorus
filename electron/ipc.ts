// electron/ipc.ts
// 渲染 → 主进程的通道注册（M4 设计 2.4 单向环的上行半环）。
// 广播（下行半环 settings:changed / window:mode / ui:openSettings）在 main.ts 装配时经 sendToRenderer 接线。
import { app, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { parseShapeAssetMeta, resolveShapeAssetPath, resolveShapeMetaPath } from './shape-assets'
import { saveCustomShapePng, readCustomShapePng, deleteCustomShapePng, convertToPngViaSips } from './custom-shapes'
import { saveCustomBackgroundJpeg, readCustomBackgroundJpeg, deleteCustomBackground, saveCustomBackgroundVideoFromPath, saveCustomBackgroundThumb, readCustomBackgroundThumb } from './custom-backgrounds'
import { safeArtworkPath, readPlayRecords } from './history'
import type { SettingsStore, SonorusSettings } from './settings'
import type { WindowManager, WindowMode } from './windows'

const MODES: readonly string[] = ['fullscreen', 'windowed']

// 模态仲裁 / 捕获重启 / 系统设置深链（M4 计划② T3）：主进程无状态，全部转交主 wiring 层的钩子
export interface IpcHooks {
  setModalOpen: (open: boolean) => void
  restartCapture: () => void
  openAudioPrefs: () => void
  // 导出诊断（发布准备③）：报告拼装在 main.ts（环境/日志/设置都在那侧），本层只管通道与落盘
  buildDiagnostics: () => string
  logDiag: (source: string, message: string) => void
}

export function wireIpc(store: SettingsStore, wm: WindowManager, hooks: IpcHooks): void {
  ipcMain.handle('settings:get', () => store.get())
  // 版本号展示（发布准备② fb1：设置面板版本行）；更新检查动作在 main.ts 更新装配块（需 runUpdateCheck 状态）
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.on('settings:set', (_e, patch: Partial<SonorusSettings>) => {
    store.set(patch ?? {}) // set 内部 sanitize 全量校验，垃圾 patch 不会污染
  })
  ipcMain.handle('window:getMode', () => wm.getMode())
  ipcMain.on('window:setMode', (_e, m: unknown) => {
    if (MODES.includes(m as string)) wm.setMode(m as WindowMode)
  })
  ipcMain.on('ui:modalOpen', (_e, open: unknown) => hooks.setModalOpen(open === true))
  ipcMain.on('capture:restart', () => hooks.restartCapture())
  ipcMain.on('system:openAudioPrefs', () => hooks.openAudioPrefs())
  // 下载夹落盘（#6 海报 / #8 Drop 视频共用）：文件名渲染层已清洗，basename 兜底防路径穿越（纵深，
  // 同 shape 白名单哲学）；同秒同歌名连拍不覆盖（双审①P4）——存在则补序号
  const saveToDownloads = async (rawName: unknown, ext: 'png' | 'mp4' | 'txt', bytes: Uint8Array): Promise<{ ok: true; path: string }> => {
    let name = basename(String(rawName ?? '') || `Sonorus.${ext}`)
    if (!name.endsWith(`.${ext}`)) name += `.${ext}` // 纵深：无后缀名会让补序号 replace 空转死循环
    const extRe = new RegExp(`\\.${ext}$`)
    let file = join(app.getPath('downloads'), name)
    for (let i = 2; existsSync(file); i++) file = join(app.getPath('downloads'), name.replace(extRe, `-${i}.${ext}`))
    await writeFile(file, Buffer.from(bytes)) // 失败即 invoke reject，渲染层报错提示
    return { ok: true, path: file }
  }
  ipcMain.handle('poster:save', (_e, p: { filename: string; png: Uint8Array }) => saveToDownloads(p?.filename, 'png', p.png))
  ipcMain.handle('clip:save', (_e, p: { filename: string; mp4: Uint8Array }) => saveToDownloads(p?.filename, 'mp4', p.mp4))
  // 导出诊断（发布准备③）：用户主动点击才生成文件，纯本地零上报；文件名时间戳同秒重导有补序号兜底
  ipcMain.handle('diagnostics:export', () => {
    const d = new Date()
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
    return saveToDownloads(`Sonorus-诊断-${stamp}.txt`, 'txt', Buffer.from(hooks.buildDiagnostics(), 'utf8'))
  })
  // 渲染层诊断事件（WebGPU 初始化失败/未捕获错误）：fire-and-forget，载荷不可信——钳长在 hooks 侧统一做
  ipcMain.on('diag:event', (_e, p: unknown) => {
    if (typeof p !== 'object' || p === null) return
    const r = p as Record<string, unknown>
    if (typeof r['source'] !== 'string' || typeof r['message'] !== 'string') return
    hooks.logDiag(r['source'].slice(0, 40), r['message'])
  })
  // 轻提示点击→Finder 定位（fb5）：只放行"下载"文件夹内的路径（渲染层传任意路径也翻不出去，纵深）
  ipcMain.on('poster:reveal', (_e, p: unknown) => {
    const file = String(p ?? '')
    if (dirname(file) === app.getPath('downloads')) shell.showItemInFolder(file)
  })
  ipcMain.handle('shapes:getAsset', async (_e, id: string) => {
    // 打包后 shapes 点云走 extraResources（Resources/assets/shapes/），开发环境走仓库根
    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath()
    const meta = parseShapeAssetMeta(await readFile(resolveShapeMetaPath(id, appPath), 'utf8'), id)
    const bin = await readFile(resolveShapeAssetPath(id, appPath))
    if (bin.byteLength !== meta.count * 24) {
      throw new Error(`shape asset 字节数与 meta 不符: ${id} ${bin.byteLength} != ${meta.count * 24}`)
    }
    return bin
  })
  // 自定义形状图片仓库（idea #12）：userData/custom-shapes/，uuid 白名单在仓库层 assert
  const customShapesDir = join(app.getPath('userData'), 'custom-shapes')
  ipcMain.handle('customShapes:save', (_e, p: { id: string; png: Uint8Array }) =>
    saveCustomShapePng(customShapesDir, String(p?.id ?? ''), p.png))
  ipcMain.handle('customShapes:read', (_e, id: unknown) => readCustomShapePng(customShapesDir, String(id ?? '')))
  ipcMain.handle('customShapes:delete', (_e, id: unknown) => deleteCustomShapePng(customShapesDir, String(id ?? '')))
  ipcMain.handle('customShapes:convert', (_e, bytes: Uint8Array) => convertToPngViaSips(bytes))
  // 自定义背景仓库（v1 图片三件套 + v2 视频/缩略图）：uuid 白名单守卫在仓库层
  const customBackgroundsDir = join(app.getPath('userData'), 'backgrounds')
  ipcMain.handle('customBackgrounds:save', (_e, p: { id: string; jpeg: Uint8Array }) =>
    saveCustomBackgroundJpeg(customBackgroundsDir, String(p?.id ?? ''), p.jpeg))
  ipcMain.handle('customBackgrounds:read', (_e, id: unknown) => readCustomBackgroundJpeg(customBackgroundsDir, String(id ?? '')))
  ipcMain.handle('customBackgrounds:delete', (_e, id: unknown) => deleteCustomBackground(customBackgroundsDir, String(id ?? '')))
  ipcMain.handle('customBackgrounds:saveVideo', (_e, p: { id: string; path: string }) =>
    saveCustomBackgroundVideoFromPath(customBackgroundsDir, String(p?.id ?? ''), String(p?.path ?? '')))
  ipcMain.handle('customBackgrounds:saveThumb', (_e, p: { id: string; jpeg: Uint8Array }) =>
    saveCustomBackgroundThumb(customBackgroundsDir, String(p?.id ?? ''), p.jpeg))
  ipcMain.handle('customBackgrounds:readThumb', (_e, id: unknown) => readCustomBackgroundThumb(customBackgroundsDir, String(id ?? '')))
  // 星系图鉴（idea #4）：历史读取通道。整读 + 坏行容错在 readPlayRecords 内；封面按键取文件，缺失回 null（星退纯光点）
  const historyDir = join(app.getPath('userData'), 'history')
  ipcMain.handle('history:read', () => readPlayRecords(join(historyDir, 'plays.jsonl')))
  ipcMain.handle('history:artwork', async (_e, key: unknown) => {
    const file = safeArtworkPath(join(historyDir, 'artwork'), String(key ?? ''))
    if (!file || !existsSync(file)) return null
    return readFile(file)
  })
}
