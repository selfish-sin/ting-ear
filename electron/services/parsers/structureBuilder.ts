import { v4 as uuidv4 } from 'uuid'
import { splitReadableSentences } from '../../../src/utils/bookData'
import { hashSentences } from '../../../src/utils/contentHash'
import type { Block, StructuredChapter, StructureMeta, Chapter, BookData } from '../../../src/global'

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

/** 旧书 fallback：每章内每 5 句 → 一个 paragraph block */
export function generatePseudoStructure(
  sentences: string[],
  chapters: Chapter[]
): { structure: StructuredChapter[]; structureMeta: StructureMeta } {
  const BLOCK_SIZE = 5
  const structure: StructuredChapter[] = chapters.map((ch) => {
    const blocks: Block[] = []
    const end = ch.startIndex + ch.sentenceCount
    for (let i = ch.startIndex; i < end; i += BLOCK_SIZE) {
      const slice = sentences.slice(i, Math.min(i + BLOCK_SIZE, end))
      blocks.push({
        blockId: uuidv4(),
        type: 'paragraph',
        text: slice.join(' '),
        ttsSkip: false,
        sentenceRange: [i, Math.min(i + BLOCK_SIZE, end)]
      })
    }
    return {
      title: ch.title,
      level: 1,
      blocks,
      sentenceRange: [ch.startIndex, end]
    }
  })

  return {
    structure,
    structureMeta: {
      schemaVersion: 1,
      contentHash: hashSentences(sentences),
      sourceFormat: 'pseudo'
    }
  }
}
