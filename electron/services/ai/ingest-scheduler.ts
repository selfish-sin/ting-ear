import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BookData } from '../../../src/global'
import {
  IngestService,
  bookContentHash,
  bookFullContent,
  isLegacyChapterState,
  type BookSyncState,
  type SyncStatusV2
} from './ingest-service'
import type { NmemBridge } from './nmem-bridge'

/** 旧格式：{ bookId: { ingestedAt } } → 视为待核验 */
interface LegacyStatus {
  [bookId: string]: { ingestedAt: string }
}

function isLegacyIngestedAtStatus(data: unknown): data is LegacyStatus {
  if (!data || typeof data !== 'object') return false
  return Object.values(data as Record<string, unknown>).every(
    (v) =>
      v &&
      typeof v === 'object' &&
      'ingestedAt' in (v as Record<string, unknown>) &&
      !('chapters' in (v as Record<string, unknown>)) &&
      !('contentHash' in (v as Record<string, unknown>))
  )
}

function normalizeBookState(raw: unknown): BookSyncState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<BookSyncState> & { chapters?: BookSyncState['chapters'] }
  // 旧按章：无顶层 sourceId/contentHash
  if (value.chapters && typeof value.chapters === 'object' && !value.contentHash) {
    return {
      sourceId: '',
      contentHash: '',
      status: 'failed',
      error: '旧版按章导入，需整本重新同步',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      chapters: value.chapters
    }
  }
  if (typeof value.contentHash !== 'string') return undefined
  return {
    sourceId: typeof value.sourceId === 'string' ? value.sourceId : '',
    contentHash: value.contentHash,
    status:
      value.status === 'searchable' ||
      value.status === 'indexing' ||
      value.status === 'submitting' ||
      value.status === 'failed'
        ? value.status
        : 'indexing',
    error: typeof value.error === 'string' ? value.error : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  }
}

/**
 * 自动导入调度器 V3：
 * - 一书一源（整本正文一次上传），不再按章/页拆分
 * - 本地 contentHash 命中且状态正常 → 绝不重复上传
 * - 旧按章状态自动标记为待迁移，下次探针整本补导一次
 * - 导书时即时尝试；失败则留给探针补导
 * - 手动「立即同步」只同步需要更新的书，避免把已导入的书再推一遍
 */
