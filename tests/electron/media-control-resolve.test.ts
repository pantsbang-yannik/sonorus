import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBinary } from '../../electron/nowplaying/mac'

// process.resourcesPath 是 Electron 注入的属性，node 测试环境下可直接赋值模拟
const proc = process as unknown as { resourcesPath?: string }

describe('resolveBinary 打包环境候选', () => {
  let tmp: string | null = null
  const origRes = proc.resourcesPath
  const origEnv = process.env.SONORUS_MEDIA_CONTROL

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = null
    proc.resourcesPath = origRes
    if (origEnv === undefined) delete process.env.SONORUS_MEDIA_CONTROL
    else process.env.SONORUS_MEDIA_CONTROL = origEnv
  })

  it('resourcesPath 下存在捆绑副本时优先返回它', () => {
    tmp = mkdtempSync(join(tmpdir(), 'sonorus-mc-'))
    const bin = join(tmp, 'media-control', 'bin', 'media-control')
    mkdirSync(join(tmp, 'media-control', 'bin'), { recursive: true })
    writeFileSync(bin, '#!/usr/bin/perl\n')
    delete process.env.SONORUS_MEDIA_CONTROL
    proc.resourcesPath = tmp
    expect(resolveBinary()).toBe(bin)
  })

  it('SONORUS_MEDIA_CONTROL 环境变量仍优先于捆绑副本', () => {
    tmp = mkdtempSync(join(tmpdir(), 'sonorus-mc-'))
    const envBin = join(tmp, 'custom-mc')
    writeFileSync(envBin, '#!/usr/bin/perl\n')
    const bundled = join(tmp, 'media-control', 'bin', 'media-control')
    mkdirSync(join(tmp, 'media-control', 'bin'), { recursive: true })
    writeFileSync(bundled, '#!/usr/bin/perl\n')
    process.env.SONORUS_MEDIA_CONTROL = envBin
    proc.resourcesPath = tmp
    expect(resolveBinary()).toBe(envBin)
  })
})
