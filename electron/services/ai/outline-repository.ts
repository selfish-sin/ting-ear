import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const OUTLINE_CACHE_VERSION = 3

export type ChapterOutlineStatus = 'queued' | 'generating' | 'generated' | 'short_chapter' | 'failed'

export interface ChapterOutlineSectionRecord {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  startOffset: number
}

export interface ChapterOutlineRecord {
  bookId: string
  chapterKey: string
  chapterIndex: number
  contentHash: string
  status: ChapterOutlineStatus
  minimumSections: number
  sections: ChapterOutlineSectionRecord[]
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

export class ChapterOutlineRepository {
  constructor(private readonly dataDir: string) {}

  private path(bookId: string): string {
    return safeBookPath(this.dataDir, bookId)
  }

  private readBook(bookId: string): OutlineCacheFile | null {
    const path = this.path(bookId)
    if (!existsSync(path)) return null
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as OutlineCacheFile
      if (value.version !== OUTLINE_CACHE_VERSION || !value.records || typeof value.records !== 'object') return null
      return value
    } catch {
      return null
    }
  }

  load(bookId: string, chapterKey: string, contentHash: string): ChapterOutlineRecord | null {
    const record = this.readBook(bookId)?.records[chapterKey]
    return record?.contentHash === contentHash ? record : null
  }

  save(record: ChapterOutlineRecord): void {
    const path = this.path(record.bookId)
    mkdirSync(dirname(path), { recursive: true })
    const current = this.readBook(record.bookId) || { version: OUTLINE_CACHE_VERSION, records: {} }
    current.records[record.chapterKey] = record
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(current, null, 2), 'utf8')
    renameSync(tempPath, path)
  }

  deleteBook(bookId: string): void {
    const path = this.path(bookId)
    if (existsSync(path)) rmSync(path, { force: true })
  }
}
