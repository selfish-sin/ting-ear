import type { ChapterOutlineGenerateRequest } from '../../../src/global'
import { chapterDisplayTitle, chapterKey } from '../../../src/utils/bookData'
import { LibraryStorage } from '../library-storage'

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
  let book
  try {
    const storage = new LibraryStorage(() => dataDir)
    book = storage.loadAll().find((item) => item.id === request.bookId)
  } catch {
    return { error: 'book data is invalid' }
  }
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
