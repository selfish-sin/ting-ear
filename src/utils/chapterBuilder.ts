/**
 * 统一章节构建层（前后端共用）。
 *
 * 产品约定（分章只在预选页最终确认写库）：
 *  - original（原始，默认）：按书签/目录边界分章；无边界则每 400 句伪分章；
 *    超长章（>400）切开，标题用「原名（第N部分）」；不做「过碎合并」。
 *  - merged（合并）：在原始边界上套用 35~400（过碎向下合并、过长切开）。
 *
 * 解析器只负责提取分界点（sourceBoundaries）；导入时默认用 original 切一版入库展示，
 * 用户在预选页可切换 merged 并在「开始阅读」时永久写库。
 */

export interface Boundary {
  title: string
  /** 该分界点对应的句子下标（新章节从此句开始） */
  sentenceIndex: number
  /** 目录层级，1=顶级（预留） */
  depth?: number
}

export interface BuiltChapter {
  title: string
  startIndex: number
  sentenceCount: number
}

export type ChapterMode = 'original' | 'merged'

export interface ChapterBuildOptions {
  /** 一章最少句数，不够则向下合并。默认 35 */
  minSentences?: number
  /** 一章最多句数，超出切成子章。默认 400 */
  maxSentences?: number
  /** 无分界点时按尺寸伪分章的每章句数。默认 400 */
  pseudoChunkSize?: number
  /**
   * 跳过超长章切分（splitOversized）。
   * true = 仅合并过小章，不切超长章。
   */
  skipOversizedSplit?: boolean
}

/** 全局默认：与产品约定一致 */
export const CHAPTER_MIN_SENTENCES = 35
export const CHAPTER_MAX_SENTENCES = 400
export const CHAPTER_PSEUDO_CHUNK = 400

const DEFAULT_MIN = CHAPTER_MIN_SENTENCES
const DEFAULT_MAX = CHAPTER_MAX_SENTENCES
const DEFAULT_PSEUDO = CHAPTER_PSEUDO_CHUNK

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 把正整数转为简体中文数字（用于兜底章节标题；支持到 9999）。 */
export function toChineseNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return String(n)
  const num = Math.floor(n)
  if (num < 10) return CN_DIGITS[num]
  if (num === 10) return '十'
  if (num < 20) return `十${CN_DIGITS[num - 10]}`
  if (num < 100) {
    const tens = Math.floor(num / 10)
    const ones = num % 10
    return `${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`
  }
  if (num < 1000) {
    const hundreds = Math.floor(num / 100)
    const rest = num % 100
    if (rest === 0) return `${CN_DIGITS[hundreds]}百`
    if (rest < 10) return `${CN_DIGITS[hundreds]}百零${CN_DIGITS[rest]}`
    // 百位后的 10~19 要带「一」：五百一十二（不是五百十二）
    if (rest < 20) {
      return rest === 10
        ? `${CN_DIGITS[hundreds]}百一十`
        : `${CN_DIGITS[hundreds]}百一十${CN_DIGITS[rest - 10]}`
    }
    return `${CN_DIGITS[hundreds]}百${toChineseNumber(rest)}`
  }
  if (num < 10000) {
    const thousands = Math.floor(num / 1000)
    const rest = num % 1000
    if (rest === 0) return `${CN_DIGITS[thousands]}千`
    if (rest < 100) return `${CN_DIGITS[thousands]}千零${toChineseNumber(rest)}`
    return `${CN_DIGITS[thousands]}千${toChineseNumber(rest)}`
  }
  return String(num)
}

/** 无结构信号时的兜底章节标题：第一部分、第二部分… */
export function buildPseudoChapterTitle(index: number): string {
  return `第${toChineseNumber(index)}部分`
}

/** 超长章切段后缀：第一章标题（第一部分） */
export function buildPartSuffix(partIndex: number): string {
  return `（第${toChineseNumber(partIndex)}部分）`
}

/** 无结构信号时按尺寸伪分章 */
function buildSizeChapters(total: number, chunkSize: number): BuiltChapter[] {
  const chapters: BuiltChapter[] = []
  for (let i = 0; i < total; i += chunkSize) {
    const count = Math.min(chunkSize, total - i)
    chapters.push({
      title: buildPseudoChapterTitle(chapters.length + 1),
      startIndex: i,
      sentenceCount: count
    })
  }
  return chapters
}

/**
 * 把超长章节切成子章（严格 ≤ max）。
 * 若切成多段，每段标题为「原名（第N部分）」；单段保持原名。
 * 若末段 < min 且 min>1，则与上一段均分，避免碎尾。
 */
