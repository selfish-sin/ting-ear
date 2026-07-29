/**
 * 书架分片存储：
 * - library/index.json     轻量目录（书架列表）
 * - library/books/{id}.json 单书全文（句子/结构，低频写）
 * - progress.json          阅读进度 + timeMap（高频、小文件）
 *
 * 兼容：若尚无 library/，首次加载从 books.json 迁移。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
  statSync,
  copyFileSync
} from 'fs'
import { writeFile, rename, mkdir } from 'fs/promises'
import { join } from 'path'
import type { BookData } from '../../src/global'
import {
  normalizeAndHealBook,
  normalizeBookCollection,
  normalizeBookData
} from '../../src/utils/bookData'

export interface BookProgressRecord {
  currentSentenceIndex: number
  currentChapterIndex: number
  progressPercent: number
  lastReadAt: string
  isCompleted?: boolean
  timeMap?: number[]
}

export interface LibraryIndexEntry {
  id: string
  title: string
  author: string
  coverPath?: string
  coverSource?: BookData['coverSource']
  format: string
  filePath: string
  sentenceCount: number
  chapterCount: number
  addedAt: string
  /** 内容指纹：变化才重写单书文件 */
  contentFingerprint: string
}

/** 书架卡片展示的最小数据集（不含 sentences/chapters 重数据） */
export interface ShelfEntry {
  id: string
  title: string
  author: string
  coverPath?: string
  coverSource?: string
  format: string
  filePath: string
  sentenceCount: number
  chapterCount: number
  addedAt: string
  lastReadAt: string
  progressPercent: number
  isCompleted: boolean
  currentSentenceIndex: number
  currentChapterIndex: number
}

type ProgressMap = Record<string, BookProgressRecord>

function atomicWrite(filePath: string, payload: string): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, payload, 'utf-8')
  renameSync(tmp, filePath)
}

/** 异步原子写（tmp+rename），不阻塞主进程 event loop；供高频进度落盘用 */
async function atomicWriteAsync(filePath: string, payload: string): Promise<void> {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, payload, 'utf-8')
  await rename(tmp, filePath)
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/** 内容指纹：进度字段不参与，避免进度更新触发整书重写 */
export function bookContentFingerprint(book: BookData): string {
  if (book.structureMeta?.contentHash) {
    return `${book.structureMeta.contentHash}|${book.title}|${book.chapters?.length || 0}|${book.sentences?.length || 0}`
  }
  const n = book.sentences?.length || 0
  const head = n > 0 ? book.sentences[0]?.slice(0, 32) || '' : ''
  const tail = n > 1 ? book.sentences[n - 1]?.slice(0, 32) || '' : ''
  return `${n}|${book.title}|${book.chapters?.length || 0}|${head}|${tail}|${book.editHistory?.length || 0}`
}

function toIndexEntry(book: BookData): LibraryIndexEntry {
  return {
    id: book.id,
    title: book.title,
    author: book.author || '',
    coverPath: book.coverPath,
    coverSource: book.coverSource,
    format: book.format,
    filePath: book.filePath,
    sentenceCount: book.sentences?.length || 0,
    chapterCount: book.chapters?.length || 0,
    addedAt: book.addedAt,
    contentFingerprint: bookContentFingerprint(book)
  }
}

function stripProgress(book: BookData): BookData {
  // 单书文件不存高频进度，统一以 progress.json 为准（占位默认值满足类型）
  return {
    ...book,
    currentSentenceIndex: 0,
    currentChapterIndex: 0,
    progressPercent: 0,
    timeMap: undefined
  }
}

function applyProgress(book: BookData, progress: BookProgressRecord | undefined): BookData {
  if (!progress) return book
  return {
    ...book,
    currentSentenceIndex: progress.currentSentenceIndex ?? book.currentSentenceIndex ?? 0,
    currentChapterIndex: progress.currentChapterIndex ?? book.currentChapterIndex ?? 0,
    progressPercent: progress.progressPercent ?? book.progressPercent ?? 0,
    lastReadAt: progress.lastReadAt || book.lastReadAt,
    isCompleted: progress.isCompleted ?? book.isCompleted ?? false,
    timeMap: progress.timeMap ?? book.timeMap
  }
}

