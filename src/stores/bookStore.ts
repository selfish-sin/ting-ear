import { create } from 'zustand'
import type { BookData, Chapter } from '../global'
import {
  clampSentenceIndex,
  findChapterIndex,
  healBookLayoutForReading,
  normalizeBookCollection,
  normalizeBookData,
  normalizeBookTitle,
  normalizeChapters,
  normalizeSentenceRange,
  normalizeSentences
} from '../utils/bookData'

interface BookState {
  // All books in the library
  books: BookData[]
  // Currently active book (for player)
  currentBook: BookData | null
  // Sentences of current book (for player view)
  sentences: string[]
  chapters: Chapter[]
  // Active sentence range (null = full book)
  sentenceRange: { start: number; end: number } | null
  // null = persisted base text; non-null = transient original/edit-history version
  currentVersionId: string | null
  // 阅读器模式：ai-reading=结构化卡片, listening=传统句子列表
  readerMode: 'ai-reading' | 'listening'

  // UI state
  currentView: 'shelf' | 'player' | 'bookmarks' | 'history' | 'logs' | 'quicktext' | 'textclean'
  isLoading: boolean
  loadingMessage: string

  // Actions
  setBooks: (books: BookData[]) => void
  addBook: (book: BookData) => void
  updateBook: (book: BookData) => void
  updateBookAndPersist: (book: BookData) => Promise<boolean>
  updateBookProgress: (
    bookId: string,
    progress: Pick<
      BookData,
      'currentSentenceIndex' | 'currentChapterIndex' | 'progressPercent' | 'lastReadAt'
    >
  ) => void
  renameBook: (bookId: string, title: string) => Promise<boolean>
  renameChapter: (bookId: string, chapterIndex: number, title: string) => Promise<boolean>
  restoreChapterTitle: (bookId: string, chapterIndex: number) => Promise<boolean>
  removeBook: (bookId: string) => void
  setCurrentBook: (book: BookData | null) => void
  setSentences: (sentences: string[]) => void
  setChapters: (chapters: Chapter[]) => void
  setSentenceRange: (range: { start: number; end: number } | null) => void
  setCurrentVersionId: (versionId: string | null) => void
  setReaderMode: (mode: 'ai-reading' | 'listening') => void
  updateCurrentTimeMap: (timeMap: number[]) => void
  setCurrentView: (view: BookState['currentView']) => void
  setLoading: (loading: boolean, message?: string) => void
  /**
   * 打开阅读：一次 set 写入书/句/章/范围/视图，避免 activate 连打 6 次 set 触发多次重渲染。
   * 调用方应已 normalize + heal。
   */
  enterPlayerSession: (
    book: BookData,
    range: { start: number; end: number } | null,
    versionId: string | null
  ) => void
  loadBooks: () => Promise<void>
  /** 按需加载单本书完整数据并替换内存 stub */
  loadFullBook: (bookId: string) => Promise<BookData | null>
  persistBooks: () => Promise<boolean>
  /** 立即落盘（切书/退出前调用，避免防抖丢失进度） */
  flushPersist: () => Promise<boolean>
  // 全局范围边界：null 时返回全书 [0, length)
  getRangeBounds: () => { start: number; end: number }
}

// 进度/timeMap 高频更新：只写 progress.json 轻量字段，禁止把整本 sentences 过 IPC
const PERSIST_DEBOUNCE_MS = 8000
let _persistTimer: ReturnType<typeof setTimeout> | null = null
let _storeRef: {
  persistProgressOnly: () => Promise<boolean>
  mergeTimeMap: (bookId: string, timeMap: number[]) => void
} | null = null
let _persistInFlight: Promise<boolean> | null = null
/** 是否已完成至少一次 loadBooks；未 hydrate 前禁止任何写盘，防止空数组覆盖真书架 */
let booksHydrated = false

// timeMap 合并进 books[] 的待写入缓冲（flush 前必须落地）
let timeMapMergeTimer: ReturnType<typeof setTimeout> | null = null
const pendingTimeMapRef: { bookId: string | null; timeMap: number[] | null } = {
  bookId: null,
  timeMap: null
}

function applyPendingTimeMap() {
  if (timeMapMergeTimer) {
    clearTimeout(timeMapMergeTimer)
    timeMapMergeTimer = null
  }
  const { bookId, timeMap } = pendingTimeMapRef
  pendingTimeMapRef.bookId = null
  pendingTimeMapRef.timeMap = null
  if (!bookId || !timeMap || !_storeRef) return
  _storeRef.mergeTimeMap(bookId, timeMap)
}

function debouncedPersist() {
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    applyPendingTimeMap()
    if (_storeRef) void _storeRef.persistProgressOnly()
  }, PERSIST_DEBOUNCE_MS)
}

