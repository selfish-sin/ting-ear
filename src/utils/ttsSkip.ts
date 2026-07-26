import type { BookData } from '../global'

export function isSentenceTtsSkipped(
  book: BookData | null | undefined,
  sentenceIndex: number
): boolean {
  if (!book?.structure) return false
  return book.structure.some((chapter) =>
    chapter.blocks.some(
      (block) =>
        block.ttsSkip &&
        sentenceIndex >= block.sentenceRange[0] &&
        sentenceIndex < block.sentenceRange[1]
    )
  )
}

export function findNextPlayableSentence(
  sentences: string[],
  book: BookData | null | undefined,
  start: number,
  bounds: { start: number; end: number }
): number {
  let target = Math.max(start, bounds.start)
  while (target < bounds.end) {
    const text = sentences[target]
    if (text?.trim() && !isSentenceTtsSkipped(book, target)) return target
    target += 1
  }
  return bounds.end
}

export function findPreviousPlayableSentence(
  sentences: string[],
  book: BookData | null | undefined,
  start: number,
  bounds: { start: number; end: number }
): number {
  let target = Math.min(start, bounds.end - 1)
  while (target >= bounds.start) {
    const text = sentences[target]
    if (text?.trim() && !isSentenceTtsSkipped(book, target)) return target
    target -= 1
  }
  return bounds.start - 1
}

export function getPlayablePrefetchIndices(
  sentences: string[],
  book: BookData | null | undefined,
  currentIndex: number,
  bounds: { start: number; end: number },
  windowSize: number
): number[] {
  const indices: number[] = []
  const lastIndex = Math.min(bounds.end - 1, currentIndex + Math.max(0, windowSize))
  for (let index = Math.max(bounds.start, currentIndex + 1); index <= lastIndex; index += 1) {
    if (sentences[index]?.trim() && !isSentenceTtsSkipped(book, index)) indices.push(index)
  }
  return indices
}
