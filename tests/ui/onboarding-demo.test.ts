// 序幕剧本状态机 + 内置 demo trace 资产完整性（发布准备③ spec §1）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OnboardingDemoScript, DEMO_STATIONS, DEMO_STATION_HINTS } from '../../src/ui/onboarding-demo'
import { TracePlayer, deserializeSignal } from '../../src/engine/trace'

describe('OnboardingDemoScript', () => {
  it('站序即叙事：留声机→卡带→耳机→麦克风→星云', () => {
    expect(DEMO_STATIONS).toEqual(['demo-gramophone', 'demo-cassette', 'demo-headphones', 'demo-mic', 'nebula'])
  })

  it('逐站文案契约：非星云站每站有词（漏配站会静默空文案），星云站无词（落幕交 intro）', () => {
    for (const id of DEMO_STATIONS) {
      if (id === 'nebula') expect(DEMO_STATION_HINTS[id]).toBeUndefined()
      else expect(DEMO_STATION_HINTS[id], `站 ${id} 缺文案`).toBeTruthy()
    }
  })

  it('advance 逐站推进，终点返回 null（多余点击被忽略）', () => {
    const script = new OnboardingDemoScript()
    expect(script.currentShape).toBe('demo-gramophone')
    expect(script.atEnd).toBe(false)
    expect(script.advance()).toBe('demo-cassette')
    expect(script.advance()).toBe('demo-headphones')
    expect(script.advance()).toBe('demo-mic')
    expect(script.atEnd).toBe(false)
    expect(script.advance()).toBe('nebula')
    expect(script.atEnd).toBe(true)
    expect(script.advance()).toBeNull() // 终点后不再动（突变验证：去掉 atEnd 守卫应红）
    expect(script.currentShape).toBe('nebula')
  })

  it('skipToEnd 任意站直达终点', () => {
    const script = new OnboardingDemoScript()
    script.advance()
    expect(script.skipToEnd()).toBe('nebula')
    expect(script.atEnd).toBe(true)
  })

  it('空剧本拒绝构造', () => {
    expect(() => new OnboardingDemoScript([])).toThrow()
  })
})

describe('内置 demo trace 资产（scripts/gen-demo-trace-from-audio.ts 产物，与配乐同源同段）', () => {
  const jsonl = readFileSync(join(__dirname, '../../src/assets/traces/onboarding-demo.jsonl'), 'utf8')

  it('每行都能被 deserializeSignal 解析（行格式与 trace v1 契约一致）', () => {
    const lines = jsonl.split('\n')
    expect(lines.length).toBeGreaterThan(1000)
    for (const line of lines) {
      const s = deserializeSignal(line)
      expect(s).not.toBeNull()
      expect(s!.silence).toBe(false) // 演示信号绝不静音（静音会把星云放回沉睡态）
      expect(s!.spectrum.length).toBe(512)
    }
  })

  it('TracePlayer 视角：时长 ~60s（与内置音频段同长）、鼓点密集、BPM 检出、能量有起伏', () => {
    const player = new TracePlayer(jsonl)
    expect(player.duration).toBeGreaterThan(55) // 音频段 60s：trace 明显偏短=音画不同源，必须红
    expect(player.duration).toBeLessThan(65)
    const all = jsonl.split('\n').map(deserializeSignal)
    expect(all.filter((s) => s!.beat.onBeat).length).toBeGreaterThan(50) // 真歌段落鼓点应密集（合成占位仅稀疏几拍）
    expect(all.some((s) => s!.bpm !== null)).toBe(true) // 节拍器在这段上能锁 BPM
    const energies = all.map((s) => s!.energy)
    expect(Math.max(...energies) - Math.min(...energies)).toBeGreaterThan(0.3)
    // 不再断言 drop：真实音乐段落不保证有爆发沿（原合成 trace 人为编排恰 1 次）
  })
})
