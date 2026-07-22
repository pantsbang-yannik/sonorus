import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserializeSignal } from '../../../src/engine/trace'
import type { Signals } from '../../../src/engine/types'

/** 读取 jsonl trace 文件，逐行 deserializeSignal，坏行/null 跳过 */
export function loadTrace(path: string): Signals[] {
  const text = readFileSync(path, 'utf-8')
  return text.split('\n').map(deserializeSignal).filter((s): s is Signals => s !== null)
}

/** 与 engine.ts processHop 同款公式：specLoud 只从 bands 派生，trace 回放与真机同源。
 * C1 T2 留痕回账：此前三份校准测试各自复制本函数，收口单一事实源 */
export function specLoudOf(bands: Signals['bands']): number {
  return bands.low * 1.0 + bands.mid * 0.8 + bands.high * 0.6
}

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'traces')

export const TRACE_FIXTURES = [
  { name: 'zilaishui', path: join(FIXTURES_DIR, 'zilaishui.jsonl') },
  { name: 'tiaowu', path: join(FIXTURES_DIR, 'tiaowu.jsonl') },
  { name: 'qimeidi', path: join(FIXTURES_DIR, 'qimeidi.jsonl') }
]
