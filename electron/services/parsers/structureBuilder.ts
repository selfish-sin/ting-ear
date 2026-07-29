import { splitReadableSentences } from '../../../src/utils/bookData'
import { hashSentences } from '../../../src/utils/contentHash'
import type { StructuredChapter, Chapter, BookData } from '../../../src/global'
import {
  type ChapterMode,
  buildChaptersByMode,
  chaptersToBoundaries
} from './chapterBuilder'

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

/**
 * 按分章模式重排 structure（保留 blocks）。
 * 默认 original：保留目录粒度，仅切超长章；merged 才套 35~400。
 *
 * 关键：即使 structure 只有 1 章，只要超长也必须切开。
 * 旧实现 `length <= 1` 直接返回，导致无 # 标题的 MD 文集以「1 章 × 十几万 block」入库，
 * 打开时主线程卡死。
 */
export function regroupStructuredChapters(
  structure: StructuredChapter[],
  options?: { minSentences?: number; maxSentences?: number; mode?: ChapterMode }
): { structure: StructuredChapter[]; chapters: Chapter[] } {
  if (!structure.length) return { structure, chapters: [] }

  const sourceChapters = deriveChapters(structure)
  const totalSentences =
    structure.length > 0 ? structure[structure.length - 1].sentenceRange[1] : 0
  if (totalSentences <= 0) return { structure, chapters: sourceChapters }

  // 默认 original；若只传了旧 min/max 且 min>=35 则视为 merged
  const effectiveMode: ChapterMode =
    options?.mode ??
    (options?.minSentences !== undefined && options.minSentences >= 35 ? 'merged' : 'original')

  // 单章「正文/全文」blob：边界视为空，走伪分章 + 超长切开
  const looksLikeSingleBlob =
    sourceChapters.length <= 1 &&
    (sourceChapters.length === 0 ||
      sourceChapters[0].sentenceCount >= totalSentences ||
      /^(正文|全文|全书|未命名)$/.test((sourceChapters[0]?.title || '').trim()))

  const boundaries = looksLikeSingleBlob ? [] : chaptersToBoundaries(sourceChapters)
  const mergedChapters = buildChaptersByMode(totalSentences, boundaries, effectiveMode)

  // 切分结果与原 structure 章范围一致 → 无需搬 block
  const sameLayout =
    mergedChapters.length === sourceChapters.length &&
    mergedChapters.every(
      (ch, i) =>
        ch.startIndex === sourceChapters[i].startIndex &&
        ch.sentenceCount === sourceChapters[i].sentenceCount
    )
  if (sameLayout) {
    return {
      structure: structure.map((ch, i) => ({
        ...ch,
        title: mergedChapters[i]?.title || ch.title
      })),
      chapters: mergedChapters
    }
  }

  // 线性扫描分配 block（O(blocks + chapters)，避免每章 flatMap 全表）
  const allBlocks = structure.flatMap((source) => source.blocks || [])
  allBlocks.sort((a, b) => a.sentenceRange[0] - b.sentenceRange[0] || a.sentenceRange[1] - b.sentenceRange[1])

  let bi = 0
  const regrouped = mergedChapters.map((chapter) => {
    const start = chapter.startIndex
    const end = start + chapter.sentenceCount
    while (bi < allBlocks.length && allBlocks[bi].sentenceRange[1] <= start) bi += 1
    const blocks = []
    let j = bi
    while (j < allBlocks.length) {
      const block = allBlocks[j]
      const [bs, be] = block.sentenceRange
      if (bs >= end) break
      // 与章节有重叠即纳入（含 heading-only 空 range 落在章内）
      if (be > start || (bs === be && bs >= start && bs < end)) {
        blocks.push(block)
      }
      j += 1
    }
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
