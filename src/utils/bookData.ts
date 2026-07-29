import { v4 as uuidv4 } from 'uuid'
import type {
  Block,
  BookData,
  Chapter,
  ChapterMode,
  EditRecord,
  StructuredChapter,
  StructureMeta
} from '../global'
import { hashSentences } from './contentHash'
import {
  type Boundary,
  buildChaptersByMode,
  chaptersToBoundaries
} from './chapterBuilder'

export const BOOK_TITLE_MAX_LENGTH = 120
export const MIN_READABLE_SENTENCE_LENGTH = 20

const HIDDEN_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\x80-\x9F\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF\u00AD]/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

export function sanitizeReadableText(text: string): string {
  return text.replace(HIDDEN_CONTROL_CHARS, '')
}

/**
 * @param light 信任库内已清洗数据：只剔除非字符串/空串，不做控制符清洗与正则（大书打开快一个数量级）
 */
export function normalizeSentences(value: unknown, light = false): string[] {
  if (!Array.isArray(value)) return []
  if (light) {
    // 库内 JSON 已是规范句；只去掉明显无效项
    const out: string[] = []
    for (let i = 0; i < value.length; i++) {
      const s = value[i]
      if (typeof s === 'string' && s.length > 0) out.push(s)
    }
    return out
  }
  return value
    .filter((sentence): sentence is string => typeof sentence === 'string')
    .map((sentence) => sanitizeReadableText(sentence).trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence))
}

const SENTENCE_CLOSING_CHARS = new Set(['”', '’', '"', "'", ')', '）', ']', '】', '》', '」', '』'])
const ENGLISH_ABBREVIATION_END =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Fig|Inc|Ltd|Co|e\.g|i\.e)\.$/i
const sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' })

function readableCharacterCount(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
}

function splitAtSoftBoundaries(text: string): string[] {
  const chars = Array.from(text)
  const fragments: string[] = []
  let current = ''

  const flush = (): void => {
    if (current.trim()) fragments.push(current)
    current = ''
  }

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]
    if (char === '\n') {
      flush()
      continue
    }

    current += char
    let isBoundary = char === '；' || char === ';'

    if (char === '…') {
      while (chars[index + 1] === '…') current += chars[++index]
      isBoundary = true
    } else if (char === '.' && chars[index + 1] === '.' && chars[index + 2] === '.') {
      while (chars[index + 1] === '.') current += chars[++index]
      isBoundary = true
    }

    if (!isBoundary) continue
    while (SENTENCE_CLOSING_CHARS.has(chars[index + 1])) current += chars[++index]
    flush()
  }

  flush()
  return fragments
}

function fallbackSentenceSegments(text: string): string[] {
  const chars = Array.from(text)
  const fragments: string[] = []
  let current = ''

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]
    current += char
    const isDecimalPoint =
      char === '.' && /\d/.test(chars[index - 1] || '') && /\d/.test(chars[index + 1] || '')
    if (!'。！？!?'.includes(char) && !(char === '.' && !isDecimalPoint)) continue
    while (SENTENCE_CLOSING_CHARS.has(chars[index + 1])) current += chars[++index]
    fragments.push(current)
    current = ''
  }

  if (current.trim()) fragments.push(current)
  return fragments
}

function naturalSentenceFragments(text: string): string[] {
  return splitAtSoftBoundaries(text).flatMap((fragment) => {
    let segments: string[]
    try {
      segments = Array.from(sentenceSegmenter.segment(fragment), (item) => item.segment)
    } catch {
      segments = fallbackSentenceSegments(fragment)
    }

    const joined: string[] = []
    for (let index = 0; index < segments.length; index++) {
      let current = segments[index]
      while (index + 1 < segments.length && ENGLISH_ABBREVIATION_END.test(current.trimEnd())) {
        current = appendSentenceFragment(current, segments[++index])
      }
      joined.push(current)
    }
    return joined
  })
}

function appendSentenceFragment(current: string, fragment: string): string {
  const left = current.trimEnd()
  const right = fragment.trimStart()
  if (!left) return right
  if (!right) return left

  const last = Array.from(left).at(-1) || ''
  const first = Array.from(right)[0] || ''
  const needsEnglishSpace =
    /[A-Za-z0-9.!?;,:)'"\]’”]/.test(last) && /[A-Za-z0-9('"\x5B‘“]/.test(first)
  return `${left}${needsEnglishSpace ? ' ' : ''}${right}`
}

