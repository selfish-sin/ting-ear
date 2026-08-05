/**
 * 书内 / 联网来源解析与引用构建（抽出避免 tool-registry ↔ ai-service 循环依赖）
 */
import type { AiQuestionCategory, AiSourceRef, AiWebSourceRef } from '../../../src/global'
import type { NmemMemory } from './nmem-bridge'
import type { WebSearchResult } from './web-search-service'

export interface SourceMetadata {
  bookId: string
  chapterIndex: number
  chapterTitle: string
}

/**
 * 解析书内来源标签。
 * 兼容：
 * - `[bookId=id][ch=2] 第三章`
 * - `书名 [bookId=id]` / `书名 [bookId=id].md`（nmem original_name 常带扩展名）
 * - `[bookId=id] 书名`
 * - 正文任意位置的 `[bookId=id]`（兜底，避免静默丢弃）
 */
export function parseSourceMetadata(source: string): SourceMetadata | null {
  const text = source.trim()
  if (!text) return null

  // 旧版按章：`[bookId=id][ch=2] 第三章`
  const chapterMatch = /^\[bookId=([^\]]+)]\[ch=(\d+)]\s*(.*)$/.exec(text)
  if (chapterMatch) {
    return {
      bookId: chapterMatch[1],
      chapterIndex: Number(chapterMatch[2]),
      chapterTitle: chapterMatch[3].trim() || `第 ${Number(chapterMatch[2]) + 1} 章`
    }
  }
  // 整本（ingest bookSourceName）：`书名 [bookId=id]` 或 `书名 [bookId=id].md`
  const bookSuffixMatch = /^(.*?)\s*\[bookId=([^\]]+)](?:\.[a-z0-9]+)?\s*$/i.exec(text)
  if (bookSuffixMatch) {
    return {
      bookId: bookSuffixMatch[2],
      chapterIndex: -1,
      chapterTitle: bookSuffixMatch[1].trim() || '全书'
    }
  }
  // 兼容旧整本：`[bookId=id] 书名`（书名可再带 .md）
  const bookPrefixMatch = /^\[bookId=([^\]]+)]\s*(.*?)(?:\.[a-z0-9]+)?\s*$/i.exec(text)
  if (bookPrefixMatch) {
    const title = bookPrefixMatch[2].trim().replace(/\.[a-z0-9]+$/i, '')
    return {
      bookId: bookPrefixMatch[1],
      chapterIndex: -1,
      chapterTitle: title || '全书'
    }
  }
  // 兜底：任意位置的 [bookId=…]（例如夹在其它前缀/后缀中间）
  const anyBookId = /\[bookId=([^\]]+)]/.exec(text)
  if (anyBookId) {
    const withoutTag = text
      .replace(/\[bookId=[^\]]+]/g, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .trim()
    return {
      bookId: anyBookId[1],
      chapterIndex: -1,
      chapterTitle: withoutTag || '全书'
    }
  }
  return null
}

export function buildSourceRefs(
  memories: NmemMemory[],
  options: {
    bookId?: string
    currentChapterIndex?: number
    category?: AiQuestionCategory
  }
): AiSourceRef[] {
  const bookId = options.bookId
  const currentChapterIndex = Math.max(0, options.currentChapterIndex ?? 0)
  const filtered = memories.filter((memory) => {
    const metadata = parseSourceMetadata(memory.source)
    if (!metadata) return false
    if (bookId && metadata.bookId !== bookId) return false
    if (options.category === 'chapter') {
      // 整本源（-1）可答章级问题
      return (
        metadata.chapterIndex === -1 || metadata.chapterIndex === currentChapterIndex
      )
    }
    return true
  })
  return filtered.map((memory, sourceIndex) => {
    const metadata = parseSourceMetadata(memory.source)!
    return {
      index: sourceIndex + 1,
      memoryId: memory.id,
      content: memory.content,
      source: memory.source,
      score: memory.score,
      ...metadata
    }
  })
}

export function toWebSourceRefs(results: WebSearchResult[]): AiWebSourceRef[] {
  const now = new Date().toISOString()
  return results.map((r, i) => ({
    index: i + 1,
    title: r.title || r.url || `来源 ${i + 1}`,
    url: r.url || '',
    snippet: r.snippet || '',
    provider: r.provider || 'unknown',
    sourceType: r.sourceType || '网页',
    fetchedAt: r.fetchedAt || now
  }))
}
