/**
 * FNV-1a 哈希（纯 JS，浏览器/Node 通用）。
 * 拼接 sentences 后取 64 位 FNV 的 hex 表示（16 字符），用于校验 structure 是否与当前 sentences 匹配。
 * 不需要加密强度，只需内容变化检测。
 */
export function hashSentences(sentences: string[]): string {
  const str = sentences.join('\n')
  // FNV-1a 64-bit 用两个 32 位半模拟（取高 32 位 + 低 32 位拼成 16 hex）
  let h1 = 0x811c9dc5 | 0
  let h2 = 0x01000193 | 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= (c << 8) | (c >> 8)
    h2 = Math.imul(h2, 0x811c9dc5)
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return hex1 + hex2
}
