import { readFileSync } from 'fs'
import { basename } from 'path'
import { preprocessText, splitSentences, sanitizeControlChars } from './textPreprocessor'
import { refineChapters } from './chapterBuilder'

// TXT 多为小说，章节由"第X章"等标题界定；归一化下限放低以尊重作者分章，仅合并极小片段
const TXT_MIN_SENTENCES = 40
const TXT_MAX_SENTENCES = 900

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
}

/**
 * 智能解码：按优先级链尝试编码，使用 errors='ignore' 抛弃非法字节，
 * 从源头杜绝 0x80-0x9F 解码错误残留。
 *
 * 回退链：UTF-8 → GBK → Windows-1252 → latin1（latin1 无损兜底，绝不出方块）
 * 每步均用 errors='ignore' 模式，非法字节直接丢弃而非渲染为 。
 */
function decodeBufferSafe(buffer: Buffer): string {
  const iconv = require('iconv-lite')

  // 有效 UTF-8 可无歧义识别，必须先于统计检测，避免短中文被误判为 Windows-1252。
  const utf8 = iconv.decode(buffer, 'UTF-8')
  if (!utf8.includes('\uFFFD')) return utf8

  // 1) 尝试 jschardet 检测
  let detectedEncoding = ''
  try {
    const jschardet = require('jschardet')
    const result = jschardet.detect(buffer)
    detectedEncoding = (result.encoding || '').toUpperCase()
  } catch {
    // jschardet 不可用时走回退链
  }

  // 按检测结果优先 → 回退链顺序尝试
  const candidates: string[] = []
  if (detectedEncoding && detectedEncoding !== 'UTF-8' && detectedEncoding !== 'UTF8') {
    candidates.push(detectedEncoding)
  }
  candidates.push('GBK', 'windows-1252', 'latin1')

  for (const enc of candidates) {
    try {
      const text = iconv.decode(buffer, enc, { errors: 'ignore' })
      // 验证：解码后不应出现大段 0x80-0x9F 垃圾（latin1 除外，因为它是无损透传）
      if (enc === 'latin1') return text
      // 检查解码质量：超过 5% 的字符落在 0x80-0x9F 范围 → 编码不对，试下一个
      let badCount = 0
      const sampleSize = Math.min(text.length, 5000)
      for (let i = 0; i < sampleSize; i++) {
        const code = text.charCodeAt(i)
        if (code >= 0x80 && code <= 0x9f) badCount++
      }
      if (badCount / sampleSize < 0.05) return text
      // 质量太差，继续尝试下一个
    } catch {
      continue
    }
  }

  // 最终兜底：latin1 无损转码
  return iconv.decode(buffer, 'latin1')
}

export function parseTxt(filePath: string): ParseResult {
  const fileName = basename(filePath, '.txt')
  const buffer = readFileSync(filePath)

  // 智能解码：回退链 + errors:'ignore' ，从源头杜绝 0x80-0x9F 乱码
  let text = decodeBufferSafe(buffer)

  // 额外兜底：万一 latin1 透传了 0x80-0x9F 字节，在此层再做一次消毒
  text = sanitizeControlChars(text)

  // Remove BOM if present (sanitizeControlChars 已处理 FEFF，但保留显式逻辑以防回退)
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  // Try to extract title from first non-empty line
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  let title = fileName
  let author = '未知作者'

  // First line is often the title
  if (lines.length > 0) {
    const firstLine = lines[0]
    if (firstLine.length <= 50 && !firstLine.includes('作者') && !firstLine.includes('第')) {
      title = firstLine
    }
  }

  // Try to find author line
  for (const line of lines.slice(0, 10)) {
    const authorMatch = line.match(/作者[：:]\s*(.+)/)
    if (authorMatch) {
      author = authorMatch[1].trim()
      break
    }
  }

  // Detect chapters using common patterns
  const chapterRegex = /^第[一二三四五六七八九十百千零\d]+[章回节卷篇集部幕]/m
  const chapterRegex2 = /^Chapter\s+\d+/im
  // 也支持卷/篇/楔子/序言/后记/尾声等无编号结构
  const chapterAuxRegex = /^(楔子|序[言章]?|前言|引[子言]|尾声|后记|跋|卷首语|附录|番外)/m
  const chapters: Array<{ title: string; startIndex: number; sentenceCount: number }> = []

  // Preprocess: remove CJK spaces, merge broken lines, etc.
  const cleaned = preprocessText(text).text

  // Split into sentences
  const sentences = splitSentences(cleaned)

  // Try to detect chapter boundaries from sentences
  let currentChapterStart = 0
  let currentChapterTitle = '全文'

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    // 匹配第X章 / Chapter X 等标题模式（可能后面跟内容，也可能独立成句）
    const chapterMatch =
      s.match(/^(第[一二三四五六七八九十百千零\d]+[章回节卷篇集部幕].*?)([。！？!?]|$)/) ||
      s.match(/^(Chapter\s+\d+.*?)([.!?]|$)/i) ||
      s.match(/^(楔子|序[言章]?|前言|引[子言]|尾声|后记|跋|卷首语|附录|番外)/)

    if (chapterMatch && i > 0) {
      // Save previous chapter
      chapters.push({
        title: currentChapterTitle,
        startIndex: currentChapterStart,
        sentenceCount: i - currentChapterStart
      })
      currentChapterStart = i
      currentChapterTitle = chapterMatch[1].trim()
    } else if (
      i === 0 &&
      (chapterRegex.test(s) || chapterRegex2.test(s) || chapterAuxRegex.test(s))
    ) {
      currentChapterTitle = s.trim()
    }
  }

  // Save last chapter
  if (sentences.length > 0) {
    chapters.push({
      title: currentChapterTitle,
      startIndex: currentChapterStart,
      sentenceCount: sentences.length - currentChapterStart
    })
  }

  return {
    title,
    author,
    sentences,
    chapters:
      sentences.length > 0
        ? refineChapters(sentences.length, chapters, {
            minSentences: TXT_MIN_SENTENCES,
            maxSentences: TXT_MAX_SENTENCES
          })
        : [{ title: '全文', startIndex: 0, sentenceCount: sentences.length }]
  }
}
