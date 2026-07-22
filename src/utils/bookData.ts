import type { BookData, Chapter, EditRecord } from '../global'

export const BOOK_TITLE_MAX_LENGTH = 120
export const MIN_READABLE_SENTENCE_LENGTH = 20

const HIDDEN_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\x80-\x9F\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF]/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

export function sanitizeReadableText(text: string): string {
  return text.replace(HIDDEN_CONTROL_CHARS, '')
}

export function normalizeSentences(value: unknown): string[] {
  if (!Array.isArray(value)) return []
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
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue
      const startIndex = finiteInteger(item.startIndex, -1)
      if (startIndex < 0 || startIndex >= sentenceCount || starts.has(startIndex)) continue
      const title =
        typeof item.title === 'string' && item.title.trim()
          ? sanitizeReadableText(item.title).trim()
          : `第${starts.size + 1}部分`
      starts.set(startIndex, title)
    }
  }

  if (!starts.has(0)) starts.set(0, starts.size === 0 ? '全文' : '正文')
  const ordered = [...starts.entries()].sort(([a], [b]) => a - b)
  return ordered.map(([startIndex, title], index) => ({
    title,
    startIndex,
    sentenceCount: (ordered[index + 1]?.[0] ?? sentenceCount) - startIndex
  }))
}

export function buildPseudoChapters(sentences: string[], chunkSize = 400): Chapter[] {
  const normalized = normalizeSentences(sentences)
  const chapters: Chapter[] = []
  for (let startIndex = 0; startIndex < normalized.length; startIndex += chunkSize) {
    const sentenceCount = Math.min(chunkSize, normalized.length - startIndex)
    chapters.push({
      title: `段落 ${startIndex + 1}-${startIndex + sentenceCount}`,
      startIndex,
      sentenceCount
    })
  }
  return chapters
}

/** 把相邻小章节合并为 200~500 句的组（预选页「合并」开关与自动恢复选择共用） */
export function mergeSmallChapters(chapters: Chapter[]): Chapter[] {
  const MIN = 200
  const MAX = 500
  const merged: Chapter[] = []
  let gs = 0
  let ge = 0
  let cs = 0
  const mg = (s: number, e: number): Chapter => {
    if (s === e) return { ...chapters[s] }
    let t = 0
    for (let i = s; i <= e; i++) t += chapters[i].sentenceCount
    return {
      title: `${chapters[s].title}~${chapters[e].title}`,
      startIndex: chapters[s].startIndex,
      sentenceCount: t
    }
  }
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const ns = cs + ch.sentenceCount
    if (ns > MAX) {
      if (cs > 0) merged.push(mg(gs, ge))
      let r = ch.sentenceCount
      let o = 0
      while (r > 0) {
        const ck = Math.min(r, MAX)
        merged.push({
          title: `${ch.title}(${o + 1}-${o + ck})`,
          startIndex: ch.startIndex + o,
          sentenceCount: ck
        })
        r -= ck
        o += ck
      }
      gs = i + 1
      ge = i
      cs = 0
    } else if (ns >= MIN) {
      merged.push(mg(gs, i))
      gs = i + 1
      ge = i
      cs = 0
    } else {
      ge = i
      cs = ns
    }
  }
  if (cs > 0 && gs < chapters.length) {
    if (merged.length > 0 && cs < MIN) {
      const l = merged[merged.length - 1]
      l.sentenceCount += cs
      l.title = l.title.replace(/~.+$/, '') + '~' + chapters[ge].title
    } else merged.push(mg(gs, ge))
  }
  return merged
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

function normalizeEditHistory(value: unknown): EditRecord[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records = value.flatMap((item): EditRecord[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') return []
    if (!['trim-spaces', 'ai-clean', 'manual'].includes(item.type)) return []
    const sentences = normalizeSentences(item.sentences)
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

export function normalizeBookData(value: unknown): BookData | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null
  const sentences = normalizeSentences(value.sentences)
  if (sentences.length === 0) return null

  const rawTitle = typeof value.title === 'string' ? sanitizeReadableText(value.title).trim() : ''
  const title = rawTitle.slice(0, BOOK_TITLE_MAX_LENGTH) || '未命名文章'
  const currentSentenceIndex = clampSentenceIndex(value.currentSentenceIndex, sentences.length)
  const chapters = normalizeChapters(value.chapters, sentences.length)
  const originalSentences = normalizeSentences(value.originalSentences)
  const editHistory = normalizeEditHistory(value.editHistory)
  const progress = typeof value.progressPercent === 'number' ? value.progressPercent : 0
  const rawTimeMap = Array.isArray(value.timeMap) ? value.timeMap : null

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
    currentSentenceIndex,
    currentChapterIndex: findChapterIndex(chapters, currentSentenceIndex),
    progressPercent: Math.max(0, Math.min(Number.isFinite(progress) ? progress : 0, 100)),
    isCompleted: value.isCompleted === true,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt : new Date(0).toISOString(),
    lastReadAt: typeof value.lastReadAt === 'string' ? value.lastReadAt : new Date(0).toISOString(),
    originalSentences: originalSentences.length > 0 ? originalSentences : sentences,
    editHistory,
    timeMap: rawTimeMap
      ? sentences.map((_, index) => {
          const entry = rawTimeMap[index]
          return typeof entry === 'number' && Number.isFinite(entry) ? entry : -1
        })
      : undefined
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
