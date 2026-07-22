// 更新协议纯函数（发布准备② spec）：latest.json 逐字段清洗 + semver 比较 + 三态判定。
// 零 electron/网络依赖以便单测；一切非法输入都收敛为「无更新」，绝不抛错到调用方。

/** latest.json 清洗后的形状。未知多余字段一律忽略（向前兼容 electron-updater 期扩展） */
export interface UpdateManifest {
  version: string
  minVersion: string
  publishedAt: string | null
  notes: string | null
  downloadUrl: string
  mirrorUrl: string | null
}

export type UpdateDecision =
  | { kind: 'none' }
  | { kind: 'optional'; manifest: UpdateManifest }
  | { kind: 'forced'; manifest: UpdateManifest }

/** 严格三段数字 semver（x.y.z）；预发布号（-beta 等）v1 不支持，协议侧禁用（spec 边界） */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const m = SEMVER_RE.exec(v)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 比较两个合法 semver：a<b → 负，a===b → 0，a>b → 正。任一非法按相等处理（调用方已先清洗，此为纵深） */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  }
  return 0
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

function optionalText(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 逐字段清洗（settings.ts 惯例）：version/minVersion/downloadUrl 三必填任一非法 → 整体作废（null），
 * 本次检查按「无更新」静默处理；可选字段非法回退 null */
export function sanitizeManifest(raw: unknown): UpdateManifest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const version = parseSemver(r['version']) ? (r['version'] as string) : null
  const minVersion = parseSemver(r['minVersion']) ? (r['minVersion'] as string) : null
  const downloadUrl = httpsUrl(r['downloadUrl'])
  if (!version || !minVersion || !downloadUrl) return null
  // minVersion > version 是运维误配（会强更去下载一个"仍低于门槛"的版本）——整体作废按无更新处理（审①M4）
  if (compareSemver(minVersion, version) > 0) return null
  return {
    version,
    minVersion,
    publishedAt: optionalText(r['publishedAt']),
    notes: optionalText(r['notes']),
    downloadUrl,
    mirrorUrl: httpsUrl(r['mirrorUrl'])
  }
}

/** 三态判定（spec 状态机）：
 * - 远端 version ≤ 当前 → none
 * - 当前 < minVersion → forced（强更无视 skip）
 * - 其余 → optional；自动检查时命中 skippedVersion 也归 none，手动检查无视 skip */
export function decideUpdate(
  currentVersion: string,
  manifest: UpdateManifest | null,
  skippedVersion: string | null,
  manual: boolean
): UpdateDecision {
  if (!manifest || !parseSemver(currentVersion)) return { kind: 'none' }
  if (compareSemver(manifest.version, currentVersion) <= 0) return { kind: 'none' }
  if (compareSemver(currentVersion, manifest.minVersion) < 0) return { kind: 'forced', manifest }
  if (!manual && skippedVersion !== null && skippedVersion === manifest.version) return { kind: 'none' }
  return { kind: 'optional', manifest }
}

/** 未结算决策（主进程记账态）：渲染层屏上卡片/阻断层对应的那份清单 */
export type ActiveDecision = Exclude<UpdateDecision, { kind: 'none' }>

/** 决策记账归约（审修 C1）：只被新的非 none 决策覆盖——检查失败/skip 命中/远端回滚产出的 none
 * 一律保持原值。卡片无自动消失、阻断层不可关闭，屏上决策若被 none 冲掉，下载白名单与 skip 结算
 * 全部拿不到清单，按钮静默变死键（forced 场景=用户被锁死）。结算清空的唯一出口是 settleSkip。 */
export function reduceDecision(prev: ActiveDecision | null, next: UpdateDecision): ActiveDecision | null {
  return next.kind === 'none' ? prev : next
}

/** 下载链接白名单：只放行当前决策清单里的主/镜像地址（纵深：渲染层伪造任意 URL 也打不开） */
export function canOpenUrl(current: ActiveDecision | null, url: string): boolean {
  if (!current) return false
  const m = current.manifest
  return url === m.downloadUrl || (m.mirrorUrl !== null && url === m.mirrorUrl)
}

/** 「跳过此版本」结算：只认 optional 且版本匹配（forced 不可跳过；版本对不上=陈旧点击）。
 * 返回要记账的版本号，拒绝返回 null */
export function settleSkip(current: ActiveDecision | null, version: string): string | null {
  if (current?.kind !== 'optional' || version !== current.manifest.version) return null
  return current.manifest.version
}
