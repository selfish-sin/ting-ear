import { createHash } from 'crypto'
import type { BookData } from '../../../src/global'
import type { NmemBridge, NmemSourceInfo } from './nmem-bridge'

export type BookSyncStatus = 'submitting' | 'indexing' | 'searchable' | 'failed'

/** @deprecated 旧版按章同步状态，读取时自动迁移 */
export type ChapterSyncStatus = BookSyncStatus

export interface ChapterSyncState {
  sourceId: string
  contentHash: string
  status: ChapterSyncStatus
  error?: string
  updatedAt: string
}

/**
 * V3：一书一源（整本上传）。
 * 兼容字段 chapters 仅用于识别/迁移旧状态，新写入不再按章拆分。
 */
export interface BookSyncState {
  sourceId: string
  contentHash: string
  status: BookSyncStatus
  error?: string
  updatedAt: string
  /** 旧版按章记录；存在时视为过期，下次会整本重传一次 */
  chapters?: Record<string, ChapterSyncState>
}

export type SyncStatusV2 = Record<string, BookSyncState>

export interface IngestSummary {
  ingested: number
  duplicates: number
  skipped: number
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16)
}

/** 稳定源名称：同一本书重复提交时尽量命中 MDM 去重 */
export function bookSourceName(book: BookData): string {
  const title = (book.title || '未命名书籍').trim() || '未命名书籍'
  return `${title} [bookId=${book.id}]`
}

/** 整本书正文（不再按章/页拆分） */
export function bookFullContent(book: BookData): string {
  return (book.sentences || []).join('\n').trim()
}

export function bookContentHash(book: BookData): string {
  return contentHash(bookFullContent(book))
}

function sourceStatusToSync(status: NmemSourceInfo['status']): BookSyncStatus {
  switch (status) {
    case 'ready':
      return 'searchable'
    case 'processing':
      return 'indexing'
    case 'failed':
      return 'failed'
    default:
      return 'indexing'
  }
}

/** 是否为旧版「按章」状态（需要整本迁移） */
export function isLegacyChapterState(state: BookSyncState | undefined): boolean {
  if (!state) return false
  if (state.chapters && Object.keys(state.chapters).length > 0 && !state.sourceId) return true
  // 旧写入可能只有 chapters 没有顶层 sourceId
  if (state.chapters && !state.contentHash) return true
  return false
}

export class IngestService {
  constructor(private readonly nmem: NmemBridge) {}

  /**
   * 整本导入为单一 MDM source。
   * 不再按章节循环上传，避免 Library 里出现成百上千重复条目。
   */
  async ingestBook(book: BookData, signal?: AbortSignal): Promise<IngestSummary> {
    const state = await this.ingestWholeBook(book, signal)
    if (state.status === 'failed') {
      return { ingested: 0, duplicates: 0, skipped: state.error?.includes('为空') ? 1 : 0 }
    }
    // isDuplicate 时仍记 1 次「已处理」；调用方看日志即可
    return {
      ingested: state.status === 'searchable' || state.status === 'indexing' ? 1 : 0,
      duplicates: 0,
      skipped: 0
    }
  }

  /** 导入整本书并返回同步状态 */
  async ingestWholeBook(book: BookData, signal?: AbortSignal): Promise<BookSyncState> {
    const content = bookFullContent(book)
    const hash = contentHash(content)
    const now = new Date().toISOString()

    if (!content) {
      return {
        sourceId: '',
        contentHash: hash,
        status: 'failed',
        error: '书籍内容为空',
        updatedAt: now
      }
    }

    try {
      const result = await this.nmem.ingestContent(
        {
          content,
          name: bookSourceName(book),
          sourceType: book.format || 'text'
        },
        signal
      )

      let status: BookSyncStatus = result.isDuplicate ? 'searchable' : 'indexing'
      let error: string | undefined
      try {
        const info = await this.nmem.getSource(result.sourceId, signal)
        if (info) {
          status = sourceStatusToSync(info.status)
          error = info.error
        }
      } catch {
        // 查询失败不阻塞
      }

      return {
        sourceId: result.sourceId,
        contentHash: hash,
        status,
        error,
        updatedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        sourceId: '',
        contentHash: hash,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString()
      }
    }
  }

  /** @deprecated 保留兼容：旧按章 API 改为整本导入 */
  async ingestChapter(
    book: BookData,
    _chapterIndex: number,
    signal?: AbortSignal
  ): Promise<ChapterSyncState> {
    const state = await this.ingestWholeBook(book, signal)
    return {
      sourceId: state.sourceId,
      contentHash: state.contentHash,
      status: state.status,
      error: state.error,
      updatedAt: state.updatedAt
    }
  }

  /** 验证已有 sourceId 在 nmem 中的真实状态 */
  async verifySource(sourceId: string, signal?: AbortSignal): Promise<BookSyncStatus> {
    if (!sourceId) return 'failed'
    try {
      const info = await this.nmem.getSource(sourceId, signal)
      if (!info) return 'failed'
      return sourceStatusToSync(info.status)
    } catch {
      return 'failed'
    }
  }
}