/** 取消防抖并立刻写盘；并发调用共享同一次 in-flight */
export async function flushBookPersist(): Promise<boolean> {
  if (!booksHydrated) return false
  if (_persistTimer) {
    clearTimeout(_persistTimer)
    _persistTimer = null
  }
  applyPendingTimeMap()
  if (!_storeRef) return false
  if (_persistInFlight) return _persistInFlight
  _persistInFlight = _storeRef.persistProgressOnly().finally(() => {
    _persistInFlight = null
  })
  return _persistInFlight
}

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBook: null,
  sentences: [],
  chapters: [],
  sentenceRange: null,
  currentVersionId: null,
  readerMode: 'ai-reading',
  currentView: 'shelf',
  isLoading: false,
  loadingMessage: '',

  setBooks: (books) => set({ books: normalizeBookCollection(books) }),

  addBook: (book) => {
    // 导入返回的书已被主进程 normalizeBookData 规范化过，跳过重复规范化
    set((s) => ({ books: [...s.books.filter((item) => item.id !== book.id), book] }))
    void get().persistBooks()
  },

  updateBook: (book) => {
    const normalized = normalizeBookData(book)
    if (!normalized) return
    set((s) => ({
      books: s.books.map((b) => (b.id === normalized.id ? normalized : b)),
      currentBook: s.currentBook?.id === normalized.id ? normalized : s.currentBook
    }))
    void get().persistBooks()
  },

  updateBookAndPersist: async (book) => {
    const normalized = normalizeBookData(book)
    if (!normalized) return false
    const previousBooks = get().books
    const previousCurrentBook = get().currentBook
    set((state) => ({
      books: state.books.map((item) => (item.id === normalized.id ? normalized : item)),
      currentBook: state.currentBook?.id === normalized.id ? normalized : state.currentBook
    }))
    if (await get().persistBooks()) return true
    set({ books: previousBooks, currentBook: previousCurrentBook })
    return false
  },

  updateBookProgress: (bookId, progress) => {
    // 编辑记录版本（非 null、非「原始」）：句数/索引与主书 books.json 可能完全不同，
    // 只更新当前会话焦点，避免把清洗版进度写坏主书。
    // null / '__original__' 仍写回主书（主流程打开书时常用 '__original__'）。
    const versionId = get().currentVersionId
    if (versionId && versionId !== '__original__') {
      // 仅内存会话态；不写盘、不碰 books[]，避免阅读中整树重渲染
      set((state) => ({
        currentBook:
          state.currentBook?.id === bookId
            ? { ...state.currentBook, ...progress }
            : state.currentBook
      }))
      return
    }
    set((state) => {
      let changed = false
      const books = state.books.map((book) => {
        if (book.id !== bookId) return book
        // 读原始版本时，用当前展示句数与主本取较小侧 clamp，防止越界
        const lengthForClamp =
          versionId === '__original__' && state.currentBook?.id === bookId
            ? Math.min(book.sentences.length, state.currentBook.sentences.length || book.sentences.length)
            : book.sentences.length
        const currentSentenceIndex = clampSentenceIndex(
          progress.currentSentenceIndex,
          lengthForClamp
        )
        const currentChapterIndex = findChapterIndex(book.chapters, currentSentenceIndex)
        const progressPercent = Math.max(0, Math.min(progress.progressPercent, 100))
        // 字段未变则保持同一引用，避免 App/书架无意义重渲染
        if (
          book.currentSentenceIndex === currentSentenceIndex &&
          book.currentChapterIndex === currentChapterIndex &&
          book.progressPercent === progressPercent &&
          book.lastReadAt === progress.lastReadAt
        ) {
          return book
        }
        changed = true
        return {
          ...book,
          ...progress,
          currentSentenceIndex,
          currentChapterIndex,
          progressPercent
        }
      })
      // 播放中进度以 playerStore 为准；不刷新 currentBook 引用，避免正文树每句重挂
      if (!changed) return state
      return { books }
    })
    debouncedPersist()
  },

  renameBook: async (bookId, value) => {
    const title = normalizeBookTitle(value)
    if (!title) return false
    const previous = get().books.find((book) => book.id === bookId)
    if (!previous) return false
    const renamed = { ...previous, title }
    set((state) => ({
      books: state.books.map((book) => (book.id === bookId ? renamed : book)),
      currentBook:
        state.currentBook?.id === bookId ? { ...state.currentBook, title } : state.currentBook
    }))
    if (await get().persistBooks()) return true
    set((state) => ({
      books: state.books.map((book) => (book.id === bookId ? previous : book)),
      currentBook:
        state.currentBook?.id === bookId
          ? { ...state.currentBook, title: previous.title }
          : state.currentBook
    }))
    return false
  },

  renameChapter: async (bookId, chapterIndex, value) => {
    const title = normalizeBookTitle(value)
    const previous = get().books.find((book) => book.id === bookId)
    const chapter = previous?.chapters[chapterIndex]
    if (!title || !previous || !chapter) return false
    const originalTitle = chapter.originalTitle || chapter.title
    const chapters = previous.chapters.map((item, index) =>
      index === chapterIndex ? { ...item, title, originalTitle, customTitle: title === originalTitle ? undefined : title } : item
    )
    const structure = previous.structure?.map((item, index) =>
      index === chapterIndex ? { ...item, title } : item
    )
    return get().updateBookAndPersist({ ...previous, chapters, structure })
  },

  restoreChapterTitle: async (bookId, chapterIndex) => {
    const previous = get().books.find((book) => book.id === bookId)
    const chapter = previous?.chapters[chapterIndex]
    if (!previous || !chapter) return false
    const title = chapter.originalTitle || chapter.title
    const chapters = previous.chapters.map((item, index) =>
      index === chapterIndex ? { ...item, title, originalTitle: title, customTitle: undefined } : item
    )
    const structure = previous.structure?.map((item, index) =>
      index === chapterIndex ? { ...item, title } : item
    )
    return get().updateBookAndPersist({ ...previous, chapters, structure })
  },

  removeBook: (bookId) => {
    set((s) => ({
      books: s.books.filter((b) => b.id !== bookId),
      currentBook: s.currentBook?.id === bookId ? null : s.currentBook,
      sentences: s.currentBook?.id === bookId ? [] : s.sentences,
      chapters: s.currentBook?.id === bookId ? [] : s.chapters,
      sentenceRange: s.currentBook?.id === bookId ? null : s.sentenceRange,
      currentVersionId: s.currentBook?.id === bookId ? null : s.currentVersionId
    }))
    void window.api?.deleteBook(bookId)
    void get().persistBooks()
  },

  setCurrentBook: (book) => {
    // 调用方（activateReadingBook / loadFullBook）已 normalize；此处禁止二次全量规范化
    // （大书 hash + structure 校验可达数百 ms，是打开书卡顿主因之一）
    set({
      currentBook: book,
      sentences: book?.sentences || [],
      chapters: book?.chapters || [],
      // 重置范围：跨书泄漏是最隐蔽的 bug 来源
      sentenceRange: null,
      currentVersionId: null,
      readerMode: 'ai-reading'
    })
  },

  enterPlayerSession: (book, range, versionId) => {
    const sentences = book.sentences || []
    set({
      currentBook: book,
      sentences,
      chapters: book.chapters || [],
      sentenceRange: normalizeSentenceRange(range, sentences.length),
      currentVersionId: versionId,
      readerMode: 'ai-reading',
      currentView: 'player'
    })
  },

  setSentences: (sentences) => set({ sentences: normalizeSentences(sentences) }),
  setChapters: (chapters) =>
    set((state) => ({ chapters: normalizeChapters(chapters, state.sentences.length) })),
  setCurrentVersionId: (currentVersionId) => set({ currentVersionId }),
  setReaderMode: (readerMode) => set({ readerMode }),
  updateCurrentTimeMap: (timeMap) => {
    // 播放中 live timeMap 在 playerStore；这里合并进 books[] 仅供落盘。
    // 内存更新也走防抖：避免每句 map 整库 books 触发订阅方重渲染。
    if (get().currentVersionId !== null) return
    const currentId = get().currentBook?.id
    if (!currentId) return
    pendingTimeMapRef.bookId = currentId
    pendingTimeMapRef.timeMap = timeMap
    if (timeMapMergeTimer) clearTimeout(timeMapMergeTimer)
    timeMapMergeTimer = setTimeout(() => {
      timeMapMergeTimer = null
      const { bookId, timeMap: pending } = pendingTimeMapRef
      pendingTimeMapRef.bookId = null
      pendingTimeMapRef.timeMap = null
      if (!bookId || !pending) return
      set((state) => ({
        books: state.books.map((book) =>
          book.id === bookId ? { ...book, timeMap: pending } : book
        )
      }))
      debouncedPersist()
    }, 2000)
  },

  // 虚拟范围：不再物理切片 sentences/chapters。
  // sentences/chapters 始终是 currentBook 的全局副本；
  // sentenceRange 只是 {start,end} 窗口元数据，所有索引（currentSentenceIndex/timeMap/chapters.startIndex）
  // 统一为全局索引，UI 渲染时按窗口 slice 显示。
  setSentenceRange: (range) => {
    const { currentBook: book, sentences } = get()
    if (!book || !range) {
      set({
        sentenceRange: null,
        // 对称恢复：解除范围时，sentences/chapters 回归当前书全集
        sentences: book ? book.sentences : [],
        chapters: book ? book.chapters : []
      })
      return
    }
    // 仅做合法性 clamp，不切片
    set({ sentenceRange: normalizeSentenceRange(range, sentences.length) })
  },

  setCurrentView: (currentView) => set({ currentView }),
  setLoading: (isLoading, loadingMessage = '') => set({ isLoading, loadingMessage }),

  loadBooks: async () => {
    try {
      // 轻量加载：只读 index+progress，跳过单书 JSON（启动加速）
      const shelf = await window.api?.loadShelf()
      if (shelf && Array.isArray(shelf)) {
        const now = new Date().toISOString()
        const stubBooks: BookData[] = shelf.map((sb) => ({
          id: sb.id,
          title: sb.title,
          author: sb.author,
          coverPath: sb.coverPath ?? undefined,
          coverSource: sb.coverSource ?? undefined,
          filePath: sb.filePath,
          format: sb.format,
          sentences: [], // stub: 按需加载
          chapters: [],
          currentChapterIndex: sb.currentChapterIndex ?? 0,
          currentSentenceIndex: sb.currentSentenceIndex ?? 0,
          progressPercent: sb.progressPercent ?? 0,
          isCompleted: sb.isCompleted ?? false,
          addedAt: sb.addedAt || now,
          lastReadAt: sb.lastReadAt || sb.addedAt || now,
          originalSentences: [],
          editHistory: [],
          bookmarks: [],
          timeMap: []
        }))
        set({ books: stubBooks })
      }
    } catch {
      // ignore
    } finally {
      booksHydrated = true
    }
  },

  loadFullBook: async (bookId) => {
    try {
      const data = await window.api?.loadBookData(bookId)
      if (!data) return null
      // 主进程 loadSingleBook 已 heal；渲染侧再 trusted+heal 兜底（防旧主进程/热更新）
      const contentHash =
        data &&
        typeof data === 'object' &&
        data !== null &&
        'structureMeta' in data &&
        (data as { structureMeta?: { contentHash?: string } }).structureMeta?.contentHash
      const normalized = normalizeBookData(data, {
        trusted: true,
        ...(typeof contentHash === 'string' ? { contentHash } : {})
      })
      if (!normalized) return null
      const { book } = healBookLayoutForReading(normalized)
      // 替换内存中的 stub（必须用治愈后的，禁止把 19 万 block 塞进 books[]）
      set((s) => ({
        books: s.books.map((b) => (b.id === bookId ? book : b)),
        currentBook: s.currentBook?.id === bookId ? book : s.currentBook
      }))
      return book
    } catch {
      return null
    }
  },

  persistBooks: async () => {
    // 未加载完成前绝不写盘（曾导致 dev/HMR 用空数组覆盖 60MB 书架）
    if (!booksHydrated) return false
    try {
      // 内容变更路径：发送全部书籍（含 stub）；后端 saveLibrary 跳过空内容书
      const result = await window.api?.saveProgress(get().books)
      return result?.success === true
    } catch {
      return false
    }
  },

  flushPersist: () => flushBookPersist(),

  // 返回当前有效播放窗口的全局索引边界。
  // 无书 / 未设范围 → {0, sentences.length}；有范围 → clamp 后的 {start, end}。
  getRangeBounds: () => {
    const { currentBook, sentences, sentenceRange } = get()
    if (!currentBook) return { start: 0, end: 0 }
    return (
      normalizeSentenceRange(sentenceRange, sentences.length) ?? {
        start: 0,
        end: sentences.length
      }
    )
  }
}))