function extractProgress(book: BookData): BookProgressRecord {
  return {
    currentSentenceIndex: book.currentSentenceIndex ?? 0,
    currentChapterIndex: book.currentChapterIndex ?? 0,
    progressPercent: book.progressPercent ?? 0,
    lastReadAt: book.lastReadAt || new Date().toISOString(),
    isCompleted: book.isCompleted ?? false,
    timeMap: book.timeMap
  }
}

export class LibraryStorage {
  constructor(private readonly getDataDir: () => string) {}

  /** 进度内存缓存：高频路径只改内存，防抖后异步落盘，避免每次同步整表读写 */
  private progressCache: ProgressMap | null = null
  private progressDirty = false
  private progressFlushTimer: ReturnType<typeof setTimeout> | null = null
  private progressWriteInFlight: Promise<void> | null = null
  private static readonly PROGRESS_FLUSH_MS = 1500

  private libraryDir(): string {
    return join(this.getDataDir(), 'library')
  }

  private booksDir(): string {
    return join(this.libraryDir(), 'books')
  }

  private indexPath(): string {
    return join(this.libraryDir(), 'index.json')
  }

  private progressPath(): string {
    return join(this.getDataDir(), 'progress.json')
  }

  private bookPath(id: string): string {
    return join(this.booksDir(), `${id}.json`)
  }

  private legacyBooksPath(): string {
    return join(this.getDataDir(), 'books.json')
  }

  hasLibraryLayout(): boolean {
    return existsSync(this.indexPath())
  }

  /** 按 filePath 查找索引条目（轻量，不读单书文件） */
  findByFilePath(filePath: string): LibraryIndexEntry | null {
    const index = this.loadIndex()
    return index.find((e) => e.filePath === filePath) ?? null
  }

  /** 轻量书架索引（不含全文）：供知识库探针指纹预筛，避免每 30s 全量 loadAll */
  loadBookIndex(): Array<{ id: string; fingerprint: string; sentenceCount: number }> {
    return this.loadIndex().map((e) => ({
      id: e.id,
      fingerprint: e.contentFingerprint,
      sentenceCount: e.sentenceCount
    }))
  }

  /** 按 filePath 查找索引条目并加载完整书籍数据 */
  loadBookByFilePath(filePath: string): BookData | null {
    const entry = this.findByFilePath(filePath)
    if (!entry) return null
    const progress = this.loadProgressMap()
    const file = this.loadBookFile(entry.id)
    if (!file) return null
    const merged = applyProgress(
      {
        ...file,
        title: entry.title || file.title,
        author: entry.author ?? file.author,
        coverPath: entry.coverPath ?? file.coverPath,
        coverSource: entry.coverSource ?? file.coverSource,
        filePath: entry.filePath || file.filePath,
        format: entry.format || file.format,
        addedAt: entry.addedAt || file.addedAt
      },
      progress[entry.id]
    )
    // loadBookFile 已 heal；合并索引字段后保持 trusted，禁止再跑全量 block 校验
    return (
      normalizeAndHealBook(merged, {
        trusted: true,
        contentHash: merged.structureMeta?.contentHash
      }).book
    )
  }

  /** 只保存/更新单本书（导入时用，避免遍历全部书籍） */
  saveSingleBook(book: BookData): void {
    this.ensureDirs()
    const index = this.loadIndex()
    const entry = toIndexEntry(book)
    const idx = index.findIndex((e) => e.id === book.id)
    if (idx >= 0) {
      index[idx] = entry
    } else {
      index.push(entry)
    }
    this.writeBookFile(book)
    this.saveIndex(index)
    // 更新进度
    const progress = this.loadProgressMap()
    progress[book.id] = extractProgress(book)
    this.saveProgressMap(progress)
  }

