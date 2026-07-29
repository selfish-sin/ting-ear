/**
 * 兼容 re-export：实现已迁至 src/utils/chapterBuilder.ts（前后端共用）。
 */
export {
  type Boundary,
  type BuiltChapter,
  type ChapterBuildOptions,
  type ChapterMode,
  CHAPTER_MIN_SENTENCES,
  CHAPTER_MAX_SENTENCES,
  CHAPTER_PSEUDO_CHUNK,
  toChineseNumber,
  buildPseudoChapterTitle,
  buildPartSuffix,
  mergeUndersizedDownward,
  buildChapters,
  buildChaptersByMode,
  chaptersToBoundaries,
  refineChapters,
  rebuildChaptersForSentences,
  detectHeadingBoundaries
} from '../../../src/utils/chapterBuilder'
