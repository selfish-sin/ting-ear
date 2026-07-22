/**
 * 文本预处理器 —— 清洗从 PDF/EPUB/DOCX 等解析出的原始文本。
 *
 * 常见问题：
 *   - 中文字间多余空格：  "这 是 一 本 书" → "这是一本书"
 *   - PDF 硬断行：        句子被换行切断，但没有句号结尾
 *   - 多余空行：          连续多个空行
 *   - 页眉页脚页码：      "第 12 页" / "Page 12" 等混入正文
 *   - 标点半角：          英文逗号, → 中文逗号，
 */

import type { CleanRule } from '../../../src/cleanRules'
import { DEFAULT_CLEAN_RULES } from '../../../src/cleanRules'
import { sanitizeReadableText, splitReadableSentences } from '../../../src/utils/bookData'

// 中文标点集合（句末断句用）
const CJK_SENTENCE_END = /[。！？；!?;]/u

// CJK 字符（包括中文、日文、韩文）
const CJK_CHAR =
  /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u31c0-\u31ef\u2f00-\u2fdf\u2ff0-\u2fff\u3100-\u312f\u31a0-\u31bf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u

// 中文标点（含所有引号类型）
// \u201c=" \u201d=" \u2018=' \u2019='
const CJK_PUNCT_AFTER = '，。！？、；：\u201d\u2019」』）】》'
const CJK_PUNCT_BEFORE = '，。！？、；：\u201c\u2018「『（【《'

/**
 * 消毒控制字符和编码垃圾字节 —— 兜底清洗，从源头杜绝所有 0x80-0x9F 乱码。
 *
 * 覆盖三类常见污染：
 *   1) 扩展 ASCII 控制字符 0x80-0x9F（Windows-1252 被误用 UTF-8 解码后残留的  等方块）
 *   2) Unicode 零宽/隐藏字符（零宽空格、BOM、方向标记等）
 *   3) DEL (0x7F) 及传统 C0 控制字符（除常用空白外）
 *
 * 此函数应在所有文本进入清洗流水线前首先执行，作为最后一道防线。
 */
export function sanitizeControlChars(text: string): string {
  return sanitizeReadableText(text)
}

/** 移除中文字间的多余空格，保留英文词间空格 */
export function removeCJKSpaceGaps(text: string): string {
  // Loop until stable — single-pass replace misses chains like "这 是 一 本 书"
  const reCJK = new RegExp(`(${CJK_CHAR.source})\\s+(${CJK_CHAR.source})`, 'gu')
  const reAfter = new RegExp(`([${CJK_PUNCT_AFTER}])\\s+(${CJK_CHAR.source})`, 'gu')
  const reBefore = new RegExp(`(${CJK_CHAR.source})\\s+([${CJK_PUNCT_BEFORE}])`, 'gu')
  const reOpenQuote = new RegExp(`([\u201c\u2018\u300c\u300e（【《])\\s+(${CJK_CHAR.source})`, 'gu')
  const reCloseQuote = new RegExp(
    `(${CJK_CHAR.source})\\s+([\u201d\u2019\u300d\u300f）】》])`,
    'gu'
  )

  let result = text
  let prev = ''
  while (result !== prev) {
    prev = result
    result = result.replace(reCJK, '$1$2')
    result = result.replace(reAfter, '$1$2')
    result = result.replace(reBefore, '$1$2')
    result = result.replace(reOpenQuote, '$1$2')
    result = result.replace(reCloseQuote, '$1$2')
  }
  return result
}

/**
 * 合并 PDF 硬断行：
 * 如果一行不以句末标点结尾，且下一行不以空格开头（英文段落），则合并。
 */