  private ensureDirs(): void {
    if (!existsSync(this.booksDir())) mkdirSync(this.booksDir(), { recursive: true })
  }

  loadProgressMap(): ProgressMap {
    if (this.progressCache) return this.progressCache
    this.progressCache = readJson<ProgressMap>(this.progressPath(), {})
    return this.progressCache
  }

  saveProgressMap(map: ProgressMap): void {
    this.progressCache = map
    atomicWrite(this.progressPath(), JSON.stringify(map))
  }

  /**
   * 高频进度落盘：内存已更新，仅负责把缓存异步写回磁盘（防抖合并）。
   * 连续高频变化只触发一次真实写盘，且不阻塞主进程。
   */
  private scheduleProgressFlush(): void {
    this.progressDirty = true
    if (this.progressFlushTimer) return
    this.progressFlushTimer = setTimeout(() => {
      this.progressFlushTimer = null
      void this.flushProgress()
    }, LibraryStorage.PROGRESS_FLUSH_MS)
  }

  /**
   * 立即把进度缓存落盘（异步原子写）。退出/切书前调用，避免防抖窗口丢进度。
   * 并发的 flush 共享同一次 in-flight 写入。
   */
  async flushProgress(): Promise<void> {
    if (this.progressFlushTimer) {
      clearTimeout(this.progressFlushTimer)
      this.progressFlushTimer = null
    }
    if (!this.progressDirty || !this.progressCache) return
    if (this.progressWriteInFlight) return this.progressWriteInFlight
    const payload = JSON.stringify(this.progressCache)
    this.progressDirty = false
    this.progressWriteInFlight = atomicWriteAsync(this.progressPath(), payload)
      .catch(() => {
        // 写失败：标回 dirty，下次 flush 重试，不丢数据
        this.progressDirty = true
      })
      .finally(() => {
        this.progressWriteInFlight = null
      })
    return this.progressWriteInFlight
  }

  /**
   * 同步落盘进度缓存——仅供进程退出前调用（will-quit），此时已无法可靠跑异步。
   */
  flushProgressSync(): void {
    if (this.progressFlushTimer) {
      clearTimeout(this.progressFlushTimer)
      this.progressFlushTimer = null
    }
    if (!this.progressDirty || !this.progressCache) return
    try {
      atomicWrite(this.progressPath(), JSON.stringify(this.progressCache))
      this.progressDirty = false
    } catch {
      // 退出时失败无法补救，静默
    }
  }

  /** 仅更新进度（高频路径，毫秒级）。整表覆盖——调用方须传完整书架进度。 */
  saveBooksProgress(books: BookData[]): void {
    const map: ProgressMap = {}
    for (const book of books) {
      map[book.id] = extractProgress(book)
    }
    this.saveProgressMap(map)
  }

  /**
   * 合并写入进度（不丢未列出的书）。
   * 渲染层高频路径只传轻量 progress 字段，避免整本 sentences 过 IPC。
   * 只改内存缓存（微秒级），落盘走防抖异步写——播放/翻页不再每次同步整表读写。
   */
  mergeBooksProgress(
    records: Array<{
      id: string
      currentSentenceIndex?: number
      currentChapterIndex?: number
      progressPercent?: number
      lastReadAt?: string
      isCompleted?: boolean
      timeMap?: number[]
    }>
  ): void {
    if (!records.length) return
    const map = this.loadProgressMap()
    for (const r of records) {
      if (!r?.id) continue
      const prev = map[r.id]
      map[r.id] = {
        currentSentenceIndex: r.currentSentenceIndex ?? prev?.currentSentenceIndex ?? 0,
        currentChapterIndex: r.currentChapterIndex ?? prev?.currentChapterIndex ?? 0,
        progressPercent: r.progressPercent ?? prev?.progressPercent ?? 0,
        lastReadAt: r.lastReadAt || prev?.lastReadAt || new Date().toISOString(),
        isCompleted: r.isCompleted ?? prev?.isCompleted ?? false,
        timeMap: r.timeMap ?? prev?.timeMap
      }
    }
    this.scheduleProgressFlush()
  }

