// 'cover' 语义已泛化 = 「有吸附形态」（封面或几何形状，Phase B1）；枚举字符串保留避免波及调用面
export type NebulaState = 'sleep' | 'awakening' | 'nebula' | 'cover'

export class NebulaStateMachine {
  private _state: NebulaState = 'sleep'
  private _progress = 0
  private silenceSec = 0
  private readonly sleepAfterSec: number
  private _awakeningSec: number

  constructor(opts: { sleepAfterSec?: number; awakeningSec?: number } = {}) {
    this.sleepAfterSec = opts.sleepAfterSec ?? 10
    this._awakeningSec = opts.awakeningSec ?? 2.5
  }

  get state(): NebulaState {
    return this._state
  }

  get awakenProgress(): number {
    return this._progress
  }

  set awakeningSec(sec: number) {
    this._awakeningSec = sec
  }

  update(dt: number, input: { silence: boolean; hasTarget: boolean }): NebulaState {
    this.silenceSec = input.silence ? this.silenceSec + dt : 0

    switch (this._state) {
      case 'sleep':
        if (!input.silence) this._state = 'awakening'
        break
      case 'awakening':
        this._progress = Math.min(1, this._progress + dt / this._awakeningSec)
        if (this._progress >= 1) this._state = input.hasTarget ? 'cover' : 'nebula'
        break
      case 'nebula':
        if (input.hasTarget) this._state = 'cover'
        break
      case 'cover':
        if (!input.hasTarget) this._state = 'nebula'
        break
    }

    if (this._state !== 'sleep' && this._state !== 'awakening' && this.silenceSec >= this.sleepAfterSec) {
      this._state = 'sleep'
      this._progress = 0
      this.silenceSec = 0
    }
    return this._state
  }
}
