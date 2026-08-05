import { useRef, useEffect, useCallback, useState, useMemo, memo, type ReactNode } from 'react'
import {
  BookOpen,
  ChevronDown,
  Bookmark as BookmarkIcon,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  ListChecks,
  Copy,
  ArrowDown,
  Search,
  X,
  Camera,
  Captions
} from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useBookmarkStore } from '../stores/bookmarkStore'
import { useSettingsStore } from '../stores/settingsStore'
import { clampSentenceIndex, findChapterIndex } from '../utils/bookData'
import { isSentenceTtsSkipped } from '../utils/ttsSkip'
import { useSafeTimeout } from '../hooks/useSafeTimeout'
import type { BookData, Chapter } from '../global'
import SelectionPopup from './ai/SelectionPopup'
import ReaderHeader from './reader/ReaderHeader'

/** 单句行 —— memo 化，仅 props 变化时重渲染 */
export const SentenceRow = memo(function SentenceRow({
  sentence,
  index,
  isActive,
  isPast,
  isPlaying,
  isTtsSkipped,
  bookmarked,
  bookmarkAdding,
  bookmarkInput,
  fontSize,
  onSentenceClick,
  onCopy,
  onBookmarkToggle,
  onBookmarkAdd,
  onBookmarkSubmit,
  onBookmarkCancel,
  onBookmarkInputChange,
  activeRowRef
}: {
  sentence: string
  index: number
  isActive: boolean
  /** 已走过的句子（当前句之前），用主题色标出 */
  isPast: boolean
  isPlaying: boolean
  isTtsSkipped: boolean
  bookmarked: boolean
  bookmarkAdding: boolean
  bookmarkInput: string
  fontSize: number
  onSentenceClick: (index: number) => void
  onCopy: (index: number, e: React.MouseEvent) => void
  onBookmarkToggle: (index: number) => void
  onBookmarkAdd: (index: number) => void
  onBookmarkSubmit: (index: number) => void
  onBookmarkCancel: () => void
  onBookmarkInputChange: (value: string) => void
  activeRowRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={isActive ? activeRowRef : undefined}
      data-active={isActive || undefined}
      data-past={isPast || undefined}
      data-tts-skip={isTtsSkipped || undefined}
      data-sentence-idx={index}
      className={`group flex items-start gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer transition-all duration-200 ${isTtsSkipped ? 'opacity-50' : ''} ${
        isActive
          ? `bg-primary/10 dark:bg-primary/15 border-l-[3px] border-primary shadow-soft ${isPlaying ? 'sentence-active' : ''}`
          : isPast
            ? 'border-l-[3px] border-primary/25 hover:bg-primary/[0.06]'
            : 'border-l-[3px] border-transparent hover:bg-gray-50/90 dark:hover:bg-white/[0.04]'
      }`}
      onClick={() => onSentenceClick(index)}
      style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
    >
      <span
        className={`flex-shrink-0 w-8 text-right text-[11px] mt-1 select-none tabular-nums ${
          isActive
            ? 'text-primary font-bold'
            : isPast
              ? 'text-primary/70 font-medium'
              : 'text-gray-300 dark:text-gray-600'
        }`}
      >
        {index + 1}
      </span>
      <span
        className={`flex-1 select-text ${
          isActive
            ? 'text-primary font-semibold'
            : isTtsSkipped
              ? 'text-gray-400 dark:text-gray-500'
              : isPast
                ? 'text-primary/80'
                : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        {sentence}
      </span>
      <div className="flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={(e) => onCopy(index, e)}
          className="p-1 rounded text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-primary transition-all"
          title="复制此句"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        {bookmarkAdding ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              autoFocus
              placeholder="备注（可选）"
              value={bookmarkInput}
              onChange={(e) => onBookmarkInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onBookmarkSubmit(index)
                if (e.key === 'Escape') onBookmarkCancel()
              }}
              className="w-32 text-xs px-2 py-1 border rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            />
            <button
              onClick={() => onBookmarkSubmit(index)}
              className="text-xs text-primary hover:underline"
            >
              确定
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (bookmarked) onBookmarkToggle(index)
              else onBookmarkAdd(index)
            }}
            className={`p-1 rounded transition-all ${
              bookmarked
                ? 'text-primary opacity-100'
                : 'text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-primary'
            }`}
            title={bookmarked ? '点击取消书签' : '添加书签'}
          >
            <BookmarkIcon className="w-3.5 h-3.5" fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    </div>
  )
})

interface PlayerViewProps {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  onSeekToChapter?: (sentenceIndex: number) => void
  onSelectVersion?: (recordId?: string) => void
  onReloadBook?: (book: BookData) => void
  /** 重新打开预选页，修改章节范围 / 版本。initialPage: 0=版本选择, 1=章节选择 */
  onReselectRange?: (initialPage?: 0 | 1) => void
  onToggleSubtitle?: () => void
  subtitleEnabled?: boolean
  /** 沉浸模式：隐藏顶/底栏；进出开关在 App 层 fixed 悬浮，不在此渲染 */
  immersive?: boolean
}

export default function PlayerView({
  showToast,
  onSeekToChapter,
  onSelectVersion,
  onReloadBook,
  onReselectRange,
  onToggleSubtitle,
  subtitleEnabled,
  immersive = false
}: PlayerViewProps) {
  // selector 订阅：避免 timeMap/volume 等无关字段拖着整页重渲染
  const sentences = useBookStore((s) => s.sentences)
  const currentBook = useBookStore((s) => s.currentBook)
  const sentenceRange = useBookStore((s) => s.sentenceRange)
  const loadBooks = useBookStore((s) => s.loadBooks)
  const getRangeBounds = useBookStore((s) => s.getRangeBounds)
  const currentSentenceIndex = usePlayerStore((s) => s.currentSentenceIndex)
  const playState = usePlayerStore((s) => s.playState)
  const currentChapterIndex = usePlayerStore((s) => s.currentChapterIndex)
  const setCurrentChapterIndex = usePlayerStore((s) => s.setCurrentChapterIndex)
  const pageIndex = usePlayerStore((s) => s.pageIndex)
  const setPageIndex = usePlayerStore((s) => s.setPageIndex)
  const pageSize = usePlayerStore((s) => s.pageSize)
  const voiceId = usePlayerStore((s) => s.voiceId)
  const speed = usePlayerStore((s) => s.speed)
  const fontSize = useSettingsStore((s) => s.settings.fontSize.body)
  const titleFontSize = useSettingsStore((s) => s.settings.fontSize.title)
  const addBookmark = useBookmarkStore((s) => s.addBookmark)
  const toggleBookmark = useBookmarkStore((s) => s.toggleBookmark)
  const bookmarks = useBookmarkStore((s) => s.bookmarks)

  const containerRef = useRef<HTMLDivElement>(null)
  // active 句子行的 DOM 引用（由 SentenceRow ref 回调设置），替代 querySelector
  const activeRowRef = useRef<HTMLDivElement | null>(null)
  // 卸载安全的 setTimeout：组件卸载后跳过回调，避免对已卸载组件 setState
  const safeTimeout = useSafeTimeout()
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false)
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false)
  const [bookmarkAdding, setBookmarkAdding] = useState<number | null>(null)
  const [bookmarkInput, setBookmarkInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // === 自动滚动开关 ===
  const [autoScroll, setAutoScroll] = useState(true)
  // === Audio export ===
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  // === 搜索功能 ===
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // 防抖后的查询词：只有它才驱动全文扫描，避免每敲一字就扫数十万句
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState<number[]>([])
  const [searchCurrent, setSearchCurrent] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 搜索前的位置，用于「返回」
  const searchOriginRef = useRef<number | null>(null)

  // 真正的原文（导入时固定保存，清洗/版本切换不覆盖），供「原始版本」回看
  const originalSentences = currentBook?.originalSentences ?? sentences

  // 进入沉浸时关掉搜索/下拉，避免看不见的浮层
  useEffect(() => {
    if (!immersive) return
    setSearchOpen(false)
    setSearchQuery('')
    setChapterDropdownOpen(false)
    setVersionDropdownOpen(false)
  }, [immersive])

  // 是否有真正的章节（>1 个才算，单章"正文"不算）
  const hasChapters = (currentBook?.chapters?.length || 0) > 1
  // 无章节时的总页数
  const totalPages = currentBook && !hasChapters ? Math.ceil(sentences.length / pageSize) : 0

  const readingBounds = getRangeBounds()

  // 可视窗口（全局索引范围）
  const bounds = useMemo<{ start: number; end: number }>(() => {
    if (!currentBook) return { start: 0, end: 0 }
    const total = sentences.length
    if (hasChapters) {
      const ch = currentBook.chapters[currentChapterIndex]
      if (ch)
        return { start: ch.startIndex, end: Math.min(ch.startIndex + ch.sentenceCount, total) }
    }
    if (sentenceRange) {
      return { start: sentenceRange.start, end: Math.min(sentenceRange.end, total) }
    }
    const start = pageIndex * pageSize
    const end = Math.min(start + pageSize, total)
    return { start, end }
  }, [currentBook, sentences.length, hasChapters, currentChapterIndex, sentenceRange, pageIndex, pageSize])

  // Auto-scroll to active sentence — 用 ref 替代 querySelector，避免每句 DOM 查询
  const setActiveRow = useCallback((el: HTMLDivElement | null) => {
    activeRowRef.current = el
  }, [])
  useEffect(() => {
    if (autoScroll && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
    }
  }, [currentSentenceIndex, autoScroll])

  // === 搜索：Ctrl+F 打开 ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchOriginRef.current = usePlayerStore.getState().currentSentenceIndex
        setSearchOpen(true)
        safeTimeout(() => searchInputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [safeTimeout])

  // === 搜索：输入防抖（250ms 内连续敲字不触发扫描） ===
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // === 搜索：计算匹配（只对防抖后的查询词全文扫描） ===
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchMatches([])
      setSearchCurrent(0)
      return
    }
    const q = debouncedQuery.trim().toLowerCase()
    const matches: number[] = []
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].toLowerCase().includes(q)) matches.push(i)
    }
    setSearchMatches(matches)
    setSearchCurrent(0)
  }, [debouncedQuery, sentences])

  // === 搜索：跳转到指定匹配 ===
  const goToMatch = useCallback(
    (matchIdx: number) => {
      if (searchMatches.length === 0) return
      const clamped = ((matchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length
      setSearchCurrent(clamped)
      const sentenceIdx = searchMatches[clamped]
      // 如果在分页模式，切换到对应页
      if (!hasChapters) {
        setPageIndex(Math.floor(sentenceIdx / pageSize))
      } else if (currentBook) {
        const chIdx = findChapterIndex(currentBook.chapters, sentenceIdx)
        setCurrentChapterIndex(chIdx)
      }
      // 滚动到目标句子
      safeTimeout(() => {
        const el = containerRef.current?.querySelector(`[data-sentence-idx="${sentenceIdx}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    },
    [searchMatches, hasChapters, pageSize, currentBook, setPageIndex, setCurrentChapterIndex, safeTimeout]
  )

  // === 搜索：返回搜索前位置 ===
  const handleSearchReturn = useCallback(() => {
    const origin = searchOriginRef.current
    if (origin == null) return
    if (!hasChapters) {
      setPageIndex(Math.floor(origin / pageSize))
    } else if (currentBook) {
      const chIdx = findChapterIndex(currentBook.chapters, origin)
      setCurrentChapterIndex(chIdx)
    }
    safeTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-sentence-idx="${origin}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    setSearchOpen(false)
    setSearchQuery('')
    searchOriginRef.current = null
  }, [hasChapters, pageSize, currentBook, setPageIndex, setCurrentChapterIndex, safeTimeout])

  // 刷新当前书籍（预处理后文本更新时使用）
  const handleRefresh = useCallback(async () => {
    if (!currentBook) return
    await loadBooks()
    const updated = useBookStore.getState().books.find((b) => b.id === currentBook.id)
    if (updated) {
      onReloadBook?.(updated)
      showToast('success', `已刷新（${updated.sentences.length}句）`)
    }
  }, [currentBook, loadBooks, onReloadBook, showToast])

  const currentChapter: Chapter | null = useMemo(() => {
    if (!currentBook || !currentBook.chapters.length) return null
    for (const ch of currentBook.chapters) {
      if (
        currentSentenceIndex >= ch.startIndex &&
        currentSentenceIndex < ch.startIndex + ch.sentenceCount
      ) {
        return ch
      }
    }
    return null
  }, [currentBook, currentSentenceIndex])

  // === Audio export ===
  const handleExportAudio = useCallback(async () => {
    if (!currentBook || exporting) return
    const start = bounds.start
    const end = bounds.end
    const totalSentences = end - start
    if (totalSentences <= 0) {
      showToast('warning', '导出范围为空')
      return
    }
    setExporting(true)
    setExportProgress({ current: 0, total: totalSentences })

    const rangeName = hasChapters ? currentChapter?.title || '章节' : '全文'

    const player = usePlayerStore.getState()
    const engineId =
      player.useSystemTTS || player.ttsEngine === 'system'
        ? 'edge'
        : player.ttsEngine || useSettingsStore.getState().settings.ttsEngine || 'edge'

    const result = await window.api?.exportAudio({
      sentences: currentBook.sentences,
      voiceId,
      speed,
      startIndex: start,
      endIndex: end,
      defaultName: `${currentBook.title}-${rangeName}`,
      engineId
    })

    setExporting(false)
    setExportProgress(null)
    if (result?.success) {
      showToast('success', '音频导出完成')
    } else if (result?.error !== '取消导出') {
      showToast('error', result?.error || '导出失败')
    }
  }, [
    currentBook,
    bounds.start,
    bounds.end,
    hasChapters,
    currentChapter,
    voiceId,
    speed,
    exporting,
    showToast
  ])

  // Listen to export progress
  useEffect(() => {
    if (!exporting) return
    window.api?.onExportProgress((data) => {
      setExportProgress(data)
    })
    window.api?.onExportComplete(() => {
      setExporting(false)
      setExportProgress(null)
      showToast('success', '音频导出完成')
    })
    window.api?.onExportError((data) => {
      setExporting(false)
      setExportProgress(null)
      showToast('error', data.message)
    })
  }, [exporting, showToast])

  // 句子变化时同步章节索引到 playerStore（让 ProgressBar/ControlBar 也能取到）
  useEffect(() => {
    if (!currentBook || !currentChapter) return
    const chIdx = currentBook.chapters.indexOf(currentChapter)
    if (chIdx >= 0 && usePlayerStore.getState().currentChapterIndex !== chIdx) {
      setCurrentChapterIndex(chIdx)
    }
  }, [currentSentenceIndex, currentBook, currentChapter, setCurrentChapterIndex])

  // index 必须是【全局】索引（来自窗口内 range.start + i）
  // 点击跳转播放；如果用户正在选中文本则不跳转
  const handleSentenceClick = useCallback(
    (index: number) => {
      // 如果用户刚完成文本选择，不触发跳转
      const sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0) return
      setIsLoading(true)
      if (onSeekToChapter) {
        onSeekToChapter(index)
      }
      safeTimeout(() => setIsLoading(false), 500)
    },
    [onSeekToChapter, safeTimeout]
  )

  // 复制单句
  const handleCopySentence = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation()
      const text = sentences[index] || ''
      navigator.clipboard.writeText(text).then(() => {
        showToast('success', '已复制')
      })
    },
    [sentences, showToast]
  )

  // 书签索引集合（O(1) 查找）
  const bookmarkedSet = useMemo(() => {
    if (!currentBook) return new Set<number>()
    return new Set(
      bookmarks.filter((b) => b.bookId === currentBook.id).map((b) => b.sentenceIndex)
    )
  }, [bookmarks, currentBook])

  // Add bookmark for a sentence
  const handleAddBookmark = useCallback(
    async (index: number) => {
      if (!currentBook || !currentChapter) return
      setBookmarkAdding(index)
      setBookmarkInput('')
    },
    [currentBook, currentChapter]
  )

  // Toggle bookmark (remove existing)
  const handleBookmarkToggle = useCallback(
    async (index: number) => {
      if (!currentBook || !currentChapter) return
      const result = await toggleBookmark({
        bookId: currentBook.id,
        bookTitle: currentBook.title,
        sentenceIndex: index,
        chapterIndex: currentBook.chapters.indexOf(currentChapter),
        content: sentences[index]?.slice(0, 60) || '',
        note: ''
      })
      if (result === 'removed') showToast('info', '书签已取消')
      else if (result === 'failed') showToast('error', '取消书签失败')
    },
    [currentBook, currentChapter, sentences, toggleBookmark, showToast]
  )

  const handleBookmarkCancel = useCallback(() => {
    setBookmarkAdding(null)
    setBookmarkInput('')
  }, [])

  const handleBookmarkInputChange = useCallback((value: string) => {
    setBookmarkInput(value)
  }, [])

  const submitBookmark = useCallback(
    async (index: number) => {
      if (!currentBook || !currentChapter) return
      const sentenceText = sentences[index]?.slice(0, 60) || ''
      try {
        const result = await addBookmark({
          bookId: currentBook.id,
          bookTitle: currentBook.title,
          sentenceIndex: index,
          chapterIndex: currentBook.chapters.indexOf(currentChapter),
          content: sentenceText,
          note: bookmarkInput.trim()
        })
        if (result) {
          showToast('success', '书签已添加')
        } else {
          showToast('warning', '该句已有书签')
        }
      } catch {
        showToast('error', '添加书签失败')
      }
      setBookmarkAdding(null)
      setBookmarkInput('')
    },
    [currentBook, currentChapter, sentences, addBookmark, bookmarkInput, showToast]
  )

  // 无章节时：播完本页最后一句 → 自动翻页
  useEffect(() => {
    if (
      !hasChapters &&
      playState === 'idle' &&
      currentSentenceIndex === bounds.end - 1 &&
      pageIndex < Math.floor((readingBounds.end - 1) / pageSize)
    ) {
      const timer = setTimeout(() => setPageIndex(pageIndex + 1), 500)
      return () => clearTimeout(timer)
    }
  }, [
    hasChapters,
    playState,
    currentSentenceIndex,
    bounds.end,
    pageIndex,
    pageSize,
    readingBounds.end,
    totalPages,
    setPageIndex
  ])

  const minPage = Math.floor(readingBounds.start / pageSize)
  const maxPage = Math.max(minPage, Math.floor((readingBounds.end - 1) / pageSize))
  const canPrevPage = pageIndex > minPage
  const canNextPage = pageIndex < maxPage

  const goToPage = useCallback(
    (delta: number) => {
      if (!hasChapters && totalPages > 0) {
        setPageIndex(Math.max(minPage, Math.min(maxPage, pageIndex + delta)))
      }
    },
    [hasChapters, maxPage, minPage, pageIndex, totalPages, setPageIndex]
  )

  // 选择章节
  const handleChapterSelect = useCallback(
    (chapter: Chapter) => {
      if (!currentBook) return
      const target = clampSentenceIndex(chapter.startIndex, sentences.length, readingBounds)
      const idx = findChapterIndex(currentBook.chapters, target)
      setCurrentChapterIndex(idx)
      if (!hasChapters) {
        setPageIndex(Math.floor(target / pageSize))
      }
      if (onSeekToChapter) {
        onSeekToChapter(target)
      }
      setChapterDropdownOpen(false)
    },
    [
      currentBook,
      hasChapters,
      onSeekToChapter,
      pageSize,
      readingBounds,
      sentences.length,
      setCurrentChapterIndex,
      setPageIndex
    ]
  )

  if (!currentBook || sentences.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-transparent text-gray-400 dark:text-gray-500">
        <BookOpen className="mb-4 h-16 w-16 text-primary/40" />
        <p className="text-lg text-gray-600 dark:text-gray-300">请从书架选择一本书开始阅读</p>
        <p className="mt-2 text-sm">或拖拽文件到书架导入</p>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col overflow-hidden bg-transparent relative min-h-0 ${
        immersive ? 'absolute inset-0' : 'flex-1'
      }`}
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/10 dark:bg-black/30 flex items-center justify-center z-10">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm text-gray-700 dark:text-gray-200">加载音频中...</span>
          </div>
        </div>
      )}

      <ReaderHeader
        immersive={immersive}
        left={
          <div className="relative flex-shrink-0 md:min-w-0 md:max-w-[40%] md:flex-1">
            <button
              onClick={() => {
                setVersionDropdownOpen(false)
                setChapterDropdownOpen((v) => !v)
              }}
              className="flex items-center gap-1 max-w-full h-8 px-1.5 sm:px-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-muted transition-colors"
              title={currentChapter?.title || currentBook.title || '章节'}
            >
              <BookOpen className="w-4 h-4 flex-shrink-0 text-primary" />
              <span
                className="hidden md:inline truncate font-medium text-sm"
                style={{ fontSize: `${Math.min(titleFontSize, 15)}px` }}
              >
                {currentChapter?.title || currentBook.title || '全文'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
            </button>
            {chapterDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 max-h-72 w-[min(18rem,calc(100vw-5rem))] overflow-y-auto bg-white dark:bg-dark-raised border border-gray-200 dark:border-dark-border rounded-xl shadow-card z-dropdown py-1">
                {currentBook.chapters.map((ch, idx) => {
                  const inRange =
                    ch.startIndex + ch.sentenceCount > readingBounds.start &&
                    ch.startIndex < readingBounds.end
                  return (
                    <button
                      key={idx}
                      onClick={() =>
                        inRange
                          ? handleChapterSelect(ch)
                          : (setChapterDropdownOpen(false), onReselectRange?.(1))
                      }
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 truncate ${
                        ch.title === currentChapter?.title
                          ? 'text-primary font-medium bg-primary/5'
                          : 'text-gray-700 dark:text-gray-300'
                      } ${!inRange ? 'opacity-40' : ''}`}
                    >
                      {ch.title}
                      <span className="text-xs text-gray-400 ml-1.5">({ch.sentenceCount})</span>
                    </button>
                  )
                })}
                <div className="border-t border-gray-100 dark:border-dark-border mt-1 pt-1">
                  <button
                    onClick={() => {
                      setChapterDropdownOpen(false)
                      onReselectRange?.(1)
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-primary hover:bg-primary/5 flex items-center gap-1"
                  >
                    <ListChecks className="w-3 h-3" /> 调整章节范围
                  </button>
                </div>
              </div>
            )}
          </div>
        }
        right={
          <>
            <button
              onClick={() => {
                searchOriginRef.current = currentSentenceIndex
                setSearchOpen(true)
                safeTimeout(() => searchInputRef.current?.focus(), 50)
              }}
              className="icon-btn"
              title="搜索 (Ctrl+F)"
            >
              <Search className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                onClick={() => {
                  setChapterDropdownOpen(false)
                  setVersionDropdownOpen((v) => !v)
                }}
                className={`icon-btn ${versionDropdownOpen ? 'text-primary bg-primary/10' : ''}`}
                title="切换版本"
              >
                <Layers className="w-4 h-4" />
              </button>
              {versionDropdownOpen && (
                <div className="absolute top-full right-0 mt-1 w-64 max-w-[80vw] bg-white dark:bg-dark-raised border border-gray-200 dark:border-dark-border rounded-xl shadow-card z-dropdown py-1">
                  <button
                    onClick={() => {
                      setVersionDropdownOpen(false)
                      onSelectVersion?.()
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    原始版本 · {originalSentences.length}句
                  </button>
                  {currentBook.editHistory && currentBook.editHistory.length > 0 ? (
                    currentBook.editHistory
                      .slice()
                      .reverse()
                      .map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setVersionDropdownOpen(false)
                            onSelectVersion?.(r.id)
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{r.label}</span>
                          <span className="text-gray-400 flex-shrink-0">{r.sentenceCount}句</span>
                        </button>
                      ))
                  ) : (
                    <div className="px-3 py-1.5 text-xs text-gray-400">尚无清洗记录</div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setChapterDropdownOpen(false)
                onReselectRange?.()
              }}
              className="icon-btn"
              title="重选章节范围"
            >
              <ListChecks className="w-4 h-4" />
            </button>

            {exporting && exportProgress ? (
              <span className="text-[10px] text-primary flex items-center gap-0.5 px-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {exportProgress.current}/{exportProgress.total}
              </span>
            ) : (
              <button onClick={handleExportAudio} className="icon-btn" title="导出音频 MP3">
                <Download className="w-4 h-4" />
              </button>
            )}

            <button onClick={handleRefresh} className="icon-btn" title="刷新本书">
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={() => void window.api?.startScreenshotOcr()}
              className="icon-btn"
              title="截图朗读"
            >
              <Camera className="w-4 h-4" />
            </button>

            {onToggleSubtitle && (
              <button
                onClick={onToggleSubtitle}
                className={`icon-btn ${subtitleEnabled ? 'text-primary bg-primary/10' : ''}`}
                title={subtitleEnabled ? '关闭桌面字幕' : '开启桌面字幕'}
              >
                <Captions className="w-4 h-4" />
              </button>
            )}
          </>
        }
      />

      {/* 搜索栏 */}
      {searchOpen && !immersive && (
        <div className="panel-chrome px-3 sm:px-4 py-2 bg-gray-50 dark:bg-dark-muted border-b border-gray-200 dark:border-dark-border flex-shrink-0 flex items-center gap-2 z-30">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goToMatch(e.shiftKey ? searchCurrent - 1 : searchCurrent + 1)
              }
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setSearchQuery('')
              }
            }}
            placeholder="搜索文本..."
            className="flex-1 max-w-xs text-sm px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-primary"
          />
          {searchQuery && (
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {searchMatches.length > 0 ? `${searchCurrent + 1}/${searchMatches.length}` : '无匹配'}
            </span>
          )}
          <button
            onClick={() => goToMatch(searchCurrent - 1)}
            disabled={searchMatches.length === 0}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 disabled:opacity-30"
            title="上一个 (Shift+Enter)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => goToMatch(searchCurrent + 1)}
            disabled={searchMatches.length === 0}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 disabled:opacity-30"
            title="下一个 (Enter)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleSearchReturn}
            disabled={searchOriginRef.current == null}
            className="text-xs text-gray-500 hover:text-primary px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 whitespace-nowrap"
            title="返回搜索前的位置"
          >
            返回
          </button>
          <button
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 听书正文：与 AI 阅读共用 reader-stage 遮罩 */}
      <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-2.5">
      <div
        ref={containerRef}
        data-reader-ready
        data-sentence-list
        className="reader-stage panel-readable relative flex-1 overflow-y-auto px-3 sm:px-5 py-2 contain-content"
      >
        {/* Top page nav — only for non-chaptered books */}
        {!hasChapters && (
          <div className="flex items-center justify-center gap-2 mb-2 text-xs text-gray-400">
            <button
              onClick={() => goToPage(-1)}
              disabled={!canPrevPage}
              className={`${canPrevPage ? 'hover:text-primary' : 'opacity-30'}`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>
              {pageIndex + 1}/{totalPages}
            </span>
            <button
              onClick={() => goToPage(1)}
              disabled={!canNextPage}
              className={`${canNextPage ? 'hover:text-primary' : 'opacity-30'}`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {(() => {
          // 正常分章后单章 ≤400 句：整章渲染，滚轮可滚完全章。
          // 仅遗留「未治愈的巨章」才窗口裁剪，避免假列表（看得见提示却滚不进去）。
          const FULL_RENDER_MAX = 500
          const WINDOW = 150
          const rangeLen = bounds.end - bounds.start
          const useWindow = rangeLen > FULL_RENDER_MAX
          const focus = Math.max(bounds.start, Math.min(bounds.end - 1, currentSentenceIndex))
          const winStart = useWindow
            ? Math.max(bounds.start, focus - WINDOW)
            : bounds.start
          const winEnd = useWindow
            ? Math.min(bounds.end, focus + WINDOW + 1)
            : bounds.end
          const rows: ReactNode[] = []
          if (useWindow && winStart > bounds.start) {
            rows.push(
              <div key="win-head" className="text-center py-2 text-[11px] text-gray-400">
                … 上方还有 {winStart - bounds.start} 句（点句子或翻章可跳转）
              </div>
            )
          }
          for (let index = winStart; index < winEnd; index++) {
            const sentence = sentences[index]
            if (sentence === undefined) continue
            rows.push(
              <SentenceRow
                key={index}
                sentence={sentence}
                index={index}
                isActive={index === currentSentenceIndex}
                isPast={index < currentSentenceIndex}
                isPlaying={playState === 'playing'}
                isTtsSkipped={isSentenceTtsSkipped(currentBook, index)}
                bookmarked={bookmarkedSet.has(index)}
                bookmarkAdding={bookmarkAdding === index}
                bookmarkInput={bookmarkInput}
                fontSize={fontSize}
                onSentenceClick={handleSentenceClick}
                onCopy={handleCopySentence}
                onBookmarkToggle={handleBookmarkToggle}
                onBookmarkAdd={handleAddBookmark}
                onBookmarkSubmit={submitBookmark}
                onBookmarkCancel={handleBookmarkCancel}
                onBookmarkInputChange={handleBookmarkInputChange}
                activeRowRef={setActiveRow}
              />
            )
          }
          if (useWindow && winEnd < bounds.end) {
            rows.push(
              <div key="win-tail" className="text-center py-2 text-[11px] text-gray-400">
                … 下方还有 {bounds.end - winEnd} 句
              </div>
            )
          }
          return rows
        })()}

        {/* End of page/chapter: show appropriate message */}
        {currentSentenceIndex === bounds.end - 1 && playState !== 'idle' && (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            {!hasChapters && pageIndex < totalPages - 1 ? (
              <>
                <p className="text-lg">📖 第 {pageIndex + 1} 页读完</p>
                <p className="text-sm mt-2">正在加载下一页...</p>
              </>
            ) : hasChapters ? (
              <>
                <p className="text-lg">📖 本章读完</p>
                <p className="text-sm mt-2">从章节列表选择下一章继续</p>
              </>
            ) : (
              <>
                <p className="text-lg">🎉 已读完</p>
                <p className="text-sm mt-2">全书已全部朗读完毕</p>
              </>
            )}
          </div>
        )}

        {/* Bottom page nav — only for non-chaptered books */}
        {!hasChapters && (
          <div className="flex items-center justify-center gap-4 py-6 border-t border-gray-100 dark:border-gray-700 mt-4">
            <button
              onClick={() => goToPage(-1)}
              disabled={!canPrevPage}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                canPrevPage
                  ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-4 h-4" /> 上一页
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              第 {pageIndex + 1} / {totalPages} 页
            </span>
            <button
              onClick={() => goToPage(1)}
              disabled={!canNextPage}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                canNextPage
                  ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              下一页 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      </div>

      {/* 浮动操作区 */}
      <SelectionPopup
        containerRef={containerRef}
        onCopied={() => showToast('success', '已复制')}
        onSearchInBook={(text) => {
          searchOriginRef.current = usePlayerStore.getState().currentSentenceIndex
          setSearchQuery(text.slice(0, 80))
          setSearchOpen(true)
          safeTimeout(() => searchInputRef.current?.focus(), 50)
        }}
        onPlayFromSentence={(index) => {
          onSeekToChapter?.(index)
        }}
      />

      {/* 自动滚动开关：沉浸时隐藏，避免挡字 */}
      {!immersive && (
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`absolute bottom-4 right-4 z-20 w-9 h-9 rounded-full flex items-center justify-center shadow-lg border transition-all ${
            autoScroll
              ? 'bg-primary text-[rgb(var(--on-primary-rgb))] border-primary hover:opacity-90'
              : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:text-primary hover:border-primary/50'
          }`}
          title={autoScroll ? '自动滚动：开（点击关闭）' : '自动滚动：关（点击开启）'}
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