  private loadIndex(): LibraryIndexEntry[] {
    const raw = readJson<unknown>(this.indexPath(), [])
    return Array.isArray(raw) ? (raw as LibraryIndexEntry[]) : []
  }

  private saveIndex(entries: LibraryIndexEntry[]): void {
    this.ensureDirs()
    atomicWrite(this.indexPath(), JSON.stringify(entries))
  }

  private loadBookFile(id: string): BookData | null {
    const raw = readJson<unknown>(this.bookPath(id), null)
    if (!raw) return null
    // 磁盘出口关口：trusted + 治愈超长章/巨 structure，禁止把病态布局原样灌进内存
    const contentHash =
      raw &&
      typeof raw === 'object' &&
      raw !== null &&
      'structureMeta' in raw &&
      (raw as { structureMeta?: { contentHash?: string } }).structureMeta?.contentHash
    const { book, changed } = normalizeAndHealBook(raw, {
      trusted: true,
      ...(typeof contentHash === 'string' ? { contentHash } : {})
    })
    if (book && changed) {
      // 静默瘦身写回：下次打开不再扛 19 万 block（fingerprint 会变，属预期）
      try {
        this.writeBookFile(book)
        const index = this.loadIndex()
        const idx = index.findIndex((e) => e.id === book.id)
        if (idx >= 0) {
          index[idx] = toIndexEntry(book)
          this.saveIndex(index)
        }
      } catch {
        /* 写回失败仍返回治愈后的内存副本 */
      }
    }
    return book
  }

  private writeBookFile(book: BookData): void {
    this.ensureDirs()
    const content = stripProgress(book)
    atomicWrite(this.bookPath(book.id), JSON.stringify(content))
  }

  /** 从分片布局加载完整书架 */
  loadFromLibrary(): BookData[] {
    const index = this.loadIndex()
    const progress = this.loadProgressMap()
    const books: BookData[] = []
    for (const entry of index) {
      const file = this.loadBookFile(entry.id)
      if (!file) continue
      // 索引里的封面/标题可能更新过
      const merged = applyProgress(
        {
          ...file,
          title: entry.title || file.title,
          author: entry.author ?? file.author,
          coverPath: entry.coverPath ?? file.coverPath,
          coverSource: entry.coverSource ?? file.coverSource,
          filePath: entry.filePath || file.filePath,
          format: entry.format || file.format,
          addedAt: entry.addedAt || file.addedAt
        },
        progress[entry.id]
      )
      // loadBookFile 已 heal；此处只合并索引字段，避免二次全量 isValidStructure
      const { book } = normalizeAndHealBook(merged, {
        trusted: true,
        contentHash: merged.structureMeta?.contentHash
      })
      if (book) books.push(book)
    }
    return books
  }

  /** 轻量书架：只读 index + progress，完全不碰单书文件（毫秒级） */
  loadShelf(): ShelfEntry[] {
    const index = this.loadIndex()
    const progress = this.loadProgressMap()
    return index.map((entry) => ({
      id: entry.id,
      title: entry.title,
      author: entry.author,
      coverPath: entry.coverPath,
      coverSource: entry.coverSource,
      format: entry.format,
      filePath: entry.filePath,
      sentenceCount: entry.sentenceCount,
      chapterCount: entry.chapterCount,
      addedAt: entry.addedAt,
      lastReadAt: progress[entry.id]?.lastReadAt ?? entry.addedAt,
      progressPercent: progress[entry.id]?.progressPercent ?? 0,
      isCompleted: progress[entry.id]?.isCompleted ?? false,
      currentSentenceIndex: progress[entry.id]?.currentSentenceIndex ?? 0,
      currentChapterIndex: progress[entry.id]?.currentChapterIndex ?? 0
    }))
  }

