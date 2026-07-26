import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChapterOutlineGenerateRequest } from '../../../src/global'
import { chapterDisplayTitle, chapterKey, normalizeBookCollection } from '../../../src/utils/bookData'

export interface CanonicalOutlineInput {
  bookId: string
  chapterIndex: number
  chapterKey: string
  chapterTitle: string
  sentences: string[]
}

export function resolveCanonicalOutlineInput(
  dataDir: string,
  request: Pick<ChapterOutlineGenerateRequest, 'bookId' | 'chapterIndex' | 'chapterKey'>
): { input?: CanonicalOutlineInput; error?: string } {
  if (!existsSync(join(dataDir, 'books.json'))) return { error: 'book data not found' }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dataDir, 'books.json'), 'utf8'))
  } catch {
    return { error: 'book data is invalid' }
  }

  const book = normalizeBookCollection(raw).find((item) => item.id === request.bookId)
  if (!book) return { error: 'book not found' }
  if (!Number.isInteger(request.chapterIndex) || request.chapterIndex < 0 || request.chapterIndex >= book.chapters.length) {
    return { error: 'chapter not found' }
  }

  const chapter = book.chapters[request.chapterIndex]
  const expectedKey = chapterKey(chapter, request.chapterIndex)
  if (request.chapterKey !== expectedKey) return { error: 'chapter key does not match canonical book' }

  const sentences = book.sentences.slice(chapter.startIndex, chapter.startIndex + chapter.sentenceCount)
  return {
    input: {
      bookId: book.id,
      chapterIndex: request.chapterIndex,
      chapterKey: expectedKey,
      chapterTitle: chapterDisplayTitle(chapter, book.title || '正文'),
      sentences
    }
  }
}