export class IngestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private probing = false

  constructor(
    private readonly getDataDir: () => string,
    private readonly nmem: NmemBridge,
    private readonly ingest: IngestService,
    private readonly getBooks: () => BookData[],
    private readonly log: (level: 'info' | 'error', msg: string) => void
  ) {}

  private statusPath(): string {
    return join(this.getDataDir(), 'ingest-status.json')
  }

  loadStatus(): SyncStatusV2 {
    try {
      if (existsSync(this.statusPath())) {
        const raw = JSON.parse(readFileSync(this.statusPath(), 'utf-8'))
        if (isLegacyIngestedAtStatus(raw)) {
          this.log('info', '检测到旧版导入状态，将在下次探针时整本核验')
          return {}
        }
        const status: SyncStatusV2 = {}
        for (const [bookId, value] of Object.entries(raw as Record<string, unknown>)) {
          const normalized = normalizeBookState(value)
          if (normalized) status[bookId] = normalized
        }
        return status
      }
    } catch {
      /* ignore */
    }
    return {}
  }

  private saveStatus(status: SyncStatusV2): void {
    // 落盘时去掉 chapters 兼容字段，避免状态文件继续膨胀
    const clean: SyncStatusV2 = {}
    for (const [bookId, state] of Object.entries(status)) {
      clean[bookId] = {
        sourceId: state.sourceId,
        contentHash: state.contentHash,
        status: state.status,
        error: state.error,
        updatedAt: state.updatedAt
      }
    }
    writeFileSync(this.statusPath(), JSON.stringify(clean, null, 2), 'utf-8')
  }

  private getBookState(status: SyncStatusV2, bookId: string): BookSyncState | undefined {
    return status[bookId]
  }

  /** 判断一本书是否需要向 MDM 提交（无记录 / 失败 / 内容变了 / 旧按章状态） */
  private bookNeedsSync(book: BookData, state: BookSyncState | undefined): boolean {
    if (!bookFullContent(book)) return false
    if (!state) return true
    if (isLegacyChapterState(state)) return true
    if (state.status === 'failed') return true
    if (!state.sourceId) return true
    if (state.contentHash !== bookContentHash(book)) return true
    return false
  }

  private getPendingBooks(): BookData[] {
    const status = this.loadStatus()
    return this.getBooks().filter((book) => {
      if (!bookFullContent(book)) return false
      return this.bookNeedsSync(book, this.getBookState(status, book.id))
    })
  }

  /**
   * 同步单本书：
   * - 内容未变且本地状态可用 → 只核验远程，不重新上传
   * - 否则整本上传一次
   */
  async syncBook(book: BookData, options: { force?: boolean } = {}): Promise<BookSyncState> {
    const status = this.loadStatus()
    const existing = this.getBookState(status, book.id)
    const hash = bookContentHash(book)

    if (
      !options.force &&
      existing &&
      !isLegacyChapterState(existing) &&
      existing.contentHash === hash &&
      existing.sourceId &&
      (existing.status === 'searchable' || existing.status === 'indexing')
    ) {
      // 内容未变：只向 MDM 确认 source 是否还在
      const remote = await this.ingest.verifySource(existing.sourceId)
      if (remote === 'searchable' || remote === 'indexing') {
        return {
          sourceId: existing.sourceId,
          contentHash: hash,
          status: remote,
          updatedAt: new Date().toISOString()
        }
      }
      // 远程丢了 → 走整本重传
      this.log('info', `知识库源已失效，整本重传: ${book.title}`)
    }

    const state = await this.ingest.ingestWholeBook(book)
    if (state.status === 'failed') {
      this.log('error', `知识库整本导入失败: ${book.title} — ${state.error || '未知错误'}`)
    } else {
      this.log(
        'info',
        `知识库整本导入完成: ${book.title}（source=${state.sourceId || '?'}, status=${state.status}）`
      )
    }
    return state
  }

  /** 即时尝试导入单本书（导书时调用） */
  async tryIngest(book: BookData): Promise<boolean> {
    try {
      // 已同步且内容未变 → 直接成功，绝不重复上传
      const status = this.loadStatus()
      if (!this.bookNeedsSync(book, status[book.id])) {
        this.log('info', `知识库已同步，跳过: ${book.title}`)
        return true
      }

      const state = await this.syncBook(book)
      const current = this.loadStatus()
      current[book.id] = state
      this.saveStatus(current)
      return state.status !== 'failed'
    } catch {
      return false
    }
  }

  /** 验证已有状态：检查 nmem 中 source 是否仍然存在且可检索 */
  private async verifyExisting(status: SyncStatusV2): Promise<boolean> {
    let changed = false
    let remoteSources: Awaited<ReturnType<NmemBridge['listSources']>>
    try {
      remoteSources = await this.nmem.listSources()
    } catch {
      return false
    }

    const sourceSet = new Set(remoteSources.map((s) => s.id))
    for (const [, bookState] of Object.entries(status)) {
      if (isLegacyChapterState(bookState)) continue
      if (bookState.sourceId && !sourceSet.has(bookState.sourceId)) {
        bookState.status = 'failed'
        bookState.error = '知识库中未找到该来源，需要重新同步'
        bookState.updatedAt = new Date().toISOString()
        changed = true
      } else if (bookState.status === 'indexing' && bookState.sourceId) {
        const info = remoteSources.find((s) => s.id === bookState.sourceId)
        if (info?.status === 'ready') {
          bookState.status = 'searchable'
          bookState.updatedAt = new Date().toISOString()
          changed = true
        } else if (info?.status === 'failed') {
          bookState.status = 'failed'
          bookState.error = info.error || '知识库索引失败'
          bookState.updatedAt = new Date().toISOString()
          changed = true
        }
      }
    }

    if (changed) this.saveStatus(status)
    return changed
  }

  /** 批量补导所有未同步书籍 + 验证已有状态 */
  private async catchUp(): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      const health = await this.nmem.checkHealth({ force: true })
      if (health.status !== 'online') return

      const status = this.loadStatus()
      if (Object.keys(status).length > 0) {
        await this.verifyExisting(status)
      }

      const pending = this.getPendingBooks()
      if (pending.length === 0) return

      this.log('info', `知识库补导开始: ${pending.length} 本待整本同步`)
      let success = 0
      for (const book of pending) {
        try {
          const bookState = await this.syncBook(book)
          const current = this.loadStatus()
          current[book.id] = bookState
          this.saveStatus(current)
          if (bookState.status !== 'failed') success++
        } catch {
          break
        }
      }
      if (success > 0) {
        this.log('info', `知识库补导完成: ${success}/${pending.length} 本`)
      }
    } catch {
      // 探针失败静默
    } finally {
      this.probing = false
    }
  }

  /**
   * 手动同步：
   * - 默认只同步「需要更新」的书（防重复）
   * - force=true 时强制整本重传全部书
   */
  async syncAll(options: { force?: boolean } = {}): Promise<{ synced: number; failed: number; skipped: number }> {
    const books = this.getBooks().filter((b) => bookFullContent(b))
    let synced = 0
    let failed = 0
    let skipped = 0
    const status = this.loadStatus()

    for (const book of books) {
      try {
        if (!options.force && !this.bookNeedsSync(book, status[book.id])) {
          skipped++
          continue
        }
        const bookState = await this.syncBook(book, { force: options.force })
        const current = this.loadStatus()
        current[book.id] = bookState
        this.saveStatus(current)
        if (bookState.status === 'failed') failed++
        else synced++
      } catch {
        failed++
      }
    }

    return { synced, failed, skipped }
  }

  /** 启动定时探针（30s 间隔） */
  start(): void {
    if (this.timer) return
    setTimeout(() => void this.catchUp(), 5000)
    this.timer = setInterval(() => void this.catchUp(), 30000)
  }

  /** 停止探针 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
