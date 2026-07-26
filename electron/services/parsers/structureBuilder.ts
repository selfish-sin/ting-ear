import { mergeSmallChapters, splitReadableSentences } from '../../../src/utils/bookData'
import { hashSentences } from '../../../src/utils/contentHash'
import type { StructuredChapter, Chapter, BookData } from '../../../src/global'

export { generatePseudoStructure } from '../../../src/utils/bookData'

/** 遍历 structure blocks，对每个 block.text 拆句，填充 sentenceRange，返回全局 sentences */
export function deriveSentences(structure: StructuredChapter[]): string[] {
  const allSentences: string[] = []
  for (const chapter of structure) {
    const chStart = allSentences.length
    for (const block of chapter.blocks) {
      const start = allSentences.length
      if (block.text.trim()) {
        const sentences = splitReadableSentences(block.text)
        allSentences.push(...sentences)
      }
      block.sentenceRange = [start, allSentences.length]
    }
    chapter.sentenceRange = [chStart, allSentences.length]
  }
  return allSentences
}

/** 从 structure 的 sentenceRange 派生 Chapter[] */
export function deriveChapters(structure: StructuredChapter[]): Chapter[] {
  return structure.map((ch) => ({
    title: ch.title,
    startIndex: ch.sentenceRange[0],
    sentenceCount: ch.sentenceRange[1] - ch.sentenceRange[0]
  }))
}

/** Regroup fine-grained source chapters while retaining every original block. */
export function regroupStructuredChapters(
  structure: StructuredChapter[],
  options?: { minSentences?: number; maxSentences?: number }
): { structure: StructuredChapter[]; chapters: Chapter[] } {
  const sourceChapters = deriveChapters(structure)
  if (sourceChapters.length <= 1) return { structure, chapters: sourceChapters }

  const mergedChapters = mergeSmallChapters(sourceChapters, options)
  const regrouped = mergedChapters.map((chapter) => {
    const start = chapter.startIndex
    const end = start + chapter.sentenceCount
    const blocks = structure.flatMap((source) => {
      const [sourceStart, sourceEnd] = source.sentenceRange
      const overlaps = sourceEnd > start && sourceStart < end
      const isHeadingOnly = sourceStart === sourceEnd && sourceStart >= start && sourceStart < end
      return overlaps || isHeadingOnly ? source.blocks : []
    })
    return {
      title: chapter.title,
      level: 1,
      blocks,
      sentenceRange: [start, end] as [number, number]
    }
  })
  return { structure: regrouped, chapters: mergedChapters }
}

/** 比对 structureMeta.contentHash 与当前 sentences hash */
export function validateStructure(book: BookData): boolean {
  if (!book.structure || !book.structureMeta) return false
  return book.structureMeta.contentHash === hashSentences(book.sentences)
}

/** 删除 structure + structureMeta（就地修改） */
export function invalidateStructure(book: BookData): void {
  delete book.structure
  delete book.structureMeta
}
