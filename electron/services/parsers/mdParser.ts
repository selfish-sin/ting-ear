import { readFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { sanitizeControlChars } from './textPreprocessor'
import { deriveSentences, deriveChapters, regroupStructuredChapters } from './structureBuilder'
import { hashSentences } from '../../../src/utils/contentHash'
import type { BookData, StructuredChapter, StructureMeta } from '../../../src/global'

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

/** 清洗 block 文本中的 MD 行内标记 */
function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
}

/**
 * 逐行解析 Markdown 为结构化章节。
 * 每个 heading 开启新章；block 按类型标注。
 */
export function parseMarkdownToStructure(raw: string): StructuredChapter[] {
  const lines = raw.split(/\r?\n/)
  const chapters: StructuredChapter[] = []
  const ctx: { chapter: StructuredChapter | null } = { chapter: null }
  let paragraphLines: string[] = []
  let inCodeBlock = false
  let codeLines: string[] = []

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0 || !ctx.chapter) return
    const text = cleanInlineMarkdown(paragraphLines.join('\n').trim())
    if (text) {
      ctx.chapter.blocks.push({
        blockId: uuidv4(),
        type: 'paragraph',
        text,
        ttsSkip: false,
        sentenceRange: [0, 0]
      })
    }
    paragraphLines = []
  }

  const ensureChapter = (title: string, level: number): void => {
    flushParagraph()
    ctx.chapter = { title, level, blocks: [], sentenceRange: [0, 0] }
    chapters.push(ctx.chapter)
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // 结束代码块
        if (ctx.chapter && codeLines.length > 0) {
          ctx.chapter.blocks.push({
            blockId: uuidv4(),
            type: 'code',
            text: codeLines.join('\n'),
            ttsSkip: true,
            sentenceRange: [0, 0]
          })
        }
        codeLines = []
        inCodeBlock = false
      } else {
        flushParagraph()
        if (!ctx.chapter) ensureChapter('\u6b63\u6587', 1)
        inCodeBlock = true
      }
      continue
    }
    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // 标题
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)/)
    if (headerMatch) {
      const level = headerMatch[1].length
      if (level === 1 || !ctx.chapter) ensureChapter(headerMatch[2].trim(), level)
      else flushParagraph()
      // heading 本身也作为一个 block（用于卡片渲染）
      ctx.chapter!.blocks.push({
        blockId: uuidv4(),
        type: 'heading',
        level,
        text: headerMatch[2].trim(),
        ttsSkip: false,
        sentenceRange: [0, 0]
      })
      continue
    }

    // 脚注
    const footnoteMatch = trimmed.match(/^\[\^(\w+)\]:?\s*(.*)/)
    if (footnoteMatch) {
      flushParagraph()
      if (!ctx.chapter) ensureChapter('正文', 1)
      ctx.chapter!.blocks.push({
        blockId: uuidv4(),
        type: 'footnote',
        text: footnoteMatch[2] || '',
        ttsSkip: true,
        sentenceRange: [0, 0],
        meta: { ref: footnoteMatch[1] }
      })
      continue
    }

    // 引用
    if (trimmed.startsWith('> ') || trimmed === '>') {
      flushParagraph()
      if (!ctx.chapter) ensureChapter('正文', 1)
      ctx.chapter!.blocks.push({
        blockId: uuidv4(),
        type: 'quote',
        text: cleanInlineMarkdown(trimmed.replace(/^>\s?/, '')),
        ttsSkip: false,
        sentenceRange: [0, 0]
      })
      continue
    }

    // 列表项
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      flushParagraph()
      if (!ctx.chapter) ensureChapter('正文', 1)
      ctx.chapter!.blocks.push({
        blockId: uuidv4(),
        type: 'list',
        text: cleanInlineMarkdown(trimmed.replace(/^[-*+]\s|^\d+\.\s/, '')),
        ttsSkip: false,
        sentenceRange: [0, 0]
      })
      continue
    }

    // 空行 → 段落分隔
    if (!trimmed) {
      flushParagraph()
      continue
    }

    // 普通文本行 → 累积到段落
    if (!ctx.chapter) ensureChapter('正文', 1)
    paragraphLines.push(trimmed)
  }

  // 收尾
  if (inCodeBlock && codeLines.length > 0 && ctx.chapter) {
    ctx.chapter.blocks.push({
      blockId: uuidv4(),
      type: 'code',
      text: codeLines.join('\n'),
      ttsSkip: true,
      sentenceRange: [0, 0]
    })
  }
  flushParagraph()

  // 无内容时兜底
  if (chapters.length === 0) {
    chapters.push({ title: '正文', level: 1, blocks: [], sentenceRange: [0, 0] })
  }

  return chapters
}

/**
 * Parse Markdown (.md) files.
 * 产出含 structure 的 BookData；sentences/chapters 从 structure 派生。
 */
export function parseMarkdown(filePath: string): BookData {
  let content = decodeMarkdownSafe(filePath)
  content = sanitizeControlChars(content)

  const structure = parseMarkdownToStructure(content)
  const allSentences = deriveSentences(structure)

  // 原料边界 = MD 标题结构；入库默认 original（仅切超长）
  const sourceBoundaries = deriveChapters(structure).map((c) => ({
    title: c.title,
    sentenceIndex: c.startIndex
  }))
  const refined = regroupStructuredChapters(structure, { mode: 'original' })
  const finalStructure = refined.structure
  const finalChapters = refined.chapters

  // Extract title from first chapter or filename
  let title = structure[0]?.title || ''
  const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || ''
  if (!title || title === '正文') title = fileName

  const structureMeta: StructureMeta = {
    schemaVersion: 1,
    contentHash: hashSentences(allSentences),
    sourceFormat: 'md'
  }

  return {
    id: '',
    title,
    author: '未知作者',
    filePath,
    format: 'md',
    sentences: allSentences,
    chapters: finalChapters,
    sourceBoundaries,
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    structure: finalStructure,
    structureMeta
  }
}
