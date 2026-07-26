/**
 * 文本预处理器 —— 导入解析 + 手动清洗共用的格式优化与规则引擎。
 *
 * 两条入口最终都走 enhancedClean：
 *   - preprocessText：书籍导入 / 重处理（可传入用户 cleanRules）
 *   - enhancedClean：清洗页「规则清洗」、快速文本清洗
 *
 * 流水线顺序（不可随意调换）：
 *   0) sanitizeControlChars     控制字符/乱码兜底
 *   1) mergeSingleCharLines     竖排单字母合成词（须在去页码前）
 *   2) applyRegexRules          用户可配规则（页码、标点等）
 *   3) removeRepeatingHeaders   重复短行页眉页脚
 *   4) mergeBrokenLines         PDF/OCR 硬断行（多轮）
 *   5) removeCJKSpaceGaps       中文间多余空格
 *   6) normalizePunctuation     半角标点收尾（空格清完后再做）
 *   7) collapseExtraSpaces      英文多空格压成一格
 *   8) collapseBlankLines       3+ 空行 → 段落间距
 */

import type { CleanRule } from '../../../src/cleanRules'
import { DEFAULT_CLEAN_RULES } from '../../../src/cleanRules'
import { sanitizeReadableText, splitReadableSentences } from '../../../src/utils/bookData'

/** 导入/重处理时由 fileHandlers 注入用户清洗规则，parsers 无需改签名 */
let activeCleanRules: CleanRule[] | undefined

/** 设置当前线程级清洗规则（导入开始时设置，结束时清空） */
export function setActiveCleanRules(rules?: CleanRule[] | null): void {
  activeCleanRules = rules && rules.length > 0 ? rules : undefined
}

function resolveRules(rules?: CleanRule[]): CleanRule[] {
  if (rules && rules.length > 0) return rules
  if (activeCleanRules && activeCleanRules.length > 0) return activeCleanRules
  return DEFAULT_CLEAN_RULES
}

// 中文标点集合（句末断句用）
const CJK_SENTENCE_END = /[。！？；!?;…]/u

// CJK 字符（包括中文、日文、韩文）
const CJK_CHAR =
  /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u31c0-\u31ef\u2f00-\u2fdf\u2ff0-\u2fff\u3100-\u312f\u31a0-\u31bf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u

// 中文标点（含所有引号类型）
const CJK_PUNCT_AFTER = '，。！？、；：…\u201d\u2019」』）】》'
const CJK_PUNCT_BEFORE = '，。！？、；：…\u201c\u2018「『（【《'
// 半角标点（用于「中文 + 空格 + 半角标点」清理）
const HALFWIDTH_PUNCT = ',.;:!?)]}'

/**
 * 消毒控制字符和编码垃圾字节 —— 兜底清洗。
 */
export function sanitizeControlChars(text: string): string {
  return sanitizeReadableText(text)
}

/** 移除中文字间的多余空格，保留英文词间空格 */
export function removeCJKSpaceGaps(text: string): string {
  const reCJK = new RegExp(`(${CJK_CHAR.source})\\s+(${CJK_CHAR.source})`, 'gu')
  const reAfter = new RegExp(`([${CJK_PUNCT_AFTER}])\\s+(${CJK_CHAR.source})`, 'gu')
  const reBefore = new RegExp(`(${CJK_CHAR.source})\\s+([${CJK_PUNCT_BEFORE}])`, 'gu')
  const reOpenQuote = new RegExp(`([\u201c\u2018\u300c\u300e（【《])\\s+(${CJK_CHAR.source})`, 'gu')
  const reCloseQuote = new RegExp(
    `(${CJK_CHAR.source})\\s+([\u201d\u2019\u300d\u300f）】》])`,
    'gu'
  )
  // 中文与半角标点之间的空格： "是 ." → "是."
  const reHalfPunct = new RegExp(
    `(${CJK_CHAR.source})\\s+([${HALFWIDTH_PUNCT.replace(/[\]\\-]/g, '\\$&')}])`,
    'gu'
  )
  // 半角开括号与中文之间： "( 你" → "(你"
  const reHalfOpen = new RegExp(`([(\\[{])\\s+(${CJK_CHAR.source})`, 'gu')

  let result = text
  let prev = ''
  while (result !== prev) {
    prev = result
    result = result.replace(reCJK, '$1$2')
    result = result.replace(reAfter, '$1$2')
    result = result.replace(reBefore, '$1$2')
    result = result.replace(reOpenQuote, '$1$2')
    result = result.replace(reCloseQuote, '$1$2')
    result = result.replace(reHalfPunct, '$1$2')
    result = result.replace(reHalfOpen, '$1$2')
  }
  return result
}