export function mergeBrokenLines(text: string): string {
  const lines = text.split(/\r?\n/)
  const merged: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    if (line.length === 0) {
      merged.push('')
      i++
      continue
    }

    // 如果当前行以 CJK 句末标点结尾，不合并
    if (CJK_SENTENCE_END.test(line.slice(-1))) {
      merged.push(line)
      i++
      continue
    }

    // 看下一行：如果存在、非空、且不以空格/英文开头 → 合并
    const nextLine = i + 1 < lines.length ? lines[i + 1] : ''
    const nextTrimmed = nextLine.trim()

    if (
      nextTrimmed.length > 0 &&
      !/^[A-Za-z0-9(\u201c\u2018"]/.test(nextTrimmed) // 不是英文段落开头
    ) {
      merged.push(line + nextTrimmed)
      i += 2
    } else {
      merged.push(line)
      i++
    }
  }

  return merged.join('\n')
}

/** 清理多余空行：连续 2+ 空行 → 1 个空行 */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

/**
 * 合并 PDF/OCR 竖排拆分的单字母分行。
 *
 * 典型表现：每个字母/数字单独成行
 *   J
 *   o
 *   u
 *   r
 *   n
 *   a
 *   l
 *
 * 策略：
 *   1) 扫描"连续 ≥4 行、每行 trim 后恰好 1 个字母或数字"的区段，直接拼接成词
 *      （阈值 4：低于此的正常短行/诗句/编号不触发，避免误伤）
 *   2) 合成后，在英文小写→大写交界处补空格（FujianNormal → Fujian Normal）
 *      —— 仅对全英文/数字词生效，不破坏中文-CJK 内部
 *   3) 中文单字分行不处理（中文合词由 mergeBrokenLines 负责）
 *
 * 必须在 removePageArtifacts 之前执行，否则单数字行（如竖排的 2/0/2/4）
 * 会被当成页码删除。
 */
export function mergeSingleCharLines(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  // 单字符行：恰好 1 个字母或数字（trim 后）
  const isSingleAlnum = (s: string) => /^[A-Za-z0-9]$/.test(s.trim())

  while (i < lines.length) {
    // 找连续单字符行的起点
    if (isSingleAlnum(lines[i] || '')) {
      let j = i
      while (j < lines.length && isSingleAlnum(lines[j] || '')) j++
      const runLen = j - i
      if (runLen >= 4) {
        // 合成一个词
        const word = lines
          .slice(i, j)
          .map((l) => l.trim())
          .join('')
        // 大小写交界补空格：仅当词由纯字母/数字构成时
        // 例如 FujianNormal → Fujian Normal，但 2024（纯数字）不拆
        let spaced = word
        if (/[A-Za-z]/.test(word)) {
          // 小写紧跟大写 → 插空格
          spaced = word.replace(/([a-z])([A-Z])/g, '$1 $2')
          // 数字紧跟字母 / 字母紧跟数字 也插空格（如 4th 不好说，保守只在字母-数字大跳变插）
          // 这里保守：仅处理小写→大写，避免误拆 No3、a4 这种
        }
        out.push(spaced)
        i = j
        continue
      }
    }
    out.push(lines[i])
    i++
  }
  return out.join('\n')
}

export function removePageArtifacts(text: string): string {
  return (
    text
      // 纯页码行：单独一行的数字
      .replace(/^\d{1,3}$/gm, '') // 纯页码行：≤3位，避开4位年份(2026)
      // "第X页" / "第 X 页"
      .replace(/^第\s*\d{1,4}\s*页$/gm, '')
      // "Page X" / "page x"
      .replace(/^[Pp]age\s*\d{1,4}$/gm, '')
      // 页码 + 总页数: "12 / 345"
      .replace(/^\d{1,4}\s*\/\s*\d{1,4}$/gm, '')
  )
}

/** 半角标点 → 全角（中文语境） */
export function normalizePunctuation(text: string): string {
  return text
    .replace(/(?<=[\u4e00-\u9fff]),/g, '，') // 中文后的半角逗号
    .replace(/(?<=[\u4e00-\u9fff])\./g, '。') // 中文后的半角句号
    .replace(/(?<=[\u4e00-\u9fff]);/g, '；') // 中文后的半角分号
    .replace(/(?<=[\u4e00-\u9fff]):/g, '：') // 中文后的半角冒号
    .replace(/(?<=[\u4e00-\u9fff])\?/g, '？') // 中文后的半角问号
    .replace(/(?<=[\u4e00-\u9fff])!/g, '！') // 中文后的半角感叹号
    .replace(/(?<=[\u4e00-\u9fff])\(/g, '（')
    .replace(/\)(?=[\u4e00-\u9fff])/g, '）')
}

/**
 * 完整预处理流水线。
 * @returns { text, stats } 处理后的文本 + 统计信息
 */
export function preprocessText(raw: string): {
  text: string
  stats: {
    spacesRemoved: number
    linesMerged: number
    pagesRemoved: number
    punctNormalized: number
  }
} {
  if (!raw || raw.trim().length === 0) {
    return {
      text: raw,
      stats: { spacesRemoved: 0, linesMerged: 0, pagesRemoved: 0, punctNormalized: 0 }
    }
  }

  const before = raw

  // Stage 0: 消毒控制字符（0x80-0x9F 乱码、零宽字符、BOM 等，兜底清洗）
  let text = sanitizeControlChars(raw)

  // Stage 1: 去除页面伪影（页码、页眉）
  text = removePageArtifacts(text)
  const pagesRemoved = before.split('\n').length - text.split('\n').length

  // Stage 2: 合并硬断行
  const beforeMerge = text
  text = mergeBrokenLines(text)
  const linesMerged = beforeMerge.split('\n').length - text.split('\n').length

  // Stage 3: 去除 CJK 字符间空格
  const beforeSpace = text
  text = removeCJKSpaceGaps(text)
  const spacesRemoved = beforeSpace.length - text.length

  // Stage 4: 标点规范化
  const beforePunct = text
  text = normalizePunctuation(text)
  const punctNormalized = beforePunct.length - text.length

  // Stage 5: 压缩空行
  text = collapseBlankLines(text)

  return {
    text,
    stats: { spacesRemoved, linesMerged, pagesRemoved, punctNormalized }
  }
}

/**
 * 删除"全文重复出现的短行"——页眉/页脚识别。
 *
 * removePageArtifacts 只认固定格式（「第X页」「Page X」），认不出像
 * 期刊名、章节名、作者署名这种"单独成行且全文重复"的页眉页脚。
 * 规则：统计每行（trim 后长度 2~40、非空、非纯数字/标点）出现次数，
 * 出现 ≥3 次的判定为页眉/页脚，全部删除。
 *
 * 保守阈值：诗歌/列表等正常重复短行通常只出现 1-2 次，或长度 >40 字，
 * 不易误伤。
 */
export function removeRepeatingHeaders(text: string): string {
  const lines = text.split('\n')
  // 第一遍：统计候选短行出现次数
  const counts = new Map<string, number>()
  for (const line of lines) {
    const t = line.trim()
    // 长度 2~40，非空，非纯数字/纯标点
    if (t.length < 2 || t.length > 40) continue
    if (/^[\d\s.,;:!?，。；：！？、·—_()（）【】[\]「」『』""'']+$/.test(t)) continue
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  // 收集需要删除的行（出现 ≥3 次）
  const toRemove = new Set<string>()
  for (const [line, count] of counts) {
    if (count >= 3) toRemove.add(line)
  }
  if (toRemove.size === 0) return text
  // 第二遍：删除这些行（删后留空行，避免相邻段落粘连，后续 collapseBlankLines 会压平）
  return lines.map((line) => (toRemove.has(line.trim()) ? '' : line)).join('\n')
}

/**
 * 增强清洗流水线（AI 清洗的"正则主力"层，免费秒出）。
 *
 * 顺序很关键：
 *   1) mergeSingleCharLines 必须最先——把竖排单字母分行合成词，
 *      否则后续 removePageArtifacts 会把单数字行(如 2/0/2/4)当页码删
 *   2) removePageArtifacts 去固定格式页码
 *   3) removeRepeatingHeaders 去重复页眉页脚
 *   4) mergeBrokenLines 合普通硬断行
 *   5) removeCJKSpaceGaps / normalizePunctuation / collapseBlankLines
 */
/** 按用户正则规则列表（顺序敏感）对文本做查找-替换 */
export function applyRegexRules(text: string, rules: CleanRule[]): string {
  let out = text
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue
    try {
      const re = new RegExp(rule.pattern, rule.flags || 'g')
      out = out.replace(re, rule.replacement || '')
    } catch {
      // 跳过非法规则，避免中断清洗
    }
  }
  return out
}

/**
 * 增强清洗流水线（AI 清洗的"正则主力"层，免费秒出）。
 *
 * 顺序：
 *   0) sanitizeControlChars 必须最先（消除 0x80-0x9F 乱码、零宽字符、BOM）
 *   1) mergeSingleCharLines 必须第二（竖排单字母合成词）
 *   2) 应用用户正则规则（cleanRules，默认种子=原 removePageArtifacts + normalizePunctuation 行为）
 *   3) removeRepeatingHeaders 去重复页眉页脚
 *   4) mergeBrokenLines 合普通硬断行
 *   5) removeCJKSpaceGaps / collapseBlankLines
 *
 * 注意：控制字符消毒、合并硬断行、CJK 空格清理、空行压缩、重复页眉等结构性清洗始终开启，
 * 不由用户正则规则控制。
 *
 * @param rules 用户正则规则；省略时使用默认规则集（保持旧行为）
 */
export function enhancedClean(raw: string, rules?: CleanRule[]): string {
  if (!raw || raw.trim().length === 0) return raw
  const activeRules = rules && rules.length > 0 ? rules : DEFAULT_CLEAN_RULES
  let text = sanitizeControlChars(raw)
  text = mergeSingleCharLines(text)
  text = applyRegexRules(text, activeRules)
  text = removeRepeatingHeaders(text)
  text = mergeBrokenLines(text)
  text = removeCJKSpaceGaps(text)
  text = collapseBlankLines(text)
  return text
}

/**
 * 预处理后分句 —— 供 reprocess 及各 parser 使用。
 *
 * 规则：
 *   - 识别中英文句末标点、分号、换行和省略号，保留闭合引号及原标点
 *   - 小于 20 个可读字符的自然句向后合并，达到 20 后立即停止追加
 *   - 英文小数/版本号不按句点误切，中英文标点混用时仍走同一套逻辑
 *   - 跳过纯标点句（如 "。"、"；"、"——" 等），避免产生空号
 *   - 跳过 trim 后为空的片段
 *   - 返回的每个句子至少含 1 个非标点、非空白字符
 */
export function splitSentences(text: string): string[] {
  return splitReadableSentences(text)
}
