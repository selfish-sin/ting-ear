import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { BookData } from '../../../src/global'
import { bookContentFingerprint } from '../library-storage'
import {
  IngestService,
  bookContentHash,
  bookFullContent,
  isLegacyChapterState,
  type BookSyncState,
  type BookSyncStatus,
  type SyncStatusV2
} from './ingest-service'
import type { NmemBridge, NmemSourceInfo } from './nmem-bridge'

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
 * - 本地 contentHash 是唯一重传依据：hash 匹配且状态正常 → 绝不重传、不查远程
 * - 不因远程验证失败而重传（避免 nmem 抖动/重启导致每次打开都全量重新导入）
 * - 旧按章状态自动标记为待迁移，下次探针整本补导一次
 * - 导书时即时尝试；失败则留给探针补导
 * - 手动「立即同步」只同步需要更新的书；force 才强制重传
 * - 手动「去重知识库」清理历史重复源（纯手动，不改本地状态，不会触发重传）
 */
/** 从 source 显示名解析听伴 bookId（`… [bookId=uuid]`） */
export function parseBookIdFromSourceName(name: string): string | null {
  if (!name) return null
  const m = name.match(/\[bookId=([^\]]+)\]/)
  return m ? m[1] : null
}

/**
 * 同 bookId 多源时选保留哪一个：
 * 1) status=ready 优先
 * 2) version 更高优先（nmem v2/v3）
 * 3) 与 preferSourceId 一致的优先（本地状态记录的那条）
 * 4) id 字典序兜底（稳定）
 */
export function pickPreferredSource(
  list: NmemSourceInfo[],
  preferSourceId?: string
): NmemSourceInfo {
  const ranked = [...list].sort((a, b) => {
    const readyA = a.status === 'ready' ? 0 : 1
    const readyB = b.status === 'ready' ? 0 : 1
    if (readyA !== readyB) return readyA - readyB
    const verA = typeof a.version === 'number' ? a.version : 0
    const verB = typeof b.version === 'number' ? b.version : 0
    if (verA !== verB) return verB - verA
    if (preferSourceId) {
      if (a.id === preferSourceId && b.id !== preferSourceId) return -1
      if (b.id === preferSourceId && a.id !== preferSourceId) return 1
    }
    return a.id.localeCompare(b.id)
  })
  return ranked[0]
}