export function splitReadableSentences(text: string): string[] {
  const normalized = sanitizeReadableText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.trim()) return []

  const sentences: string[] = []
  let current = ''
  for (const fragment of naturalSentenceFragments(normalized)) {
    if (!/[\p{L}\p{N}]/u.test(fragment)) continue
    current = appendSentenceFragment(current, fragment)
    if (readableCharacterCount(current) >= MIN_READABLE_SENTENCE_LENGTH) {
      sentences.push(current)
      current = ''
    }
  }
  if (current.trim()) sentences.push(current)
  return normalizeSentences(sentences)
}

export function normalizeChapters(value: unknown, sentenceCount: number): Chapter[] {
  if (sentenceCount <= 0) return []

  const starts = new Map<number, string>()
  const titleMetadata = new Map<number, { originalTitle: string; customTitle?: string }>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue
      const startIndex = finiteInteger(item.startIndex, -1)
      if (startIndex < 0 || startIndex >= sentenceCount || starts.has(startIndex)) continue
      const title =
        typeof item.title === 'string' && item.title.trim()
          ? sanitizeReadableText(item.title).trim()
          : `第${starts.size + 1}部分`
      const originalTitle =
        typeof item.originalTitle === 'string' && item.originalTitle.trim()
          ? sanitizeReadableText(item.originalTitle).trim()
          : title
      const customTitle =
        typeof item.customTitle === 'string' && item.customTitle.trim()
          ? sanitizeReadableText(item.customTitle).trim()
          : undefined
      starts.set(startIndex, customTitle || title)
      if (typeof item.originalTitle === 'string' || typeof item.customTitle === 'string') {
        titleMetadata.set(startIndex, { originalTitle, customTitle })
      }
    }
  }

  if (!starts.has(0)) starts.set(0, starts.size === 0 ? '全文' : '正文')
  const ordered = [...starts.entries()].sort(([a], [b]) => a - b)
  return ordered.map(([startIndex, title], index) => {
    const metadata = titleMetadata.get(startIndex)
    return {
      title,
      startIndex,
      sentenceCount: (ordered[index + 1]?.[0] ?? sentenceCount) - startIndex,
      ...(metadata?.originalTitle ? { originalTitle: metadata.originalTitle } : {}),
      ...(metadata?.customTitle ? { customTitle: metadata.customTitle } : {})
    }
  })
}

export function chapterDisplayTitle(chapter: Chapter, fallback = '正文'): string {
  return chapter.customTitle?.trim() || chapter.title?.trim() || chapter.originalTitle?.trim() || fallback
}

export function chapterKey(chapter: Chapter, index: number): string {
  return `${index}:${chapter.startIndex}:${chapter.sentenceCount}`
}

export function buildPseudoChapters(sentences: string[], chunkSize = 400): Chapter[] {
  // 编辑记录版本无书签：与统一算法 original/伪分章一致
  return buildChaptersByMode(
    normalizeSentences(sentences).length,
    [],
    'original'
  ).map((c) => ({ title: c.title, startIndex: c.startIndex, sentenceCount: c.sentenceCount }))
}

/**
 * @deprecated 请用 buildDisplayChapters / buildChaptersByMode。
 * 保留导出以免旧测试/调用瞬间断裂；实现已转发到统一 merged 算法。
 */
export function mergeSmallChapters(
  chapters: Chapter[],
  _options?: { minSentences?: number; maxSentences?: number }
): Chapter[] {
  const total =
    chapters.length > 0
      ? chapters[chapters.length - 1].startIndex + chapters[chapters.length - 1].sentenceCount
      : 0
  return buildDisplayChapters(total, chaptersToBoundaries(chapters), 'merged')
}

/** 从书签边界（或旧章节表）按模式生成展示/入库用章节表 */
export function buildDisplayChapters(
  totalSentences: number,
  boundaries: Boundary[],
  mode: ChapterMode
): Chapter[] {
  return buildChaptersByMode(totalSentences, boundaries, mode).map((c) => ({
    title: c.title,
    startIndex: c.startIndex,
    sentenceCount: c.sentenceCount,
    originalTitle: c.title
  }))
}

