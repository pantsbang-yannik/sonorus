/** 确定性 xorshift（同 particles.ts makeSphereShell 手法）：同 seed 同序列，测试与记忆化都靠它 */
export function makeXorshift(seedInit: number): () => number {
  let seed = seedInit >>> 0
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0xffffffff
  }
}