// 绑定 store 引用供 debouncedPersist / timeMap 合并使用
_storeRef = {
  /** 高频进度：只传 id + 进度字段，绝不带 sentences */
  persistProgressOnly: async () => {
    if (!booksHydrated) return false
    try {
      const books = useBookStore.getState().books
      if (books.length === 0) return false
      const payload = books.map((b) => ({
        id: b.id,
        currentSentenceIndex: b.currentSentenceIndex,
        currentChapterIndex: b.currentChapterIndex,
        progressPercent: b.progressPercent,
        lastReadAt: b.lastReadAt,
        isCompleted: b.isCompleted,
        timeMap: b.timeMap
      }))
      const result = await window.api?.saveProgressOnly?.(payload)
      // 旧版 preload 无 saveProgressOnly 时回退（不应走整库，尽量只写有内容的书会很重）
      if (!result && window.api?.saveProgress) {
        // 回退仍用 saveProgress，但只在 API 缺失时
        const full = await window.api.saveProgress(books)
        return full?.success === true
      }
      return result?.success === true
    } catch {
      return false
    }
  },
  mergeTimeMap: (bookId, timeMap) => {
    useBookStore.setState((state) => ({
      books: state.books.map((book) => (book.id === bookId ? { ...book, timeMap } : book))
    }))
  }
}