  /** 按需加载单本书的完整数据（句子/章节等） */
  loadSingleBook(bookId: string): BookData | null {
    const index = this.loadIndex()
    const progress = this.loadProgressMap()
    const entry = index.find((e) => e.id === bookId)
    const file = this.loadBookFile(bookId)
    if (!file) return null
    const merged = applyProgress(
      {
        ...file,
        title: entry?.title || file.title,
        author: entry?.author ?? file.author,
        coverPath: entry?.coverPath ?? file.coverPath,
        coverSource: entry?.coverSource ?? file.coverSource,
        filePath: entry?.filePath || file.filePath,
        format: entry?.format || file.format,
        addedAt: entry?.addedAt || file.addedAt
      },
      progress[bookId]
    )
    return (
      normalizeAndHealBook(merged, {
        trusted: true,
        contentHash: merged.structureMeta?.contentHash
      }).book
    )
  }

  /** 从旧版 books.json 迁移到分片布局 */
  migrateFromMonolith(books: BookData[]): BookData[] {
    const normalized = normalizeBookCollection(books)
    this.ensureDirs()
    const progress: ProgressMap = {}
    const index: LibraryIndexEntry[] = []
    for (const book of normalized) {
      this.writeBookFile(book)
      progress[book.id] = extractProgress(book)
      index.push(toIndexEntry(book))
    }
    this.saveIndex(index)
    this.saveProgressMap(progress)

    // 备份并替换 monolith：保留一份，主 books.json 写精简索引提示
    const legacy = this.legacyBooksPath()
    if (existsSync(legacy)) {
      try {
        const bak = join(this.getDataDir(), `books.json.monolith-backup-${Date.now()}`)
        copyFileSync(legacy, bak)
      } catch {
        /* ignore */
      }
    }
    // 写一个小的兼容桩，防止旧逻辑误以为书架为空却仍巨大
    atomicWrite(
      legacy,
      JSON.stringify({
        _migrated: true,
        layout: 'library',
        count: normalized.length,
        migratedAt: new Date().toISOString()
      })
    )
    return normalized
  }

  /**
   * 保存整库（merge 语义，不删除未列书籍）。
   * 进度永远写；单书文件仅在内容指纹变化时写。
   * Stub（sentences 为空）不覆盖磁盘上的已有单书文件；索引元信息沿用旧值。
   *
   * 注意：删除书籍请使用 deleteBook()，它也会从 index/progress 中移除。
   *
   * @param skipNormalize 跳过 normalizeBookCollection（调用方确保数据已规范化）
   */
  saveLibrary(books: BookData[], skipNormalize = false): { writtenBooks: number; skippedBooks: number } {
    const normalized = skipNormalize ? books : normalizeBookCollection(books)
    this.ensureDirs()

    const prevIndex = this.loadIndex()
    const prevFp = new Map(prevIndex.map((e) => [e.id, e.contentFingerprint]))

    const nextIndex: LibraryIndexEntry[] = []
    const progress: ProgressMap = {}
    let writtenBooks = 0
    let skippedBooks = 0

    for (const book of normalized) {
      progress[book.id] = extractProgress(book)
      let entry = toIndexEntry(book)
      const fileExists = existsSync(this.bookPath(book.id))

      // Stub 保护：sentences 为空的占位书，不覆盖磁盘上已有的完整内容文件
      const isStub = book.sentences.length === 0 && fileExists
      if (isStub) {
        const prev = prevIndex.find((e) => e.id === book.id)
        if (prev) {
          entry = {
            ...entry,
            sentenceCount: prev.sentenceCount,
            chapterCount: prev.chapterCount,
            contentFingerprint: prev.contentFingerprint
          }
        }
        skippedBooks++
      } else {
        if (prevFp.get(book.id) === entry.contentFingerprint && fileExists) {
          skippedBooks++
        } else {
          this.writeBookFile(book)
          writtenBooks++
        }
      }
      nextIndex.push(entry)
    }

    this.saveIndex(nextIndex)
    this.saveProgressMap(progress)
    return { writtenBooks, skippedBooks }
  }

