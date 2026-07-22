import { describe, it, expect, vi } from 'vitest'
import { CustomShapeController, setCustomShapeFetcher } from '../../src/scenes/nebula/custom-shapes'

const UID1 = '00000001-0000-4000-8000-000000000000'
const UID2 = '00000002-0000-4000-8000-000000000000'
const textMeta = { id: UID1, kind: 'text' as const, text: '你好' }

describe('CustomShapeController', () => {
  it('setSource(null)：清空状态并触发重仲裁', () => {
    const onCloudChanged = vi.fn()
    const c = new CustomShapeController(8, { onCloudChanged })
    c.setSource(textMeta)
    onCloudChanged.mockClear()
    c.setSource(null)
    expect(c.state).toBeNull()
    expect(onCloudChanged).toHaveBeenCalledTimes(1)
  })

  it('同源短路：落盘回流/无关设置广播不重复加载', () => {
    const onCloudChanged = vi.fn()
    const c = new CustomShapeController(8, { onCloudChanged })
    c.setSource(textMeta)
    const n = onCloudChanged.mock.calls.length
    c.setSource({ ...textMeta })
    expect(onCloudChanged.mock.calls.length).toBe(n)
  })

  it('text 源（node 无 DOM）：state.kind=text、cloud=null（渲染端有 DOM 时同一路径产出点云）', () => {
    const c = new CustomShapeController(8, { onCloudChanged: () => {} })
    c.setSource(textMeta)
    expect(c.state).toEqual({ cloud: null, kind: 'text' })
  })

  it('image 源加载失败：state 保持 kind=image + cloud=null（仲裁回退 free），仍通知重仲裁', async () => {
    setCustomShapeFetcher(() => Promise.reject(new Error('boom')))
    const onCloudChanged = vi.fn()
    const c = new CustomShapeController(8, { onCloudChanged })
    c.setSource({ id: UID2, kind: 'image' })
    await vi.waitFor(() => expect(onCloudChanged).toHaveBeenCalled())
    expect(c.state).toEqual({ cloud: null, kind: 'image' })
  })

  it('token 竞态：换源后旧加载的迟到失败不覆盖新状态', async () => {
    let rejectOld: (e: Error) => void = () => {}
    setCustomShapeFetcher(() => new Promise((_res, rej) => { rejectOld = rej }))
    const c = new CustomShapeController(8, { onCloudChanged: () => {} })
    c.setSource({ id: UID2, kind: 'image' }) // 在途
    c.setSource(textMeta) // 换源
    rejectOld(new Error('stale'))
    await Promise.resolve()
    expect(c.state?.kind).toBe('text')
  })
})