function splitOversized(
  chapters: BuiltChapter[],
  maxSentences: number,
  minSentences: number
): BuiltChapter[] {
  const out: BuiltChapter[] = []
  for (const ch of chapters) {
    if (ch.sentenceCount <= maxSentences) {
      out.push({ ...ch })
      continue
    }

    // 先算出每段句数，再统一命名
    const sizes: number[] = []
    let remaining = ch.sentenceCount
    while (remaining > 0) {
      if (remaining <= maxSentences) {
        if (remaining < minSentences && sizes.length > 0 && minSentences > 1) {
          const prev = sizes[sizes.length - 1]
          const total = prev + remaining
          const left = Math.floor(total / 2)
          sizes[sizes.length - 1] = left
          sizes.push(total - left)
        } else {
          sizes.push(remaining)
        }
        break
      }
      sizes.push(maxSentences)
      remaining -= maxSentences
    }

    let offset = 0
    const multi = sizes.length > 1
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i]
      out.push({
        title: multi ? `${ch.title}${buildPartSuffix(i + 1)}` : ch.title,
        startIndex: ch.startIndex + offset,
        sentenceCount: size
      })
      offset += size
    }
  }
  return out
}

/**
 * 不足 min 的章向下合并（并入下一章，保留下一章标题）。
 * 末章不足则并入上一章。全书仅一章时保留（即使 < min）。
 */
export function mergeUndersizedDownward(
  chapters: BuiltChapter[],
  minSentences: number
): BuiltChapter[] {
  if (chapters.length <= 1) return chapters.map((c) => ({ ...c }))
  if (minSentences <= 1) return chapters.map((c) => ({ ...c }))

  const list = chapters.map((c) => ({ ...c }))
  let i = 0
  while (i < list.length) {
    if (list.length === 1) break
    if (list[i].sentenceCount >= minSentences) {
      i++
      continue
    }
    if (i + 1 < list.length) {
      const cur = list[i]
      const next = list[i + 1]
      list[i + 1] = {
        title: next.title,
        startIndex: cur.startIndex,
        sentenceCount: cur.sentenceCount + next.sentenceCount
      }
      list.splice(i, 1)
      continue
    }
    const prev = list[i - 1]
    const cur = list[i]
    list[i - 1] = {
      title: prev.title,
      startIndex: prev.startIndex,
      sentenceCount: prev.sentenceCount + cur.sentenceCount
    }
    list.pop()
    break
  }
  return list
}

/**
 * 由分界点构建章节。
 * @param totalSentences 全文句子总数
 * @param boundaries     分界点列表（任意顺序，内部会排序去重）；空 = 尺寸伪分章
 */
export function buildChapters(
  totalSentences: number,
  boundaries: Boundary[],
  options: ChapterBuildOptions = {}
): BuiltChapter[] {
  const total = totalSentences
  if (total <= 0) return []

  const minSentences = options.minSentences ?? DEFAULT_MIN
  const maxSentences = options.maxSentences ?? DEFAULT_MAX
  const pseudoChunkSize = options.pseudoChunkSize ?? DEFAULT_PSEUDO
  const skipOversizedSplit = options.skipOversizedSplit ?? false

  let chapters: BuiltChapter[]

  if (!boundaries || boundaries.length === 0) {
    chapters = buildSizeChapters(total, pseudoChunkSize)
  } else {
    const pts = boundaries
      .map((b) => ({
        title: (b.title || '').trim() || '未命名',
        idx: Math.max(0, Math.min(total - 1, Math.floor(b.sentenceIndex)))
      }))
      .sort((a, b) => a.idx - b.idx)

    const deduped: Array<{ title: string; idx: number }> = []
    for (const p of pts) {
      if (deduped.length === 0 || deduped[deduped.length - 1].idx !== p.idx) {
        deduped.push(p)
      }
    }

    // 间距过滤：original(min=1) 保留几乎全部分界；merged(min=35) 防碎
    const kept: Array<{ title: string; idx: number }> = [deduped[0]]
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i].idx - kept[kept.length - 1].idx >= minSentences) {
        kept.push(deduped[i])
      }
    }

    chapters = []
    for (let j = 0; j < kept.length; j++) {
      const start = j === 0 ? 0 : kept[j].idx
      const end = j + 1 < kept.length ? kept[j + 1].idx : total
      if (end > start) {
        chapters.push({ title: kept[j].title, startIndex: start, sentenceCount: end - start })
      }
    }
  }

  chapters = mergeUndersizedDownward(chapters, minSentences)
  if (!skipOversizedSplit) {
    chapters = splitOversized(chapters, maxSentences, minSentences)
    chapters = mergeUndersizedDownward(chapters, minSentences)
  }

  return chapters
}

