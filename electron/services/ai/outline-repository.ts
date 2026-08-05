import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 落盘文件格式版本（写入时使用）。
 * 历史：v3/v4 记录结构兼容；v4 曾错误地「只认等于 4」，导致用户磁盘上大量 v3 大纲整库 miss、反复烧 LLM。
 */
export const OUTLINE_CACHE_VERSION = 4

/**
 * 可读的最低文件版本。
 * v3 与 v4 的 records 字段一致，必须兼容读；禁止再因 version !== N 整文件作废。
 */
export const OUTLINE_CACHE_MIN_READABLE_VERSION = 3

/** 产物 schema：1 = 旧目录式（title/point/summary）；2 = ChapterBrief（下组实现） */
export const OUTLINE_SCHEMA_LEGACY = 1
export const OUTLINE_SCHEMA_BRIEF = 2

export type ChapterOutlineStatus = 'queued' | 'generating' | 'generated' | 'short_chapter' | 'failed'

/** 阿基米德支点：本章中「一处理解关键」的句偏移 + 为何是支点 */
export interface ChapterHinge {
  /** 句偏移（相对章首） */
  at: number
  /** 为何这是支点：一句话说明思想张力或认知转折 */
  insight: string
}

export interface ChapterOutlineSectionRecord {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  summary?: string
  startOffset: number
}

/**
 * 章节大纲缓存记录。
 * schemaVersion 软标记：缺省 / 1 = 旧产物，仍算有效命中，绝不因 schema 旧而强制重算。
 * schema=2 (ChapterBrief) 追加 thesis/whyItMatters/hinges；字段全可选，legacy 记录零迁移。
 */
export interface ChapterOutlineRecord {
  bookId: string
  chapterKey: string
  chapterIndex: number
  contentHash: string
  status: ChapterOutlineStatus
  minimumSections: number
  sections: ChapterOutlineSectionRecord[]
  /** 产物形态版本；缺省按 LEGACY=1 处理。升级 prompt/结构时只增字段，不借此失效缓存。 */
  schemaVersion?: number
  /** schema=2：本章一句话主张 */
  thesis?: string
  /** schema=2：读懂本章差在哪（为何重要） */
  whyItMatters?: string
  /** schema=2：1～3 个阿基米德支点 */
  hinges?: ChapterHinge[]
  generatedAt?: string
  error?: string
}

interface OutlineCacheFile {
  version: number
  records: Record<string, ChapterOutlineRecord>
}

function safeBookPath(dataDir: string, bookId: string): string {
  const safeId = bookId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(dataDir, 'outlines', `${safeId}.json`)
}

function isUsableStatus(status: unknown): status is ChapterOutlineStatus {
  return (
    status === 'queued' ||
    status === 'generating' ||
    status === 'generated' ||
    status === 'short_chapter' ||
    status === 'failed'
  )
}

/** 归一化单条记录：补 schemaVersion、容错残缺字段，不丢已有内容 */
export function normalizeOutlineRecord(raw: unknown): ChapterOutlineRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<ChapterOutlineRecord>
  if (typeof r.bookId !== 'string' || typeof r.chapterKey !== 'string') return null
  if (typeof r.contentHash !== 'string') return null
  if (!isUsableStatus(r.status)) return null
  if (!Array.isArray(r.sections)) return null

  const sections: ChapterOutlineSectionRecord[] = r.sections.flatMap((section, index) => {
    if (!section || typeof section !== 'object') return []
    const s = section as Partial<ChapterOutlineSectionRecord>
    const originalTitle =
      typeof s.originalTitle === 'string' && s.originalTitle.trim()
        ? s.originalTitle.trim()
        : `小节 ${index + 1}`
    const startOffset = Math.floor(Number(s.startOffset))
    if (!Number.isFinite(startOffset)) return []
    const out: ChapterOutlineSectionRecord = {
      id: typeof s.id === 'string' && s.id ? s.id : `${r.chapterKey}-${index}`,
      originalTitle,
      startOffset
    }
    if (typeof s.customTitle === 'string' && s.customTitle.trim()) out.customTitle = s.customTitle.trim()
    if (typeof s.point === 'string' && s.point.trim()) out.point = s.point.trim()
    if (typeof s.summary === 'string' && s.summary.trim()) out.summary = s.summary.trim()
    return [out]
  })

  const schemaVersion =
    typeof r.schemaVersion === 'number' && Number.isFinite(r.schemaVersion) && r.schemaVersion >= 1
      ? Math.floor(r.schemaVersion)
      : OUTLINE_SCHEMA_LEGACY

  // schema=2 (ChapterBrief) 可选字段：仅有值时保留，缺字段不阻塞 legacy 记录
  const thesis = typeof r.thesis === 'string' && r.thesis.trim() ? r.thesis.trim() : undefined
  const whyItMatters =
    typeof r.whyItMatters === 'string' && r.whyItMatters.trim() ? r.whyItMatters.trim() : undefined
  const hinges = normalizeHinges(r.hinges)

  return {
    bookId: r.bookId,
    chapterKey: r.chapterKey,
    chapterIndex: typeof r.chapterIndex === 'number' && Number.isInteger(r.chapterIndex) ? r.chapterIndex : 0,
    contentHash: r.contentHash,
    status: r.status,
    minimumSections:
      typeof r.minimumSections === 'number' && Number.isFinite(r.minimumSections)
        ? Math.max(1, Math.floor(r.minimumSections))
        : 2,
    sections,
    schemaVersion,
    thesis,
    whyItMatters,
    hinges,
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : undefined,
    error: typeof r.error === 'string' ? r.error : undefined
  }
}