/** 解析本书应用的原料边界：优先 sourceBoundaries，否则从 chapters 反推 */
export function resolveSourceBoundaries(book: {
  sourceBoundaries?: Array<{ title: string; sentenceIndex: number; depth?: number }>
  chapters?: Chapter[]
}): Boundary[] {
  if (book.sourceBoundaries && book.sourceBoundaries.length > 0) {
    return book.sourceBoundaries.map((b) => ({
      title: b.title,
      sentenceIndex: b.sentenceIndex,
      ...(b.depth !== undefined ? { depth: b.depth } : {})
    }))
  }
  return chaptersToBoundaries(book.chapters || [])
}

// ===== 预选页偏好缓存（按书持久化到 localStorage）=====
export interface PlayPref {
  /** 「合并小章节」开关 */
  merged?: boolean
  /** 上次阅读选择的版本：null = 原始版本，undefined = 无缓存 */
  recordId?: string | null
  /** 上次确认的句子范围 */
  range?: { start: number; end: number }
  /** 所选版本的句数快照，用于校验内容变化（清洗后句数变了就作废缓存） */
  ver?: number
}

const PLAY_PREF_KEY = (id: string): string => `ting-ear-playpref-${id}`

export function loadPlayPref(bookId?: string): PlayPref {
  if (!bookId) return {}
  try {
    const raw = localStorage.getItem(PLAY_PREF_KEY(bookId))
    return raw ? (JSON.parse(raw) as PlayPref) : {}
  } catch {
    return {}
  }
}

export function savePlayPref(bookId: string | undefined, pref: PlayPref): void {
  if (!bookId) return
  try {
    localStorage.setItem(PLAY_PREF_KEY(bookId), JSON.stringify(pref))
  } catch {
    // ignore
  }
}

/** 计算某个版本当前的句数（recordId 为空 = 原始版本） */
export function versionSentenceCount(
  recordId: string | null | undefined,
  book: { editHistory?: EditRecord[]; originalSentences?: string[]; sentences: string[] }
): number {
  if (recordId) {
    const rec = book.editHistory?.find((r) => r.id === recordId)
    return rec ? normalizeSentences(rec.sentences).length : 0
  }
  return book.originalSentences?.length || book.sentences.length
}

/**
 * 校验缓存的预选是否仍适用于当前书内容。
 * 有效 → 原样返回；版本不存在 / 句数变化（如刚清洗过）/ 范围越界 → 返回 null。
 */
export function validatePlayPref(
  pref: PlayPref,
  book: { editHistory?: EditRecord[]; originalSentences?: string[]; sentences: string[] }
): PlayPref | null {
  if (!pref.range || typeof pref.ver !== 'number') return null
  const count = versionSentenceCount(pref.recordId ?? null, book)
  if (count === 0 || count !== pref.ver) return null
  if (pref.range.start < 0 || pref.range.end > count || pref.range.start >= pref.range.end)
    return null
  return pref
}

/** 按句子范围反查与其重叠的章节下标（用于把缓存的 range 恢复成勾选状态） */
export function chaptersInRange(chapters: Chapter[], range: { start: number; end: number }): Set<number> {
  const set = new Set<number>()
  chapters.forEach((ch, idx) => {
    if (ch.startIndex + ch.sentenceCount > range.start && ch.startIndex < range.end) set.add(idx)
  })
  return set
}

export function normalizeSentenceRange(
  range: { start: number; end: number } | null | undefined,
  sentenceCount: number
): { start: number; end: number } | null {
  if (!range || sentenceCount <= 0) return null
  const start = Math.max(0, Math.min(finiteInteger(range.start), sentenceCount - 1))
  const end = Math.max(start + 1, Math.min(finiteInteger(range.end, sentenceCount), sentenceCount))
  if (start === 0 && end === sentenceCount) return null
  return { start, end }
}

export function clampSentenceIndex(
  index: unknown,
  sentenceCount: number,
  range?: { start: number; end: number } | null
): number {
  if (sentenceCount <= 0) return 0
  const normalizedRange = normalizeSentenceRange(range, sentenceCount)
  const min = normalizedRange?.start ?? 0
  const max = (normalizedRange?.end ?? sentenceCount) - 1
  return Math.max(min, Math.min(finiteInteger(index, min), max))
}

export function findChapterIndex(chapters: Chapter[], sentenceIndex: number): number {
  const index = chapters.findIndex(
    (chapter) =>
      sentenceIndex >= chapter.startIndex &&
      sentenceIndex < chapter.startIndex + chapter.sentenceCount
  )
  return index >= 0 ? index : 0
}

export function normalizeBookTitle(value: string): string | null {
  const title = sanitizeReadableText(value).trim()
  if (!title || title.length > BOOK_TITLE_MAX_LENGTH) return null
  return title
}