export class IngestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private probing = false
  /**
   * per-book in-flight 锁：同一本书正在上传时，并发的 syncBook/tryIngest/catchUp
   * 直接复用同一个 Promise，绝不重复向 nmem 提交。
   * 解决「导入即时线 tryIngest」与「探针定时线 catchUp」双线并发导致的重复源。
   */
  private inflight = new Map<string, Promise<BookSyncState>>()
  /**
   * ingest-status.json 串行写队列：批量并行 tryIngest 时若各自 load→改→save，
   * 后写会覆盖先写，导致「状态丢了 → 探针再传一遍 → nmem 升 v2」。
   */
  private statusWriteChain: Promise<void> = Promise.resolve()
  /**
   * 书架指纹缓存（bookId → 上次见到的轻量指纹）。
   * 探针先用轻量索引比对指纹：只有指纹变了 / 状态缺失 / 上次失败的书，
   * 才去 loadAll 加载全文算 contentHash。稳态下（书没动）探针零全文加载，
   * 消除每 30s「读全部书全文 + 全量哈希」的周期性卡顿。
   */
  private fingerprintCache = new Map<string, string>()

  constructor(
    private readonly getDataDir: () => string,
    private readonly nmem: NmemBridge,
    private readonly ingest: IngestService,
    private readonly getBooks: () => BookData[],
    private readonly log: (level: 'info' | 'error', msg: string) => void,
    /**
     * 可选：轻量书架索引（不含全文）。提供后探针走指纹预筛，避免每次 loadAll。
     * 返回 { id, fingerprint, sentenceCount }[]。
     */
    private readonly getBookIndex?: () => Array<{ id: string; fingerprint: string; sentenceCount: number }>
  ) {}

  private statusPath(): string {
    return join(this.getDataDir(), 'ingest-status.json')
  }

  async loadStatus(): Promise<SyncStatusV2> {
    try {
      if (existsSync(this.statusPath())) {
        const raw = JSON.parse(await readFile(this.statusPath(), 'utf-8'))
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

  private async saveStatus(status: SyncStatusV2): Promise<void> {
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
    await writeFile(this.statusPath(), JSON.stringify(clean, null, 2), 'utf-8')
  }

  /**
   * 串行合并写入单本书状态，避免多书并行 tryIngest 时互相覆盖。
   * 队列内：重新 load → 写入 bookId → save，保证其它书的状态不会丢。
   */
  private async updateBookStatus(bookId: string, state: BookSyncState): Promise<void> {
    const run = this.statusWriteChain.then(async () => {
      const current = await this.loadStatus()
      current[bookId] = state
      await this.saveStatus(current)
    })
    // 后续任务继续排队；当前失败不阻断队列
    this.statusWriteChain = run.then(
      () => undefined,
      () => undefined
    )
    await run
  }

  /**
   * 删除同一 bookId 下除 keepSourceId 以外的所有 nmem 源（含历史 v1 孤儿）。
   * listSources 失败时退回只删 knownOldSourceId。
   */
  private async deleteSiblingSources(
    bookId: string,
    keepSourceId: string,
    knownOldSourceId?: string
  ): Promise<number> {
    if (!bookId || !keepSourceId) return 0
    let removed = 0
    let sources: NmemSourceInfo[] | null = null
    try {
      sources = await this.nmem.listSources()
    } catch {
      sources = null
    }

    if (sources) {
      for (const s of sources) {
        if (s.id === keepSourceId) continue
        if (parseBookIdFromSourceName(s.name) !== bookId) continue
        const ok = await this.nmem.deleteSource(s.id)
        if (ok) {
          removed++
          this.log('info', `已清理重复知识库源 ${s.id}（bookId=${bookId}）`)
        }
      }
      return removed
    }

    // list 失败：至少尝试删本地记得的旧 sourceId
    if (knownOldSourceId && knownOldSourceId !== keepSourceId) {
      const ok = await this.nmem.deleteSource(knownOldSourceId)
      if (ok) {
        removed++
        this.log('info', `已清理旧知识库源 ${knownOldSourceId}`)
      }
    }
    return removed
  }

  private getBookState(status: SyncStatusV2, bookId: string): BookSyncState | undefined {
    return status[bookId]
  }

  /**
   * 查询单本书本地知识库同步状态（不触发网络）。
   * 供对话侧提示「本书尚未同步到知识库」。
   */
  async getBookIngestStatus(bookId: string): Promise<{
    status: 'none' | BookSyncStatus
    sourceId?: string
    error?: string
    updatedAt?: string
  }> {
    if (!bookId) return { status: 'none' }
    const status = await this.loadStatus()
    const state = this.getBookState(status, bookId)
    if (!state || isLegacyChapterState(state) || !state.sourceId) {
      return { status: 'none', error: state?.error }
    }
    return {
      status: state.status,
      sourceId: state.sourceId || undefined,
      error: state.error,
      updatedAt: state.updatedAt
    }
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

  private async getPendingBooks(): Promise<BookData[]> {
    const status = await this.loadStatus()

    // 有轻量索引时：先用指纹预筛出候选书，只对它们加载全文算 hash。
    if (this.getBookIndex) {
      const index = this.getBookIndex()
      const candidateIds = new Set<string>()
      for (const entry of index) {
        if (entry.sentenceCount <= 0) {
          this.fingerprintCache.set(entry.id, entry.fingerprint)
          continue
        }
        if (this.inflight.has(entry.id)) continue
        const state = this.getBookState(status, entry.id)
        const lastFingerprint = this.fingerprintCache.get(entry.id)
        // 需要加载全文进一步判断的情形：
        //  - 从没同步过 / 上次失败 / 旧按章状态
        //  - 已同步但书架指纹变了（内容可能改了）
        const needsFullCheck =
          !state ||
          isLegacyChapterState(state) ||
          state.status === 'failed' ||
          !state.sourceId ||
          lastFingerprint !== entry.fingerprint
        if (needsFullCheck) candidateIds.add(entry.id)
      }
      if (candidateIds.size === 0) return []
      // 只对候选书加载全文
      return this.getBooks().filter((book) => {
        if (!candidateIds.has(book.id)) return false
        if (!bookFullContent(book)) {
          this.fingerprintCache.set(book.id, this.fingerprintOf(book))
          return false
        }
        if (this.inflight.has(book.id)) return false
        const needs = this.bookNeedsSync(book, this.getBookState(status, book.id))
        if (!needs) this.fingerprintCache.set(book.id, this.fingerprintOf(book))
        return needs
      })
    }

    // 无轻量索引：退回原逻辑（全量加载）
    return this.getBooks().filter((book) => {
      if (!bookFullContent(book)) return false
      if (this.inflight.has(book.id)) return false
      return this.bookNeedsSync(book, this.getBookState(status, book.id))
    })
  }

  /** 与 library-storage 的书架 contentFingerprint 完全同口径（复用同一函数，保证缓存可比） */
  private fingerprintOf(book: BookData): string {
    return bookContentFingerprint(book)
  }

  /**
   * 同步单本书：
   * - 内容未变且本地状态有效 → 直接信任本地，不查远程、不重传
   * - 内容变化/无记录/force → 整本上传；上传成功后清理旧 source（保证只有一份）
   * - per-book in-flight 锁：同一本书并发调用复用同一 Promise，绝不重复上传
   */
  async syncBook(book: BookData, options: { force?: boolean } = {}): Promise<BookSyncState> {
    const existing = this.inflight.get(book.id)
    if (existing) return existing
    const promise = this.doSyncBook(book, options).finally(() => {
      this.inflight.delete(book.id)
    })
    this.inflight.set(book.id, promise)
    return promise
  }

  private async doSyncBook(
    book: BookData,
    options: { force?: boolean }
  ): Promise<BookSyncState> {
    const status = await this.loadStatus()
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
      // 内容未变且本地状态有效：直接信任本地，不查远程。
      // 远程验证（listSources/getSource）不可靠——nmem 抖动或重启会返回不全，
      // 一旦据此重传，会触发「删旧源→重新索引→下次又判失效→再重传」的恶性循环，
      // 表现为每次打开都全量重新导入。远程若真丢失，用户可手动 force 同步补救。
      return {
        sourceId: existing.sourceId,
        contentHash: hash,
        status: existing.status,
        updatedAt: existing.updatedAt
      }
    }

    // 上传新内容；成功后按 bookId 清理所有兄弟源（不只删本地记得的 oldSourceId）。
    // 先传后删：上传失败时旧源仍在，避免知识库缓存丢失。
    // 状态写丢时 oldSourceId 为空，仍会靠 listSources 扫到同 bookId 的 v1 孤儿并删掉。
    const oldSourceId = existing?.sourceId
    const state = await this.ingest.ingestWholeBook(book)

    if (state.sourceId && state.status !== 'failed') {
      await this.deleteSiblingSources(book.id, state.sourceId, oldSourceId || undefined)
    }

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
      const status = await this.loadStatus()
      if (!this.bookNeedsSync(book, status[book.id])) {
        this.log('info', `知识库已同步，跳过: ${book.title}`)
        return true
      }

      const state = await this.syncBook(book)
      // 串行写状态：批量并行导书时不会互相覆盖
      await this.updateBookStatus(book.id, state)
      return state.status !== 'failed'
    } catch {
      return false
    }
  }

  /** 批量补导所有未同步书籍（不验证远程，已同步的书绝不被重复捡起） */
  private async catchUp(): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      const health = await this.nmem.checkHealth({ force: true })
      if (health.status !== 'online') return

      const pending = await this.getPendingBooks()
      if (pending.length === 0) return

      this.log('info', `知识库补导开始: ${pending.length} 本待整本同步`)
      let success = 0
      for (const book of pending) {
        try {
          const bookState = await this.syncBook(book)
          await this.updateBookStatus(book.id, bookState)
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
   * - 默认只同步「需要更新」的书（防重复），已同步的跳过
   * - force=true 时强制整本重传全部书
   * - 不自动去重（去重单独由「去重知识库」按钮触发，避免误删本地记录的 source）
   */
  async syncAll(options: { force?: boolean } = {}): Promise<{ synced: number; failed: number; skipped: number }> {
    const books = this.getBooks().filter((b) => bookFullContent(b))
    let synced = 0
    let failed = 0
    let skipped = 0
    const status = await this.loadStatus()

    for (const book of books) {
      try {
        if (!options.force && !this.bookNeedsSync(book, status[book.id])) {
          skipped++
          continue
        }
        const bookState = await this.syncBook(book, { force: options.force })
        await this.updateBookStatus(book.id, bookState)
        // 本地快照也更新，避免同一次 syncAll 内后续判断用旧状态
        status[book.id] = bookState
        if (bookState.status === 'failed') failed++
        else synced++
      } catch {
        failed++
      }
    }

    return { synced, failed, skipped }
  }

  /**
   * 去重：按 bookId（source name / original_name 中的 [bookId=xxx]）分组，
   * 每组只保留 1 个 source（优先 ready → 高 version → 本地记录的 sourceId），删除多余副本。
   * 只处理 ting-ear 创建的源，不动其它。纯手动触发（设置页按钮）。
   * 会同步把本地 ingest-status 的 sourceId 改成保留的那条（不改 contentHash，不触发重传）。
   */
  async dedupeSources(): Promise<{ removed: number; kept: number; groups: number; scanned: number }> {
    const sources = await this.nmem.listSources()
    const localStatus = await this.loadStatus()
    const groups = new Map<string, NmemSourceInfo[]>()
    for (const s of sources) {
      const key = parseBookIdFromSourceName(s.name)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }
    let removed = 0
    let kept = 0
    let statusDirty = false
    for (const [bookId, list] of groups) {
      const preferId = localStatus[bookId]?.sourceId
      const winner = pickPreferredSource(list, preferId)
      kept++
      for (const s of list) {
        if (s.id === winner.id) continue
        const ok = await this.nmem.deleteSource(s.id)
        if (ok) removed++
      }
      // 本地 sourceId 指向已删副本时，改到保留的那条，避免后续误删唯一源
      const local = localStatus[bookId]
      if (local && local.sourceId && local.sourceId !== winner.id) {
        localStatus[bookId] = { ...local, sourceId: winner.id, updatedAt: new Date().toISOString() }
        statusDirty = true
      } else if (local && !local.sourceId && winner.id) {
        localStatus[bookId] = { ...local, sourceId: winner.id, updatedAt: new Date().toISOString() }
        statusDirty = true
      }
    }
    if (statusDirty) {
      await this.saveStatus(localStatus)
    }
    if (removed > 0) {
      this.log(
        'info',
        `知识库去重完成: 扫描 ${sources.length} 个源，${groups.size} 本听伴书，删除 ${removed} 个重复源，保留 ${kept} 本`
      )
    } else {
      this.log(
        'info',
        `知识库去重: 扫描 ${sources.length} 个源，${groups.size} 本听伴书，无重复源`
      )
    }
    return { removed, kept, groups: groups.size, scanned: sources.length }
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
