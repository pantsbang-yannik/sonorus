import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  customBackgroundPath, saveCustomBackgroundJpeg, readCustomBackgroundJpeg, deleteCustomBackground,
  saveCustomBackgroundVideoFromPath, saveCustomBackgroundThumb, readCustomBackgroundThumb,
  resolveCustomBackgroundFile, backgroundContentType, parseByteRange,
} from '../../electron/custom-backgrounds'

const ID = '11111111-2222-3333-4444-555555555555'

describe('custom-backgrounds 仓库（复刻 custom-shapes 模式：uuid 白名单 + tmp+rename 原子写）', () => {
  it('路径 = dir/<id>.jpg；非法 id（路径穿越/大写/任意串）throw', () => {
    expect(customBackgroundPath('/x', ID)).toBe(join('/x', `${ID}.jpg`))
    for (const bad of ['../evil', 'AAAAAAAA-2222-3333-4444-555555555555', 'foo', ''])
      expect(() => customBackgroundPath('/x', bad)).toThrow()
  })
  it('save → read 往返一致；目录不存在自动建', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'bg-test-')), 'nested')
    const bytes = new Uint8Array([1, 2, 3, 4])
    await saveCustomBackgroundJpeg(dir, ID, bytes)
    expect(new Uint8Array(await readCustomBackgroundJpeg(dir, ID))).toEqual(bytes)
    // 原子写不留 .tmp 残留
    await expect(readFile(join(dir, `${ID}.jpg.tmp`))).rejects.toThrow()
  })
  it('delete 幂等：文件不存在不算错；删后 read 失败', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-test-'))
    await deleteCustomBackground(dir, ID) // 不存在 → 不 throw
    await saveCustomBackgroundJpeg(dir, ID, new Uint8Array([9]))
    await deleteCustomBackground(dir, ID)
    await expect(readCustomBackgroundJpeg(dir, ID)).rejects.toThrow()
  })
})

describe('视频背景仓库（v2：拷原件+候选解析+缩略图）', () => {
  it('contentType 映射：jpg/mp4/mov/webm；未知回 application/octet-stream', () => {
    expect(backgroundContentType('jpg')).toBe('image/jpeg')
    expect(backgroundContentType('mp4')).toBe('video/mp4')
    expect(backgroundContentType('mov')).toBe('video/quicktime')
    expect(backgroundContentType('webm')).toBe('video/webm')
    expect(backgroundContentType('avi')).toBe('application/octet-stream')
  })
  it('saveVideoFromPath：白名单外扩展名 throw；超 500MB throw；合法拷贝落 <id>.<ext>', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bgv-test-'))
    const src = join(dir, 'src.mp4')
    await writeFile(src, new Uint8Array([1, 2, 3]))
    await saveCustomBackgroundVideoFromPath(dir, ID, src)
    expect(new Uint8Array(await readFile(join(dir, `${ID}.mp4`)))).toEqual(new Uint8Array([1, 2, 3]))
    const bad = join(dir, 'src.avi')
    await writeFile(bad, new Uint8Array([1]))
    await expect(saveCustomBackgroundVideoFromPath(dir, ID, bad)).rejects.toThrow()
    // 大小上限：不真写 500MB，用假 statSize 注入不可行 → 改验路径层不可测项留 resolve 层；
    // 上限判断走 stat().size，用 3 字节文件 + 临时改常量不可行——以「白名单+拷贝」为本测试边界，
    // 上限逻辑由「>MAX throw」单元覆盖：见下一条
  })
  it('saveVideoFromPath：maxBytes 形参可注入（默认 500MB），超限 throw 且不落盘', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bgv-test-'))
    const src = join(dir, 'src.webm')
    await writeFile(src, new Uint8Array([1, 2, 3, 4, 5]))
    await expect(saveCustomBackgroundVideoFromPath(dir, ID, src, 4)).rejects.toThrow(/too large/)
    await expect(readFile(join(dir, `${ID}.webm`))).rejects.toThrow()
  })
  it('resolve：jpg 优先返回图片；无 jpg 时按 mp4/mov/webm 找视频；都没有回 null；非法 id 回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bgv-test-'))
    expect(await resolveCustomBackgroundFile(dir, ID)).toBeNull()
    expect(await resolveCustomBackgroundFile(dir, '../evil')).toBeNull()
    const src = join(dir, 'src.mov')
    await writeFile(src, new Uint8Array([7]))
    await saveCustomBackgroundVideoFromPath(dir, ID, src)
    const r = await resolveCustomBackgroundFile(dir, ID)
    expect(r).toEqual({ path: join(dir, `${ID}.mov`), contentType: 'video/quicktime' })
  })
  it('缩略图 save/read 往返；deleteCustomBackground 连删视频与缩略图且幂等', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bgv-test-'))
    const src = join(dir, 'src.mp4')
    await writeFile(src, new Uint8Array([1]))
    await saveCustomBackgroundVideoFromPath(dir, ID, src)
    await saveCustomBackgroundThumb(dir, ID, new Uint8Array([9, 9]))
    expect(new Uint8Array(await readCustomBackgroundThumb(dir, ID))).toEqual(new Uint8Array([9, 9]))
    await deleteCustomBackground(dir, ID)
    await deleteCustomBackground(dir, ID) // 幂等
    expect(await resolveCustomBackgroundFile(dir, ID)).toBeNull()
    await expect(readCustomBackgroundThumb(dir, ID)).rejects.toThrow()
  })
})

describe('parseByteRange（协议 range 语义：net.fetch(file://) 无视 Range 头的黑屏根治）', () => {
  it('无头/坏头/零尺寸 → null（回整文件 200）', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('', 100)).toBeNull()
    expect(parseByteRange('bytes=abc', 100)).toBeNull()
    expect(parseByteRange('items=0-', 100)).toBeNull()
    expect(parseByteRange('bytes=0-', 0)).toBeNull()
  })
  it('bytes=0-（Chromium 媒体栈首请求）→ 全范围', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
  })
  it('bytes=a-b 双端；end 超限钳到文件尾', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })
  it('bytes=a- 开端到尾；start 越界 → null', () => {
    expect(parseByteRange('bytes=40-', 100)).toEqual({ start: 40, end: 99 })
    expect(parseByteRange('bytes=100-', 100)).toBeNull()
  })
  it('bytes=-n 尾部 n 字节（moov 在尾的 mp4 靠它）', () => {
    expect(parseByteRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 })
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })
})