function normalizeEditHistory(value: unknown, light = false): EditRecord[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records = value.flatMap((item): EditRecord[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') return []
    if (!['trim-spaces', 'ai-clean', 'manual'].includes(item.type)) return []
    const sentences = normalizeSentences(item.sentences, light)
    if (sentences.length === 0) return []
    return [
      {
        id: item.id,
        type: item.type as EditRecord['type'],
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : '文本版本',
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date(0).toISOString(),
        sentenceCount: sentences.length,
        sentences
      }
    ]
  })
  return records.length > 0 ? records.slice(-20) : undefined
}

/** 旧书或失效结构 fallback：每章标题 + 每 5 句一个正文块。 */
let pseudoBlockCounter = 0
/** 轻量 blockId 生成：避免大量 uuidv4() crypto 开销 */
function nextPseudoBlockId(): string {
  return `pb-${Date.now().toString(36)}-${(pseudoBlockCounter++).toString(36)}`
}

export function generatePseudoStructure(
  sentences: string[],
  chapters: Chapter[]
): { structure: StructuredChapter[]; structureMeta: StructureMeta } {
  const blockSize = 5
  const structure: StructuredChapter[] = chapters.map((chapter) => {
    const end = chapter.startIndex + chapter.sentenceCount
    const blocks: Block[] = [
      {
        blockId: nextPseudoBlockId(),
        type: 'heading',
        level: 1,
        text: chapter.title,
        ttsSkip: false,
        sentenceRange: [chapter.startIndex, chapter.startIndex]
      }
    ]
    for (let index = chapter.startIndex; index < end; index += blockSize) {
      const blockEnd = Math.min(index + blockSize, end)
      blocks.push({
        blockId: nextPseudoBlockId(),
        type: 'paragraph',
        text: sentences.slice(index, blockEnd).join(' '),
        ttsSkip: false,
        sentenceRange: [index, blockEnd]
      })
    }
    return {
      title: chapter.title,
      level: 1,
      blocks,
      sentenceRange: [chapter.startIndex, end]
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

const STRUCTURED_BLOCK_TYPES = new Set<Block['type']>([
  'heading',
  'paragraph',
  'footnote',
  'endnote',
  'quote',
  'list',
  'code',
  'page_break',
  'toc_entry'
])

function isIntegerRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1])
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isValidStructureMeta(value: unknown, contentHash: string): value is StructureMeta {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    value.contentHash === contentHash &&
    typeof value.sourceFormat === 'string' &&
    value.sourceFormat.trim().length > 0
  )
}

function isValidStructure(value: unknown, sentenceCount: number): value is StructuredChapter[] {
  if (!Array.isArray(value)) return false

  const blockIds = new Set<string>()
  let chapterCursor = 0
  for (const chapter of value) {
    if (
      !isRecord(chapter) ||
      typeof chapter.title !== 'string' ||
      !chapter.title.trim() ||
      !Number.isInteger(chapter.level) ||
      (chapter.level as number) < 1 ||
      !Array.isArray(chapter.blocks) ||
      !isIntegerRange(chapter.sentenceRange)
    ) {
      return false
    }

    const [chapterStart, chapterEnd] = chapter.sentenceRange
    if (
      chapterStart !== chapterCursor ||
      chapterEnd < chapterStart ||
      chapterEnd > sentenceCount
    ) {
      return false
    }

    let blockCursor = chapterStart
    for (const block of chapter.blocks) {
      if (
        !isRecord(block) ||
        typeof block.blockId !== 'string' ||
        !block.blockId.trim() ||
        blockIds.has(block.blockId) ||
        typeof block.type !== 'string' ||
        !STRUCTURED_BLOCK_TYPES.has(block.type as Block['type']) ||
        typeof block.text !== 'string' ||
        typeof block.ttsSkip !== 'boolean' ||
        !isIntegerRange(block.sentenceRange) ||
        (block.level !== undefined &&
          (!Number.isInteger(block.level) || (block.level as number) < 1 || (block.level as number) > 6)) ||
        (block.meta !== undefined && !isStringRecord(block.meta))
      ) {
        return false
      }

      const [blockStart, blockEnd] = block.sentenceRange
      if (blockStart !== blockCursor || blockEnd < blockStart || blockEnd > chapterEnd) return false
      blockIds.add(block.blockId)
      blockCursor = blockEnd
    }

    if (blockCursor !== chapterEnd) return false
    chapterCursor = chapterEnd
  }

  return chapterCursor === sentenceCount
}

/**
 * normalizeBookData 结果缓存（按输入对象引用）。
 * 打开书链路会对同一份数据连续 normalize 3 次（loadFullBook → handleChapterConfirm →
 * activateReadingBook），每次都要全书 join + SHA-256 + timeMap 重建，大书打开时明显卡顿。
 * 同一对象引用直接复用结果，消除重复全量计算。WeakMap 不防碍 GC。
 */
const normalizeCache = new WeakMap<object, BookData | null>()

export interface NormalizeBookOptions {
  /** 调用方已算好的 contentHash，避免大书重复 SHA-256 */
  contentHash?: string
  /**
   * 信任库内已规范化数据（打开/按需加载主路径）。
   * - 句子轻量校验，不做控制符清洗
   * - 结构形状合法时复用 structureMeta，不重算全文 hash
   * - 结构损坏时不强制 rebuild pseudo（避免大书卡顿），留给需要时再修
   */
  trusted?: boolean
}

export function normalizeBookData(
  value: unknown,
  opts?: NormalizeBookOptions
): BookData | null {
  // 已规范化对象再次传入：直接命中
  if (isRecord(value)) {
    const cached = normalizeCache.get(value as object)
    if (cached !== undefined) return cached
  }
  const result = normalizeBookDataUncached(value, opts)
  if (isRecord(value) && !opts?.contentHash && !opts?.trusted) {
    normalizeCache.set(value as object, result)
  }
  // 输出对象映射到自身：activateReadingBook 等后续 normalize 零成本
  if (result) normalizeCache.set(result as object, result)
  return result
}

function isLooseStructureMeta(value: unknown): value is StructureMeta {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    typeof value.contentHash === 'string' &&
    value.contentHash.length > 0 &&
    typeof value.sourceFormat === 'string' &&
    value.sourceFormat.trim().length > 0
  )
}

