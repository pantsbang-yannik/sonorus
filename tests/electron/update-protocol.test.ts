import { describe, it, expect } from 'vitest'
import {
  parseSemver, compareSemver, sanitizeManifest, decideUpdate, reduceDecision, canOpenUrl, settleSkip,
  type UpdateManifest, type ActiveDecision
} from '../../electron/update/protocol'

function manifest(over: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    version: '0.2.0',
    minVersion: '0.1.0',
    publishedAt: '2026-08-01',
    notes: '亮点',
    downloadUrl: 'https://example.com/Sonorus.dmg',
    mirrorUrl: null,
    ...over
  }
}

describe('parseSemver', () => {
  it('合法三段数字', () => {
    expect(parseSemver('0.1.0')).toEqual([0, 1, 0])
    expect(parseSemver('12.34.56')).toEqual([12, 34, 56])
  })
  it('非法输入全拒：预发布号/两段/前导零/非字符串', () => {
    expect(parseSemver('1.0.0-beta')).toBeNull()
    expect(parseSemver('1.0')).toBeNull()
    expect(parseSemver('01.0.0')).toBeNull()
    expect(parseSemver('v1.0.0')).toBeNull()
    expect(parseSemver(100)).toBeNull()
    expect(parseSemver(null)).toBeNull()
    expect(parseSemver('')).toBeNull()
  })
})

describe('compareSemver', () => {
  it('数字比较而非字典序：0.10.0 > 0.9.0', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
  })
  it('高位优先：1.0.0 > 0.99.99', () => {
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })
  it('相等为 0，低于为负', () => {
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0)
    expect(compareSemver('0.1.9', '0.2.0')).toBeLessThan(0)
  })
})

describe('sanitizeManifest', () => {
  it('合法清单原样通过，多余字段丢弃', () => {
    const m = sanitizeManifest({ ...manifest(), futureField: 1 })
    expect(m).toEqual(manifest())
  })
  it('三必填任一非法 → 整体作废', () => {
    expect(sanitizeManifest(manifest({ version: '1.0' }))).toBeNull()
    expect(sanitizeManifest(manifest({ minVersion: 'x' }))).toBeNull()
    expect(sanitizeManifest({ ...manifest(), downloadUrl: 'not-a-url' })).toBeNull()
    expect(sanitizeManifest({ ...manifest(), downloadUrl: 'http://insecure.com/a.dmg' })).toBeNull()
  })
  it('非对象输入 → null', () => {
    expect(sanitizeManifest(null)).toBeNull()
    expect(sanitizeManifest('json string')).toBeNull()
    expect(sanitizeManifest(undefined)).toBeNull()
  })
  it('可选字段非法回退 null；mirrorUrl 须 https', () => {
    const m = sanitizeManifest(manifest({ publishedAt: 42 as unknown as string, notes: '' , mirrorUrl: 'ftp://x' }))
    expect(m).toEqual(manifest({ publishedAt: null, notes: null, mirrorUrl: null }))
  })
  it('mirrorUrl 合法保留', () => {
    expect(sanitizeManifest(manifest({ mirrorUrl: 'https://mirror.cn/a.dmg' }))?.mirrorUrl).toBe('https://mirror.cn/a.dmg')
  })
  it('minVersion > version 属运维误配 → 整体作废（审①M4）', () => {
    expect(sanitizeManifest(manifest({ minVersion: '0.3.0' }))).toBeNull()
    expect(sanitizeManifest(manifest({ minVersion: '0.2.0' }))).not.toBeNull() // 相等合法（强更到本版）
  })
})

describe('decideUpdate 三态', () => {
  it('清单 null / 当前版本非法 → none', () => {
    expect(decideUpdate('0.1.0', null, null, false).kind).toBe('none')
    expect(decideUpdate('dev', manifest(), null, false).kind).toBe('none')
  })
  it('远端 ≤ 当前 → none（等于与低于都算）', () => {
    expect(decideUpdate('0.2.0', manifest(), null, false).kind).toBe('none')
    expect(decideUpdate('0.3.0', manifest(), null, false).kind).toBe('none')
  })
  it('远端更新且当前 ≥ minVersion → optional，带回清单', () => {
    const d = decideUpdate('0.1.0', manifest(), null, false)
    expect(d.kind).toBe('optional')
    expect(d.kind === 'optional' && d.manifest.version).toBe('0.2.0')
  })
  it('当前 < minVersion → forced', () => {
    const d = decideUpdate('0.1.0', manifest({ minVersion: '0.1.1' }), null, false)
    expect(d.kind).toBe('forced')
  })
  it('skip 命中：自动检查归 none，手动检查无视 skip', () => {
    expect(decideUpdate('0.1.0', manifest(), '0.2.0', false).kind).toBe('none')
    expect(decideUpdate('0.1.0', manifest(), '0.2.0', true).kind).toBe('optional')
  })
  it('skip 只对同版本生效：更高版本出现重新提示', () => {
    expect(decideUpdate('0.1.0', manifest({ version: '0.3.0' }), '0.2.0', false).kind).toBe('optional')
  })
  it('forced 无视 skip（跳过的版本后来变成 minVersion 门槛也拦得住）', () => {
    expect(decideUpdate('0.1.0', manifest({ minVersion: '0.2.0' }), '0.2.0', false).kind).toBe('forced')
  })
})

describe('决策记账（审修 C1：屏上按钮不能因一次失败检查变死键）', () => {
  const active: ActiveDecision = { kind: 'optional', manifest: manifest() }
  const forced: ActiveDecision = { kind: 'forced', manifest: manifest({ minVersion: '0.2.0' }) }

  it('reduceDecision：none（检查失败/skip 命中/远端回滚）不冲帐，保持原值', () => {
    expect(reduceDecision(active, { kind: 'none' })).toBe(active)
    expect(reduceDecision(forced, { kind: 'none' })).toBe(forced)
    expect(reduceDecision(null, { kind: 'none' })).toBeNull()
  })
  it('reduceDecision：新的非 none 决策覆盖旧决策', () => {
    expect(reduceDecision(active, forced)).toBe(forced)
    expect(reduceDecision(null, active)).toBe(active)
  })

  it('canOpenUrl：只放行当前清单的主/镜像地址；无决策一律拒', () => {
    expect(canOpenUrl(active, 'https://example.com/Sonorus.dmg')).toBe(true)
    expect(canOpenUrl(active, 'https://evil.com/x.dmg')).toBe(false)
    expect(canOpenUrl(null, 'https://example.com/Sonorus.dmg')).toBe(false)
  })
  it('canOpenUrl：mirrorUrl 为 null 时字符串 "null" 也放不行；非空镜像放行', () => {
    expect(canOpenUrl(active, 'null')).toBe(false)
    const withMirror: ActiveDecision = { kind: 'optional', manifest: manifest({ mirrorUrl: 'https://cn.example.com/a.dmg' }) }
    expect(canOpenUrl(withMirror, 'https://cn.example.com/a.dmg')).toBe(true)
  })

  it('settleSkip：optional 且版本匹配才结算；forced 不可跳过；版本不匹配/无决策拒绝', () => {
    expect(settleSkip(active, '0.2.0')).toBe('0.2.0')
    expect(settleSkip(forced, '0.2.0')).toBeNull()
    expect(settleSkip(active, '0.3.0')).toBeNull()
    expect(settleSkip(null, '0.2.0')).toBeNull()
  })
})
