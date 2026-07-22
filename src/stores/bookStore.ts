import { create } from 'zustand'
import type { BookData, Chapter } from '../global'
import {
  clampSentenceIndex,
  findChapterIndex,
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
  removeBook: (bookId: string) => void
  setCurrentBook: (book: BookData | null) => void
  setSentences: (sentences: string[]) => void
  setChapters: (chapters: Chapter[]) => void
  setSentenceRange: (range: { start: number; end: number } | null) => void
  setCurrentVersionId: (versionId: string | null) => void
  updateCurrentTimeMap: (timeMap: number[]) => void
  setCurrentView: (view: BookState['currentView']) => void
  setLoading: (loading: boolean, message?: string) => void
  loadBooks: () => Promise<void>
  persistBooks: () => Promise<boolean>
  // 全局范围边界：null 时返回全书 [0, length)
  getRangeBounds: () => { start: number; end: number }
}

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBook: null,
  sentences: [],
  chapters: [],
  sentenceRange: null,
  currentVersionId: null,
  currentView: 'shelf',
  isLoading: false,
  loadingMessage: '',

  setBooks: (books) => set({ books: normalizeBookCollection(books) }),

  addBook: (book) => {
    const normalized = normalizeBookData(book)
    if (!normalized) return
    set((s) => ({ books: [...s.books.filter((item) => item.id !== normalized.id), normalized] }))
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
    set((state) => ({
      books: state.books.map((book) => {
        if (book.id !== bookId) return book
        const currentSentenceIndex = clampSentenceIndex(
          progress.currentSentenceIndex,
          book.sentences.length
        )
        return {
          ...book,
          ...progress,
          currentSentenceIndex,
          currentChapterIndex: findChapterIndex(book.chapters, currentSentenceIndex),
          progressPercent: Math.max(0, Math.min(progress.progressPercent, 100))
        }
      }),
      currentBook:
        state.currentBook?.id === bookId ? { ...state.currentBook, ...progress } : state.currentBook
    }))
    void get().persistBooks()
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

  removeBook: (bookId) => {
    set((s) => ({
      books: s.books.filter((b) => b.id !== bookId),
      currentBook: s.currentBook?.id === bookId ? null : s.currentBook,
      sentences: s.currentBook?.id === bookId ? [] : s.sentences,
      chapters: s.currentBook?.id === bookId ? [] : s.chapters,
      sentenceRange: s.currentBook?.id === bookId ? null : s.sentenceRange,
      currentVersionId: s.currentBook?.id === bookId ? null : s.currentVersionId
    }))
    void get().persistBooks()
  },

  setCurrentBook: (book) => {
    const normalized = book ? normalizeBookData(book) : null
    set({
      currentBook: normalized,
      sentences: normalized?.sentences || [],
      chapters: normalized?.chapters || [],
      // 重置范围：跨书泄漏是最隐蔽的 bug 来源
      sentenceRange: null,
      currentVersionId: null
    })
  },

  setSentences: (sentences) => set({ sentences: normalizeSentences(sentences) }),
  setChapters: (chapters) =>
    set((state) => ({ chapters: normalizeChapters(chapters, state.sentences.length) })),
  setCurrentVersionId: (currentVersionId) => set({ currentVersionId }),
  updateCurrentTimeMap: (timeMap) => {
    set((state) => ({
      currentBook: state.currentBook ? { ...state.currentBook, timeMap } : null,
      books:
        state.currentVersionId === null && state.currentBook
          ? state.books.map((book) =>
              book.id === state.currentBook?.id ? { ...book, timeMap } : book
            )
          : state.books
    }))
    if (get().currentVersionId === null) void get().persistBooks()
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
      const books = await window.api?.loadProgress()
      if (books) {
        set({ books: normalizeBookCollection(books) })
      }
    } catch {
      // ignore
    }
  },

  persistBooks: async () => {
    try {
      const result = await window.api?.saveProgress(get().books)
      return result?.success === true
    } catch {
      return false
    }
  },

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
