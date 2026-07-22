/** 歌名断行（fb4：最多两行，仍超省略号）。纯逻辑注入 fits 宽度判定可测；
 * 按 code point 走（emoji 不裂）；英文优先在空格断词（空格太靠前 <40% 处则回退逐字断） */
export function wrapTitleLines(title: string, fits: (s: string) => boolean): string[] {
  if (fits(title)) return [title]
  const chars = [...title]
  let cut = chars.length
  while (cut > 1 && !fits(chars.slice(0, cut).join(''))) cut--
  const lastSpace = chars.slice(0, cut).lastIndexOf(' ')
  const breakAt = lastSpace > Math.floor(cut * 0.4) ? lastSpace : cut
  const line1 = chars.slice(0, breakAt).join('').trimEnd()
  const rest = chars.slice(breakAt).join('').trimStart()
  if (fits(rest)) return [line1, rest]
  const rchars = [...rest]
  while (rchars.length > 1 && !fits(rchars.join('') + '…')) rchars.pop()
  return [line1, rchars.join('') + '…']
}