function normalizeBookDataUncached(
  value: unknown,
  opts?: NormalizeBookOptions
): BookData | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null
  const trusted = opts?.trusted === true
  const sentences = normalizeSentences(value.sentences, trusted)
  if (sentences.length === 0) return null

  const rawTitle = typeof value.title === 'string' ? sanitizeReadableText(value.title).trim() : ''
  const title = rawTitle.slice(0, BOOK_TITLE_MAX_LENGTH) || '未命名文章'
  const currentSentenceIndex = clampSentenceIndex(value.currentSentenceIndex, sentences.length)
  let chapters = normalizeChapters(value.chapters, sentences.length)

  // originalSentences：同源引用或等长库数据时避免二次全量清洗
  let originalSentences: string[]
  if (value.originalSentences === value.sentences) {
    originalSentences = sentences
  } else if (
    trusted &&
    Array.isArray(value.originalSentences) &&
    value.originalSentences.length === sentences.length
  ) {
    originalSentences = normalizeSentences(value.originalSentences, true)
  } else {
    originalSentences = normalizeSentences(value.originalSentences, trusted)
  }
  if (originalSentences.length === 0) originalSentences = sentences

  const editHistory = normalizeEditHistory(value.editHistory, trusted)
  const progress = typeof value.progressPercent === 'number' ? value.progressPercent : 0
  const rawTimeMap = Array.isArray(value.timeMap) ? value.timeMap : null

  let structure: StructuredChapter[] | undefined
  let structureMeta: StructureMeta | undefined
  const rawStructure = (value as Record<string, unknown>).structure
  const rawMeta = (value as Record<string, unknown>).structureMeta
  const hasStructureData = rawStructure !== undefined || rawMeta !== undefined
  const structureShapeOk = isValidStructure(rawStructure, sentences.length)

  // hash：优先调用方 / 库内 meta；仅在需要校验或重建时才全文哈希
  let contentHash = opts?.contentHash
  if (!contentHash && trusted && isLooseStructureMeta(rawMeta)) {
    contentHash = rawMeta.contentHash
  }

  if (structureShapeOk) {
    const metaOk = trusted
      ? isLooseStructureMeta(rawMeta)
      : isValidStructureMeta(
          rawMeta,
          contentHash ?? (contentHash = hashSentences(sentences))
        )
    if (metaOk) {
      structure = rawStructure.map((chapter, index) => ({
        ...chapter,
        title: chapters[index]?.customTitle || chapter.title
      }))
      structureMeta = rawMeta as StructureMeta
      chapters = structure.map((chapter, index) => {
        const metadata = chapters[index]
        return {
          title: metadata?.customTitle || chapter.title,
          startIndex: chapter.sentenceRange[0],
          sentenceCount: chapter.sentenceRange[1] - chapter.sentenceRange[0],
          ...(metadata?.originalTitle ? { originalTitle: metadata.originalTitle } : {}),
          ...(metadata?.customTitle ? { customTitle: metadata.customTitle } : {})
        }
      })
    } else if (hasStructureData && !trusted) {
      const pseudo = generatePseudoStructure(sentences, chapters)
      structure = pseudo.structure
      structureMeta = pseudo.structureMeta
    }
    // trusted 且 meta 对不上：丢弃坏结构，不重建 pseudo（打开路径不卡）
  } else if (hasStructureData && !trusted) {
    const pseudo = generatePseudoStructure(sentences, chapters)
    structure = pseudo.structure
    structureMeta = pseudo.structureMeta
  }

  // 无结构时补 contentHash 到 meta 仅在非 trusted 已生成 pseudo 时发生

  const rawBoundaries = (value as Record<string, unknown>).sourceBoundaries
  let sourceBoundaries: BookData['sourceBoundaries']
  if (Array.isArray(rawBoundaries)) {
    const list: NonNullable<BookData['sourceBoundaries']> = []
    for (const item of rawBoundaries) {
      if (!isRecord(item)) continue
      const sentenceIndex = finiteInteger(item.sentenceIndex, -1)
      if (sentenceIndex < 0 || sentenceIndex >= sentences.length) continue
      const bTitle =
        typeof item.title === 'string' && item.title.trim()
          ? trusted
            ? item.title.trim()
            : sanitizeReadableText(item.title).trim()
          : '未命名'
      const depth =
        typeof item.depth === 'number' && Number.isFinite(item.depth)
          ? Math.trunc(item.depth)
          : undefined
      list.push({ title: bTitle, sentenceIndex, ...(depth !== undefined ? { depth } : {}) })
    }
    if (list.length > 0) sourceBoundaries = list
  }

  const rawMode = (value as Record<string, unknown>).chapterMode
  const chapterMode: ChapterMode | undefined =
    rawMode === 'original' || rawMode === 'merged' ? rawMode : undefined

  // timeMap：长度匹配且全是有限数字时直接复用，避免大书再 map 一遍
  let timeMap: number[] | undefined
  if (rawTimeMap) {
    if (rawTimeMap.length === sentences.length) {
      let reusable = true
      for (let i = 0; i < rawTimeMap.length; i++) {
        const entry = rawTimeMap[i]
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
          reusable = false
          break
        }
      }
      timeMap = reusable
        ? (rawTimeMap as number[])
        : sentences.map((_, index) => {
            const entry = rawTimeMap[index]
            return typeof entry === 'number' && Number.isFinite(entry) ? entry : -1
          })
    } else {
      timeMap = sentences.map((_, index) => {
        const entry = rawTimeMap[index]
        return typeof entry === 'number' && Number.isFinite(entry) ? entry : -1
      })
    }
  }

  return {
    ...(value as unknown as BookData),
    id: value.id.trim(),
    title,
    author:
      typeof value.author === 'string' && value.author.trim()
        ? sanitizeReadableText(value.author).trim()
        : '未知作者',
    filePath: typeof value.filePath === 'string' ? value.filePath : '',
    format: typeof value.format === 'string' ? value.format.toLowerCase() : 'txt',
    sentences,
    chapters,
    ...(sourceBoundaries ? { sourceBoundaries } : {}),
    ...(chapterMode ? { chapterMode } : {}),
    currentSentenceIndex,
    currentChapterIndex: findChapterIndex(chapters, currentSentenceIndex),
    progressPercent: Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, 100)),
    isCompleted: value.isCompleted === true,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt : new Date(0).toISOString(),
    lastReadAt: typeof value.lastReadAt === 'string' ? value.lastReadAt : new Date(0).toISOString(),
    originalSentences,
    editHistory,
    timeMap,
    structure,
    structureMeta
  }
}

export function normalizeBookCollection(value: unknown): BookData[] {
  if (!Array.isArray(value)) return []
  const books = new Map<string, BookData>()
  for (const item of value) {
    const book = normalizeBookData(item)
    if (book) books.set(book.id, book)
  }
  return [...books.values()]
}