  /** 显式删除一本书（index + book file + progress） */
  deleteBook(id: string): void {
    this.ensureDirs()
    const index = this.loadIndex().filter((e) => e.id !== id)
    this.saveIndex(index)
    const p = this.bookPath(id)
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
    const progress = this.loadProgressMap()
    delete progress[id]
    this.saveProgressMap(progress)
  }

  /** 尝试从 books.recovered-*.json / books.json.bak 抢救 */
  private tryLoadBackupMonolith(): BookData[] {
    const dir = this.getDataDir()
    let candidates: string[]
    try {
      candidates = readdirSync(dir)
        .filter(
          (f) =>
            (f.startsWith('books.recovered-') && f.endsWith('.json')) ||
            f === 'books.json.bak' ||
            f === 'books.json.bak.1' ||
            f === 'books.json.bak.2' ||
            f.startsWith('books.json.monolith-backup-')
        )
        .map((f) => join(dir, f))
        .filter((p) => {
          try {
            return statSync(p).size > 1000
          } catch {
            return false
          }
        })
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    } catch {
      return []
    }
    for (const file of candidates) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf-8'))
        const books = normalizeBookCollection(raw)
        if (books.length > 0) return books
      } catch {
        /* try next */
      }
    }
    return []
  }

  /**
   * 统一加载入口：优先 library；否则从 books.json 迁移；再否则从 recovered 备份抢救。
   */
  loadAll(): BookData[] {
    if (this.hasLibraryLayout()) {
      const fromLib = this.loadFromLibrary()
      if (fromLib.length > 0) return fromLib
      // index 在但书文件全丢：继续往下找备份
    }

    const legacyPath = this.legacyBooksPath()
    if (existsSync(legacyPath)) {
      // 可能是迁移桩
      try {
        const raw = JSON.parse(readFileSync(legacyPath, 'utf-8'))
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw._migrated) {
          // 桩存在但 index 丢了：尝试从 books 目录恢复
          if (existsSync(this.booksDir())) {
            const ids = readdirSync(this.booksDir())
              .filter((f) => f.endsWith('.json'))
              .map((f) => f.replace(/\.json$/i, ''))
            const rebuilt: BookData[] = []
            const progress = this.loadProgressMap()
            for (const id of ids) {
              const b = this.loadBookFile(id)
              if (!b) continue
              const n = normalizeBookData(applyProgress(b, progress[id]))
              if (n) rebuilt.push(n)
            }
            const books = normalizeBookCollection(rebuilt)
            if (books.length > 0) {
              this.saveIndex(books.map(toIndexEntry))
              return books
            }
          }
        } else {
          const books = normalizeBookCollection(raw)
          if (books.length > 0) {
            return this.migrateFromMonolith(books)
          }
        }
      } catch {
        /* fall through to backups */
      }
    }

    const backup = this.tryLoadBackupMonolith()
    if (backup.length > 0) {
      return this.migrateFromMonolith(backup)
    }
    return []
  }

  /** 空覆盖保护：现有库是否非空 */
  hasNonEmptyLibrary(): boolean {
    if (this.hasLibraryLayout()) {
      const index = this.loadIndex()
      if (index.length > 0) return true
    }
    const legacy = this.legacyBooksPath()
    if (existsSync(legacy)) {
      try {
        const st = statSync(legacy)
        if (st.size <= 10) return false
        const raw = readJson<unknown>(legacy, null)
        if (Array.isArray(raw) && raw.length > 0) return true
        if (raw && typeof raw === 'object' && (raw as { _migrated?: boolean })._migrated) {
          return this.loadIndex().length > 0 || (existsSync(this.booksDir()) && readdirSync(this.booksDir()).length > 0)
        }
      } catch {
        return false
      }
    }
    return false
  }
}