/**
 * 归一化支点数组：逐项校验 { at: number, insight: string }，非法项丢弃。
 * 仅在至少有一个有效项时返回数组，否则 undefined（避免空数组噪音）。
 */
function normalizeHinges(raw: unknown): ChapterHinge[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const hinges: ChapterHinge[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const h = item as Partial<ChapterHinge>
    const at = Math.floor(Number(h.at))
    if (!Number.isFinite(at)) continue
    if (typeof h.insight !== 'string' || !h.insight.trim()) continue
    hinges.push({ at, insight: h.insight.trim() })
  }
  return hinges.length > 0 ? hinges : undefined
}

export class ChapterOutlineRepository {
  constructor(private readonly dataDir: string) {}

  private path(bookId: string): string {
    return safeBookPath(this.dataDir, bookId)
  }

  /**
   * 读整书大纲文件。兼容 v3～当前版本；过旧或损坏返回 null。
   * 不在读路径上改写磁盘（避免无写权限/并发问题）；save 时再抬升 file version。
   */
  private readBook(bookId: string): OutlineCacheFile | null {
    const path = this.path(bookId)
    if (!existsSync(path)) return null
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<OutlineCacheFile>
      const fileVersion = typeof value.version === 'number' ? value.version : 0
      if (fileVersion < OUTLINE_CACHE_MIN_READABLE_VERSION) return null
      // 未来若写入更高版本：仍尽量读 records，避免又一次「整库作废」
      if (!value.records || typeof value.records !== 'object') return null

      const records: Record<string, ChapterOutlineRecord> = {}
      for (const [key, raw] of Object.entries(value.records)) {
        const normalized = normalizeOutlineRecord(raw)
        if (normalized) records[key] = normalized
      }
      return { version: fileVersion, records }
    } catch {
      return null
    }
  }

  /**
   * 按 contentHash 精确命中。
   * 注意：schemaVersion 旧（legacy）仍返回记录 —— 软失效，调用方不得因 schema 旧而当 miss 重算。
   */
  load(bookId: string, chapterKey: string, contentHash: string): ChapterOutlineRecord | null {
    const record = this.readBook(bookId)?.records[chapterKey]
    if (!record || record.contentHash !== contentHash) return null
    return record
  }

  /** 不校验 hash，用于调试/迁移检查 */
  loadAny(bookId: string, chapterKey: string): ChapterOutlineRecord | null {
    return this.readBook(bookId)?.records[chapterKey] ?? null
  }

  save(record: ChapterOutlineRecord): void {
    const path = this.path(record.bookId)
    mkdirSync(dirname(path), { recursive: true })
    const current = this.readBook(record.bookId) || { version: OUTLINE_CACHE_VERSION, records: {} }
    const normalized = normalizeOutlineRecord({
      ...record,
      schemaVersion: record.schemaVersion ?? OUTLINE_SCHEMA_LEGACY
    })
    if (!normalized) {
      throw new Error('outline record invalid, refuse to save')
    }
    current.records[record.chapterKey] = normalized
    // 写入抬升到当前文件版本，保留其余章的旧记录（渐进迁移，不整库重算）
    const out: OutlineCacheFile = { version: OUTLINE_CACHE_VERSION, records: current.records }
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(out, null, 2), 'utf8')
    renameSync(tempPath, path)
  }

  deleteBook(bookId: string): void {
    const path = this.path(bookId)
    if (existsSync(path)) rmSync(path, { force: true })
  }
}