/**
 * 产品两种切法：
 *  - original：保留书签粒度，仅切开 >400 的超长章
 *  - merged：完整 35~400 规则
 */
export function buildChaptersByMode(
  totalSentences: number,
  boundaries: Boundary[],
  mode: ChapterMode
): BuiltChapter[] {
  if (mode === 'original') {
    return buildChapters(totalSentences, boundaries, {
      minSentences: 1,
      maxSentences: CHAPTER_MAX_SENTENCES,
      pseudoChunkSize: CHAPTER_PSEUDO_CHUNK,
      skipOversizedSplit: false
    })
  }
  return buildChapters(totalSentences, boundaries, {
    minSentences: CHAPTER_MIN_SENTENCES,
    maxSentences: CHAPTER_MAX_SENTENCES,
    pseudoChunkSize: CHAPTER_PSEUDO_CHUNK,
    skipOversizedSplit: false
  })
}

/** 章节表 → 分界点（用于旧书迁移 / 从已有章节恢复原料） */
export function chaptersToBoundaries(
  chapters: Array<{ title: string; startIndex: number; sentenceCount?: number }>
): Boundary[] {
  if (!chapters?.length) return []
  return chapters
    .filter((c) => Number.isFinite(c.startIndex) && c.startIndex >= 0)
    .map((c) => ({
      title: (c.title || '').trim() || '未命名',
      sentenceIndex: Math.floor(c.startIndex)
    }))
}

/**
 * 把解析器已产出的原始章节列表再过一遍归一化。
 * 默认只合并过小章节（min=35），不切超长章。
 * 新逻辑请优先用 buildChaptersByMode。
 */
export function refineChapters(
  totalSentences: number,
  rawChapters: Array<{ title: string; startIndex: number; sentenceCount: number }>,
  options: ChapterBuildOptions = {}
): BuiltChapter[] {
  if (!rawChapters.length) {
    return buildChapters(totalSentences, [], options)
  }
  const boundaries: Boundary[] = rawChapters.map((c) => ({
    title: c.title,
    sentenceIndex: c.startIndex
  }))
  const skipOversizedSplit = options.skipOversizedSplit ?? true
  return buildChapters(totalSentences, boundaries, { ...options, skipOversizedSplit })
}

/**
 * 对已有句子列表重建章节：
 * 1. 若有 rawChapters → 按 mode（默认 original）重建
 * 2. 否则尝试正文标题启发式
 * 3. 再没有 → 400 句伪分章
 */
export function rebuildChaptersForSentences(
  sentences: string[],
  rawChapters?: Array<{ title: string; startIndex: number; sentenceCount: number }>,
  options: ChapterBuildOptions & { mode?: ChapterMode } = {}
): BuiltChapter[] {
  const total = sentences.length
  if (total <= 0) return []
  const mode = options.mode ?? 'original'

  if (rawChapters && rawChapters.length > 0) {
    const looksLikeSingleBlob =
      rawChapters.length === 1 &&
      (rawChapters[0].sentenceCount >= total ||
        /^(正文|全文|全书|未命名)/.test(rawChapters[0].title.trim()))
    if (!looksLikeSingleBlob) {
      return buildChaptersByMode(total, chaptersToBoundaries(rawChapters), mode)
    }
  }

  const headingBounds = detectHeadingBoundaries(sentences)
  return buildChaptersByMode(total, headingBounds, mode)
}

// ── 标题启发式识别 ──────────────────────────────────────────

const HEADING_PATTERNS: RegExp[] = [
  /^第[0-9一二三四五六七八九十百千零两]+[章回节部卷篇集]/,
  /^chapter\s+[0-9ivxlc]+/i,
  /^part\s+[0-9ivxlc]+/i,
  /^section\s+[0-9.]+/i,
  /^(楔子|序[言章]?|前言|引[子言]|尾声|后记|跋|卷首语|附录|番外)/
]

/**
 * 从句子序列里识别章节标题（短句且匹配章节模式），返回分界点。
 */
export function detectHeadingBoundaries(sentences: string[]): Boundary[] {
  const boundaries: Boundary[] = []
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim()
    if (s.length === 0 || s.length > 48) continue
    if (HEADING_PATTERNS.some((re) => re.test(s))) {
      boundaries.push({ title: s, sentenceIndex: i })
    }
  }
  return boundaries
}