/**
 * 合并 PDF/OCR 硬断行（多轮直到稳定）。
 *
 * 合并条件（须同时满足）：
 *   - 当前行非空、不以句末标点结束
 *   - 下一行非空
 *   - 下一行不像新段落/新章节标题
 *   - 英文：下一行以小写字母开头时可合并（换行断词）
 *   - 中文：下一行不以英文数字/引号开头时合并
 */
export function mergeBrokenLines(text: string): string {
  let current = text
  // 最多 8 轮，避免极端超长文件死循环
  for (let pass = 0; pass < 8; pass++) {
    const next = mergeBrokenLinesOnce(current)
    if (next === current) break
    current = next
  }
  return current
}

function looksLikeHeading(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // 章节标题常见模式
  if (/^(第[零〇一二三四五六七八九十百千\d]+[章节回部篇卷集]|Chapter\s+\d+|CHAPTER\s+\d+)/i.test(t)) {
    return true
  }
  // 很短且无句末标点的「标题感」行（≤20 字）单独成行时不向上合并
  if (t.length <= 20 && !/[。！？.!?]$/.test(t) && /^[\d.、\s]*[\u4e00-\u9fffA-Za-z]/.test(t)) {
    // 仅当像「一、引言」「1. 概述」时视为标题
    if (/^[\d一二三四五六七八九十]+[.、．]\s*\S/.test(t)) return true
  }
  return false
}

