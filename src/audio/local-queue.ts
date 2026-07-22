// 本地播放会话队列（V2）：纯逻辑零 DOM，增删/切换/循环/删当前全部边界可单测。
// 手动 next/prev 永远回绕；loop 只管播完自动推进（advance）：开=回第一首，关=null（播完停）。
// 会话级：不落盘，关应用/关控制条即 clear。
import { displayName } from './audio-file'

export type TagState =
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'tagged'; title: string; artist: string; duration: number | null; coverBytes: Uint8Array | null; coverMime: string | null; coverDataUrl: string | null }

export interface QueueTrack {
  readonly id: number
  readonly file: File
  readonly displayName: string
  tag: TagState
}

export class LocalQueue {
  private items: QueueTrack[] = []
  private currentId: number | null = null
  private nextId = 1
  private _loop = false

  get tracks(): readonly QueueTrack[] { return this.items }
  get size(): number { return this.items.length }
  get loop(): boolean { return this._loop }
  setLoop(on: boolean): void { this._loop = on }
  get current(): QueueTrack | null { return this.items.find((t) => t.id === this.currentId) ?? null }
  get currentIndex(): number { return this.items.findIndex((t) => t.id === this.currentId) }

  /** 追加入队；队列原为空时当前指到第一首新增 */
  add(files: File[]): QueueTrack[] {
    const added = files.map((file) => ({ id: this.nextId++, file, displayName: displayName(file.name), tag: { kind: 'pending' } as TagState }))
    const wasEmpty = this.items.length === 0
    this.items.push(...added)
    if (wasEmpty && added.length > 0) this.currentId = added[0]!.id
    return added
  }

  setTag(id: number, tag: TagState): void {
    const t = this.items.find((x) => x.id === id)
    if (t) t.tag = tag
  }

  next(): QueueTrack | null { return this.step(1) }
  prev(): QueueTrack | null { return this.step(-1) }

  private step(dir: 1 | -1): QueueTrack | null {
    const n = this.items.length
    if (n === 0) return null
    const idx = this.currentIndex
    const target = this.items[((idx < 0 ? 0 : idx + dir) + n) % n]!
    this.currentId = target.id
    return target
  }

  /** 播完自动推进：尾部时 loop 开→回第一首，关→null（当前清空=队列播完） */
  advance(): QueueTrack | null {
    const idx = this.currentIndex
    if (this.items.length === 0 || idx < 0) return null
    if (idx + 1 < this.items.length) { this.currentId = this.items[idx + 1]!.id; return this.items[idx + 1]! }
    if (this._loop) { this.currentId = this.items[0]!.id; return this.items[0]! }
    this.currentId = null
    return null
  }

  jumpTo(id: number): QueueTrack | null {
    const t = this.items.find((x) => x.id === id) ?? null
    if (t) this.currentId = t.id
    return t
  }

  /** 删指定项。删的是当前项时给出接班者（原位次顶上，尾部回绕到第一首）；删空 next=null */
  remove(id: number): { removedCurrent: boolean; next: QueueTrack | null } {
    const idx = this.items.findIndex((x) => x.id === id)
    if (idx < 0) return { removedCurrent: false, next: null }
    const wasCurrent = this.items[idx]!.id === this.currentId
    this.items.splice(idx, 1)
    if (!wasCurrent) return { removedCurrent: false, next: null }
    if (this.items.length === 0) { this.currentId = null; return { removedCurrent: true, next: null } }
    const successor = this.items[idx % this.items.length]!
    this.currentId = successor.id
    return { removedCurrent: true, next: successor }
  }

  clear(): void {
    this.items = []
    this.currentId = null
  }
}
