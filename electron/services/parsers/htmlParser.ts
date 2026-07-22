import { readFileSync } from 'fs'
import { preprocessText, splitSentences, sanitizeControlChars } from './textPreprocessor'
import { refineChapters } from './chapterBuilder'
import type { BookData } from '../../../src/global'

// HTML 标题（h1~h6）可能很密集；归一化合并极小小节，避免章节列表过碎
const HTML_MIN_SENTENCES = 50
const HTML_MAX_SENTENCES = 900

/**
 * 从 HTML 头部检测编码声明，未声明时返回 'utf-8'。
 */
function detectHtmlEncoding(htmlBytes: Buffer): string {
  const head = htmlBytes.toString('ascii', 0, Math.min(htmlBytes.length, 1024))
  const metaCharset = head.match(/<meta[^>]*charset\s*=\s*["']([^"']+)["']/i)
  if (metaCharset) return metaCharset[1]
  const metaHttp = head.match(
    /<meta[^>]*http-equiv\s*=\s*["']Content-Type["'][^>]*charset\s*=\s*([^\s"';]+)/i
  )
  if (metaHttp) return metaHttp[1]
  return 'utf-8'
}

/**
 * 解析 HTML 文件。自动检测编码，消毒控制字符。
 */
export function parseHtml(filePath: string): BookData {
  const htmlBytes = readFileSync(filePath)
  const encoding = detectHtmlEncoding(htmlBytes)
  let raw: string
  try {
    const iconv = require('iconv-lite')
    raw = iconv.decode(htmlBytes, encoding, { errors: 'ignore' })
  } catch {
    raw = htmlBytes.toString('utf-8')
  }
  // 提前消毒：清除解码残留的 0x80-0x9F 乱码后再做 HTML 标签剥离
  raw = sanitizeControlChars(raw)

  // Extract title from <title> tag or filename
  const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i)
  let title: string
  if (titleMatch && titleMatch[1].trim()) {
    title = titleMatch[1].trim()
  } else {
    const fileName =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.html?$/i, '') || ''
    title = fileName
  }

  // Strip HTML tags but preserve heading structure
  const processed = raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<\/h1>/gi, '\n')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<\/h3>/gi, '\n')
    .replace(/<h4[^>]*>/gi, '\n#### ')
    .replace(/<\/h4>/gi, '\n')
    .replace(/<h5[^>]*>/gi, '\n##### ')
    .replace(/<\/h5>/gi, '\n')
    .replace(/<h6[^>]*>/gi, '\n###### ')
    .replace(/<\/h6>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '') // Remove remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines

  // Parse as markdown-style (reuse similar logic as mdParser)
  const lines = processed.split(/\r?\n/)
  const chapters: { title: string; lines: string[] }[] = []
  let currentTitle = title || '正文'
  let currentLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^#{1,6}\s+(.+)/)
    if (headerMatch) {
      if (currentLines.length > 0) {
        chapters.push({ title: currentTitle, lines: [...currentLines] })
      }
      currentTitle = headerMatch[1].trim()
      currentLines = [trimmed.replace(/^#{1,6}\s+/, '')]
    } else {
      currentLines.push(trimmed)
    }
  }

  if (currentLines.length > 0) {
    chapters.push({ title: currentTitle, lines: [...currentLines] })
  }

  if (chapters.length === 0) {
    const nonEmpty = lines.filter((l) => l.trim())
    chapters.push({ title: title || '正文', lines: nonEmpty })
  }

  // Split into sentences
  const allSentences: string[] = []
  const chapterList: { title: string; startIndex: number; sentenceCount: number }[] = []

  for (const ch of chapters) {
    const startIdx = allSentences.length
    const chapterText = ch.lines.join('\n')
    const cleaned = preprocessText(chapterText).text
    const sentences = splitSentences(cleaned)
    allSentences.push(...sentences)
    if (sentences.length > 0) {
      chapterList.push({ title: ch.title, startIndex: startIdx, sentenceCount: sentences.length })
    }
  }

  // 归一化：合并极小小节、切分超长章（无句子时保持原样）
  const finalChapters =
    allSentences.length > 0
      ? refineChapters(allSentences.length, chapterList, {
          minSentences: HTML_MIN_SENTENCES,
          maxSentences: HTML_MAX_SENTENCES
        })
      : chapterList.length > 0
        ? chapterList
        : [{ title: title || '正文', startIndex: 0, sentenceCount: 0 }]

  return {
    id: '',
    title,
    author: '未知作者',
    filePath,
    format: 'html',
    sentences: allSentences,
    chapters: finalChapters,
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString()
  }
}
