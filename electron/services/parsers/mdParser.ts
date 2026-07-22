import { readFileSync } from 'fs'
import { preprocessText, splitSentences, sanitizeControlChars } from './textPreprocessor'
import { refineChapters } from './chapterBuilder'
import type { BookData } from '../../../src/global'

// Markdown 标题（#~######）可能很密集；归一化合并极小小节，避免章节列表过碎
const MD_MIN_SENTENCES = 50
const MD_MAX_SENTENCES = 900

/**
 * 智能解码 Markdown 文件：自动检测编码。
 * 回退链：UTF-8 → GBK → latin1（确保中文小说不丢字）
 */
function decodeMarkdownSafe(filePath: string): string {
  const buffer = readFileSync(filePath)
  const iconv = require('iconv-lite')
  const utf8 = iconv.decode(buffer, 'utf-8')
  if (!utf8.includes('\uFFFD')) return utf8

  // 尝试 jschardet
  try {
    const jschardet = require('jschardet')
    const result = jschardet.detect(buffer)
    const enc = result.encoding || 'utf-8'
    if (enc.toUpperCase() !== 'UTF-8' && enc.toUpperCase() !== 'UTF8') {
      return iconv.decode(buffer, enc, { errors: 'ignore' })
    }
  } catch {
    /* 回退 */
  }
  // 尝试 GBK
  try {
    const gbkText = iconv.decode(buffer, 'gbk', { errors: 'ignore' })
    let badCount = 0
    const sample = Math.min(gbkText.length, 5000)
    for (let i = 0; i < sample; i++) {
      const c = gbkText.charCodeAt(i)
      if (c >= 0x80 && c <= 0x9f) badCount++
    }
    if (badCount / sample < 0.05) return gbkText
  } catch {
    /* 继续 */
  }
  // 最终兜底
  return utf8
}

/**
 * Parse Markdown (.md) files.
 * Uses `#` headers as chapter boundaries.
 */
export function parseMarkdown(filePath: string): BookData {
  let content = decodeMarkdownSafe(filePath)
  content = sanitizeControlChars(content)

  const lines = content.split(/\r?\n/)
  const chapters: { title: string; lines: string[] }[] = []
  let currentTitle = ''
  let currentLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Match markdown headers (# ## ### etc.)
    const headerMatch = trimmed.match(/^#{1,6}\s+(.+)/)
    if (headerMatch && currentTitle) {
      // Save previous chapter
      chapters.push({ title: currentTitle, lines: [...currentLines] })
      currentTitle = headerMatch[1].trim()
      currentLines = [trimmed.replace(/^#{1,6}\s+/, '')]
    } else if (headerMatch && !currentTitle) {
      // First chapter
      currentTitle = headerMatch[1].trim()
      currentLines = [trimmed.replace(/^#{1,6}\s+/, '')]
    } else {
      if (!currentTitle) currentTitle = '正文'
      currentLines.push(trimmed)
    }
  }
  // Save last chapter
  if (currentLines.length > 0) {
    chapters.push({ title: currentTitle || '正文', lines: [...currentLines] })
  }

  // If no chapters found, treat as single chapter
  if (chapters.length === 0) {
    const allText = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
    chapters.push({ title: '正文', lines: allText.split('\n') })
  }

  // Split lines into sentences
  const allSentences: string[] = []
  const chapterList: { title: string; startIndex: number; sentenceCount: number }[] = []

  for (const ch of chapters) {
    const startIdx = allSentences.length
    const chapterText = ch.lines
      .filter((l) => l.trim())
      .join('\n')
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.+?)\*/g, '$1') // Remove italic
      .replace(/`(.+?)`/g, '$1') // Remove inline code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
      .replace(/^[>\s]+/gm, '') // Remove blockquotes

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
          minSentences: MD_MIN_SENTENCES,
          maxSentences: MD_MAX_SENTENCES
        })
      : chapterList.length > 0
        ? chapterList
        : [{ title: '正文', startIndex: 0, sentenceCount: 0 }]

  // Extract title from filename or first h1
  let title = chapters[0]?.title || ''
  const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || ''
  if (!title || title === '正文') title = fileName

  return {
    id: '',
    title,
    author: '未知作者',
    filePath,
    format: 'md',
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
