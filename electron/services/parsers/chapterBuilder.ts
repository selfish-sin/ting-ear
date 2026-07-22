/**
 * 统一章节归一化层。
 *
 * 各格式解析器只负责提取「分界点」（目录/书签/标题，带句子位置与层级），
 * 本模块把分界点收拢为粒度合理的章节，解决两个极端：
 *  - 过碎：PDF 一页一个书签、技术书目录细到段落 → 用 minSentences 合并相邻小段
 *  - 过巨：整书只有一两个书签 → 用 maxSentences 把超长章切成子章
 *
 * 设计原则：跟随书本身的结构分章，但绝不盲从原始粒度；从不按页数切。
 */

export interface Boundary {
  title: string
  /** 该分界点对应的句子下标（新章节从此句开始） */
  sentenceIndex: number
  /** 目录层级，1=顶级（预留按层级优选，当前未强制使用） */
  depth?: number
}

export interface BuiltChapter {
  title: string
  startIndex: number
  sentenceCount: number
}

export interface ChapterBuildOptions {
  /** 一章最少句数，相邻分界点间距低于此值则合并（防碎）。默认 120 */
  minSentences?: number
  /** 一章最多句数，超出切成子章（防巨）。默认 600 */
  maxSentences?: number
  /** 无分界点时按尺寸伪分章的每章句数。默认 400 */
  pseudoChunkSize?: number
}

const DEFAULT_MIN = 120
const DEFAULT_MAX = 600
const DEFAULT_PSEUDO = 400

/** 无结构信号时按尺寸伪分章 */
function buildSizeChapters(total: number, chunkSize: number): BuiltChapter[] {
  const chapters: BuiltChapter[] = []
  for (let i = 0; i < total; i += chunkSize) {
    const count = Math.min(chunkSize, total - i)
    chapters.push({
      title: `第${chapters.length + 1}部分`,
      startIndex: i,
      sentenceCount: count
    })
  }
  return chapters
}

/** 把超长章节切成若干子章（标题加「（n）」后缀） */
function splitOversized(chapters: BuiltChapter[], maxSentences: number): BuiltChapter[] {
  const out: BuiltChapter[] = []
  for (const ch of chapters) {
    if (ch.sentenceCount <= maxSentences) {
      out.push(ch)
      continue
    }
    let offset = 0
    let n = 1
    while (offset < ch.sentenceCount) {
      const count = Math.min(maxSentences, ch.sentenceCount - offset)
      out.push({
        title: `${ch.title}（${n}）`,
        startIndex: ch.startIndex + offset,
        sentenceCount: count
      })
      offset += count
      n++
    }
  }
  return out
}

/**
 * 由分界点构建章节。
 * @param totalSentences 全文句子总数
 * @param boundaries     分界点列表（任意顺序，内部会排序去重）
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

  // 无分界点 → 尺寸伪分章
  if (!boundaries || boundaries.length === 0) {
    return buildSizeChapters(total, pseudoChunkSize)
  }

  // 规整：夹到 [0, total-1]，按位置排序
  const pts = boundaries
    .map((b) => ({
      title: b.title.trim() || '未命名',
      idx: Math.max(0, Math.min(total - 1, Math.floor(b.sentenceIndex)))
    }))
    .sort((a, b) => a.idx - b.idx)

  // 选取保留的分界点：与上一个保留点间距需 ≥ minSentences（防碎），否则并入当前章
  const kept: Array<{ title: string; idx: number }> = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].idx - kept[kept.length - 1].idx >= minSentences) {
      kept.push(pts[i])
    }
  }

  // 由保留点构建章节：第一章从 0 开始，吸收首个分界点之前的卷首文字
  const chapters: BuiltChapter[] = []
  for (let j = 0; j < kept.length; j++) {
    const start = j === 0 ? 0 : kept[j].idx
    const end = j + 1 < kept.length ? kept[j + 1].idx : total
    if (end > start) {
      chapters.push({ title: kept[j].title, startIndex: start, sentenceCount: end - start })
    }
  }

  // 末尾章节过小则并入前一章，避免 dangling 小章
  if (chapters.length > 1) {
    const last = chapters[chapters.length - 1]
    if (last.sentenceCount < minSentences) {
      chapters[chapters.length - 2].sentenceCount += last.sentenceCount
      chapters.pop()
    }
  }

  // 超长章节切子章（防巨）
  return splitOversized(chapters, maxSentences)
}

/**
 * 把解析器已产出的原始章节列表再过一遍归一化（合并过小、切分过大）。
 * 各格式保留自己的标题/目录检测逻辑，仅借此层统一防碎防巨。
 */
export function refineChapters(
  totalSentences: number,
  rawChapters: Array<{ title: string; startIndex: number; sentenceCount: number }>,
  options: ChapterBuildOptions = {}
): BuiltChapter[] {
  const boundaries: Boundary[] = rawChapters.map((c) => ({
    title: c.title,
    sentenceIndex: c.startIndex
  }))
  return buildChapters(totalSentences, boundaries, options)
}

// ── 标题启发式识别（无目录/书签时的退路，PDF/TXT 等共用）──────────

const HEADING_PATTERNS: RegExp[] = [
  /^第[0-9一二三四五六七八九十百千零两]+[章回节部卷篇]/,
  /^chapter\s+[0-9ivxlc]+/i,
  /^part\s+[0-9ivxlc]+/i,
  /^section\s+[0-9.]+/i
]

/**
 * 从句子序列里识别章节标题（短句且匹配章节模式），返回分界点。
 * 保守策略：仅认 40 字以内的短句，避免误伤以"第X章"开头的正文。
 */
export function detectHeadingBoundaries(sentences: string[]): Boundary[] {
  const boundaries: Boundary[] = []
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim()
    if (s.length === 0 || s.length > 40) continue
    if (HEADING_PATTERNS.some((re) => re.test(s))) {
      boundaries.push({ title: s, sentenceIndex: i })
    }
  }
  return boundaries
}