function mergeBrokenLinesOnce(text: string): string {
  const lines = text.split(/\r?\n/)
  const merged: string[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()
    if (line.length === 0) {
      merged.push('')
      i++
      continue
    }

    const lastChar = line.slice(-1)
    if (CJK_SENTENCE_END.test(lastChar) || lastChar === '…') {
      merged.push(line)
      i++
      continue
    }

    const nextRaw = i + 1 < lines.length ? lines[i + 1] : ''
    const nextTrimmed = nextRaw.trim()

    if (!nextTrimmed || looksLikeHeading(nextTrimmed)) {
      merged.push(line)
      i++
      continue
    }

    // 英文续行：下一行以小写字母开头
    const englishContinue = /^[a-z]/.test(nextTrimmed)
    // 中文/混排：下一行不是英文段落起头（大写/数字/开引号）
    const cjkContinue = !/^[A-Z0-9(\u201c\u2018"[\u005B【]/.test(nextTrimmed)

    const endsWithHyphen = /[A-Za-z]-$/.test(line)
    const endsWithCJK = CJK_CHAR.test(lastChar)
    const nextStartsCJK = CJK_CHAR.test(nextTrimmed[0] || '')

    let shouldMerge = false
    if (endsWithHyphen && /^[A-Za-z]/.test(nextTrimmed)) {
      // 英文断词连字符：com-\npany → company
      shouldMerge = true
    } else if (englishContinue) {
      shouldMerge = true
    } else if (endsWithCJK && nextStartsCJK && cjkContinue) {
      shouldMerge = true
    } else if (endsWithCJK && cjkContinue && !/^[A-Z]/.test(nextTrimmed)) {
      shouldMerge = true
    }

    if (shouldMerge) {
      let joined: string
      if (endsWithHyphen && /^[A-Za-z]/.test(nextTrimmed)) {
        joined = line.slice(0, -1) + nextTrimmed
      } else if (/[A-Za-z0-9]$/.test(line) && /^[A-Za-z0-9]/.test(nextTrimmed)) {
        // 英文词间保留空格
        joined = line + ' ' + nextTrimmed
      } else {
        joined = line + nextTrimmed
      }
      merged.push(joined)
      i += 2
    } else {
      merged.push(line)
      i++
    }
  }

  return merged.join('\n')
}

/** 清理多余空行：连续 3+ 换行 → 2 个换行（保留段间距） */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

/**
 * 压缩多余空白：
 *   - 行尾空白去掉
 *   - 连续 2+ 半角空格 → 1 个（不动换行）
 */
export function collapseExtraSpaces(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/ {2,}/g, ' ')
}

/**
 * 合并 PDF/OCR 竖排拆分的单字母分行。
 * 必须在页码规则之前执行，否则单数字行会被当成页码删掉。
 */
export function mergeSingleCharLines(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  const isSingleAlnum = (s: string) => /^[A-Za-z0-9]$/.test(s.trim())

  while (i < lines.length) {
    if (isSingleAlnum(lines[i] || '')) {
      let j = i
      while (j < lines.length && isSingleAlnum(lines[j] || '')) j++
      const runLen = j - i
      if (runLen >= 4) {
        const word = lines
          .slice(i, j)
          .map((l) => l.trim())
          .join('')
        let spaced = word
        if (/[A-Za-z]/.test(word)) {
          spaced = word.replace(/([a-z])([A-Z])/g, '$1 $2')
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

/** @deprecated 页码清理已并入 DEFAULT_CLEAN_RULES；保留函数供测试与兼容调用 */
export function removePageArtifacts(text: string): string {
  return (
    text
      .replace(/^\s*\d{1,3}\s*$/gm, '')
      .replace(/^\s*第\s*\d{1,4}\s*页\s*$/gm, '')
      .replace(/^\s*[Pp]age\s*\d{1,4}\s*$/gm, '')
      .replace(/^\s*\d{1,4}\s*[/／]\s*\d{1,4}\s*$/gm, '')
      .replace(/^\s*[-–—·•]\s*\d{1,4}\s*[-–—·•]\s*$/gm, '')
  )
}

/** 半角标点 → 全角（中文语境）；流水线末尾再跑一遍，覆盖「先去空格再转标点」 */
export function normalizePunctuation(text: string): string {
  return text
    .replace(/(?<=[\u4e00-\u9fff]),/g, '，')
    .replace(/(?<=[\u4e00-\u9fff])\./g, '。')
    .replace(/(?<=[\u4e00-\u9fff]);/g, '；')
    .replace(/(?<=[\u4e00-\u9fff]):/g, '：')
    .replace(/(?<=[\u4e00-\u9fff])\?/g, '？')
    .replace(/(?<=[\u4e00-\u9fff])!/g, '！')
    .replace(/(?<=[\u4e00-\u9fff])\(/g, '（')
    .replace(/\)(?=[\u4e00-\u9fff])/g, '）')
}

/**
 * 删除全文重复出现的短行（页眉/页脚）。
 * 出现 ≥3 次、长度 2~40、非纯数字标点 → 删除。
 */
export function removeRepeatingHeaders(text: string): string {
  const lines = text.split('\n')
  const counts = new Map<string, number>()
  for (const line of lines) {
    const t = line.trim()
    if (t.length < 2 || t.length > 40) continue
    if (/^[\d\s.,;:!?，。；：！？、·—_()（）【】[\]「」『』""'']+$/.test(t)) continue
    // 正文句子通常含句末标点，页眉很少
    if (/[。！？.!?]$/.test(t) && t.length > 12) continue
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  const toRemove = new Set<string>()
  for (const [line, count] of counts) {
    if (count >= 3) toRemove.add(line)
  }
  if (toRemove.size === 0) return text
  return lines.map((line) => (toRemove.has(line.trim()) ? '' : line)).join('\n')
}

/** 按用户正则规则列表（顺序敏感）查找-替换 */
export function applyRegexRules(text: string, rules: CleanRule[]): string {
  let out = text
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue
    try {
      const re = new RegExp(rule.pattern, rule.flags || 'g')
      out = out.replace(re, rule.replacement || '')
    } catch {
      // 跳过非法规则
    }
  }
  return out
}

/**
 * 增强清洗流水线 —— 导入与手动清洗的统一入口。
 *
 * @param rules 用户正则规则；省略时使用默认规则集
 */
export function enhancedClean(raw: string, rules?: CleanRule[]): string {
  if (!raw || raw.trim().length === 0) return raw
  const activeRules = resolveRules(rules)

  let text = sanitizeControlChars(raw)
  text = mergeSingleCharLines(text)
  text = applyRegexRules(text, activeRules)
  text = removeRepeatingHeaders(text)
  text = mergeBrokenLines(text)
  text = removeCJKSpaceGaps(text)
  // 空格清完后再规范化标点（处理「是 .」这类）
  text = normalizePunctuation(text)
  text = collapseExtraSpaces(text)
  text = collapseBlankLines(text)
  // 去掉首尾空白行，正文内部结构由前面步骤保证
  return text.replace(/^\n+/, '').replace(/\n+$/, '')
}

/**
 * 导入解析用预处理。与 enhancedClean 同一套流水线，保证导入≈手动清洗质量。
 *
 * @param rules 可选用户规则（导入时由 fileHandlers 传入 settings.cleanRules）
 */
export function preprocessText(
  raw: string,
  rules?: CleanRule[]
): {
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
  const text = enhancedClean(raw, rules)

  // 粗略统计（日志用，非精确）
  const spacesRemoved = Math.max(0, before.length - text.length)
  const linesMerged = Math.max(0, before.split('\n').length - text.split('\n').length)
  const pagesRemoved = Math.max(0, (before.match(/^\s*\d{1,3}\s*$/gm) || []).length)
  const punctNormalized = Math.max(
    0,
    (before.match(/[,.;:!?]/g) || []).length - (text.match(/[,.;:!?]/g) || []).length
  )

  return {
    text,
    stats: { spacesRemoved, linesMerged, pagesRemoved, punctNormalized }
  }
}

/**
 * 预处理后分句 —— 供 reprocess 及各 parser 使用。
 */
export function splitSentences(text: string): string[] {
  return splitReadableSentences(text)
}
