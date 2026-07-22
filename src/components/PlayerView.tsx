import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
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
  ArrowDown
} from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useBookmarkStore } from '../stores/bookmarkStore'
import { useSettingsStore } from '../stores/settingsStore'
import { clampSentenceIndex, findChapterIndex } from '../utils/bookData'
import type { BookData, Chapter } from '../global'

/** 单句行 —— memo 化，仅 props 变化时重渲染 */
const SentenceRow = memo(function SentenceRow({
  sentence,
  index,
  isActive,
  isPlaying,
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
  onBookmarkInputChange
}: {
  sentence: string
  index: number
  isActive: boolean
  isPlaying: boolean
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
}) {
  return (
    <div
      data-active={isActive || undefined}
      className={`group flex items-start gap-3 px-3 py-2 rounded cursor-pointer transition-colors duration-200 ${
        isActive
          ? `bg-yellow-50 dark:bg-yellow-900/20 border-l-[3px] border-primary ${isPlaying ? 'sentence-active' : ''}`
          : 'border-l-[3px] border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
      }`}
      onClick={() => onSentenceClick(index)}
      style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
    >
      <span
        className={`flex-shrink-0 w-8 text-right text-xs mt-0.5 select-none ${
          isActive ? 'text-primary font-bold' : 'text-gray-300 dark:text-gray-600'
        }`}
      >
        {index + 1}
      </span>
      <span
        className={`flex-1 select-text ${
          isActive
            ? 'text-gray-900 dark:text-gray-50 font-medium'
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
}

export default function PlayerView({
  showToast,
  onSeekToChapter,
  onSelectVersion,
  onReloadBook,
  onReselectRange
}: PlayerViewProps) {
  const { sentences, currentBook, sentenceRange, loadBooks, getRangeBounds } = useBookStore()
  const {
    currentSentenceIndex,
    playState,
    currentChapterIndex,
    setCurrentChapterIndex,
    pageIndex,
    setPageIndex,
    pageSize,
    voiceId,
    speed
  } = usePlayerStore()
  const { settings } = useSettingsStore()
  const { addBookmark, toggleBookmark, bookmarks } = useBookmarkStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false)
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false)
  const [bookmarkAdding, setBookmarkAdding] = useState<number | null>(null)
  const [bookmarkInput, setBookmarkInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // === 自动滚动开关 ===
  const [autoScroll, setAutoScroll] = useState(true)
  // === 文本选中复制 ===
  const [selectionText, setSelectionText] = useState('')
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null)

  // === Audio export ===
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  // 真正的原文（导入时固定保存，清洗/版本切换不覆盖），供「原始版本」回看
  const originalSentences = currentBook?.originalSentences ?? sentences

  // 是否有真正的章节（>1 个才算，单章"正文"不算）
  const hasChapters = (currentBook?.chapters?.length || 0) > 1
  // 无章节时的总页数
  const totalPages = currentBook && !hasChapters ? Math.ceil(sentences.length / pageSize) : 0

  // 全书总字数（按当前全书内容去空白统计）
  const totalChars = useMemo(() => sentences.join('').replace(/\s/g, '').length, [sentences])
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

  // Auto-scroll to active sentence (respects toggle)
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      const el = containerRef.current.querySelector('[data-active]')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [currentSentenceIndex, autoScroll])

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

    const result = await window.api?.exportAudio({
      sentences: currentBook.sentences,
      voiceId,
      speed,
      startIndex: start,
      endIndex: end,
      defaultName: `${currentBook.title}-${rangeName}`
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
      setTimeout(() => setIsLoading(false), 500)
    },
    [onSeekToChapter]
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

  // 监听鼠标抬起，检测原生文本选中
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    if (text.length > 0) {
      const range = sel!.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setSelectionText(text)
      setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top })
    } else {
      setSelectionText('')
      setSelectionPos(null)
    }
  }, [])

  // 复制选中文本
  const handleCopySelection = useCallback(() => {
    if (!selectionText) return
    navigator.clipboard.writeText(selectionText).then(() => {
      showToast('success', '已复制')
      setSelectionText('')
      setSelectionPos(null)
      window.getSelection()?.removeAllRanges()
    })
  }, [selectionText, showToast])

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
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
        <BookOpen className="w-16 h-16 mb-4 opacity-40" />
        <p className="text-lg">请从书架选择一本书开始阅读</p>
        <p className="text-sm mt-2">或拖拽文件到书架导入</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-dark-bg relative">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/10 dark:bg-black/30 flex items-center justify-center z-10">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm text-gray-700 dark:text-gray-200">加载音频中...</span>
          </div>
        </div>
      )}

      {/* Chapter selection header */}
      <div className="px-6 py-3 bg-white dark:bg-dark-surface border-b border-gray-100 dark:border-gray-700 flex-shrink-0 relative">
        <div className="flex items-center justify-between">
          {/* Chapter dropdown */}
          <div className="relative">
            <button
              onClick={() => setChapterDropdownOpen((v) => !v)}
              className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors"
              style={{ fontSize: `${settings.fontSize.title}px` }}
            >
              <span>{currentChapter?.title || '全文'}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {chapterDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 max-h-80 w-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 py-1">
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
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 truncate ${
                        ch.title === currentChapter?.title
                          ? 'text-primary font-medium bg-primary/5'
                          : 'text-gray-700 dark:text-gray-300'
                      } ${!inRange ? 'opacity-40' : ''}`}
                      title={inRange ? undefined : '点击调整章节范围以包含此章'}
                    >
                      {ch.title}
                      <span className="text-xs text-gray-400 ml-2">({ch.sentenceCount}句)</span>
                    </button>
                  )
                })}
                <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                  <button
                    onClick={() => {
                      setChapterDropdownOpen(false)
                      onReselectRange?.(1)
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-primary hover:bg-primary/5 flex items-center gap-1"
                  >
                    <ListChecks className="w-3 h-3" /> 调整章节范围
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right actions: reselect range + version selector */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setChapterDropdownOpen(false)
                onReselectRange?.()
              }}
              className="text-xs text-gray-500 hover:text-primary bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
              title="重新选择章节范围（下次打开本书将自动沿用本次选择）"
            >
              <ListChecks className="w-3 h-3" />
              重选章节
            </button>

            {/* Version selector (edit records) */}
            <div className="relative">
            <button
              onClick={() => {
                setChapterDropdownOpen(false)
                setVersionDropdownOpen((v) => !v)
              }}
              className="text-xs text-gray-500 hover:text-primary bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
              title="切换版本（原始 / 各次清洗记录）"
            >
              <Layers className="w-3 h-3" />
              版本
            </button>
            {versionDropdownOpen && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 py-1">
                <button
                  onClick={() => {
                    setVersionDropdownOpen(false)
                    onSelectVersion?.()
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
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
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                      >
                        <span>{r.label}</span>
                        <span className="text-gray-400 ml-2 flex-shrink-0">
                          {r.sentenceCount}句
                        </span>
                      </button>
                    ))
                ) : (
                  <div className="px-3 py-1.5 text-xs text-gray-400">
                    尚无清洗记录（在「文本清洗」页处理后可在此切换）
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Author + refresh + export */}
          <div className="flex items-center gap-3">
            {exporting && exportProgress ? (
              <span className="text-xs text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {exportProgress.current}/{exportProgress.total}
              </span>
            ) : (
              <button
                onClick={handleExportAudio}
                className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="导出音频（合成当前章节/区间为 MP3）"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="刷新（重新载入本书，从存储读取最新文本）"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="text-sm text-gray-500 dark:text-gray-400">{currentBook.author}</div>
          </div>
        </div>

        {/* Progress info */}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          第{' '}
          {Math.max(
            1,
            Math.min(bounds.end - bounds.start, currentSentenceIndex - bounds.start + 1)
          )}
          /{bounds.end - bounds.start} 句 ·
          {hasChapters ? (
            <> {currentChapter?.title || '全文'} · </>
          ) : (
            <>
              {' '}
              第 {pageIndex + 1}/{totalPages} 页 ·{' '}
            </>
          )}
          全书 {sentences.length} 句 · 共 {totalChars.toLocaleString()} 字
        </p>
      </div>

      {/* Sentence list: 按窗口 slice 显示，但传给回调的是【全局】索引 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-2 relative contain-content" onMouseUp={handleMouseUp}>
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
        {sentences.slice(bounds.start, bounds.end).map((sentence, i) => {
          const index = bounds.start + i
          return (
            <SentenceRow
              key={index}
              sentence={sentence}
              index={index}
              isActive={index === currentSentenceIndex}
              isPlaying={playState === 'playing'}
              bookmarked={bookmarkedSet.has(index)}
              bookmarkAdding={bookmarkAdding === index}
              bookmarkInput={bookmarkInput}
              fontSize={settings.fontSize.body}
              onSentenceClick={handleSentenceClick}
              onCopy={handleCopySentence}
              onBookmarkToggle={handleBookmarkToggle}
              onBookmarkAdd={handleAddBookmark}
              onBookmarkSubmit={submitBookmark}
              onBookmarkCancel={handleBookmarkCancel}
              onBookmarkInputChange={handleBookmarkInputChange}
            />
          )
        })}

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

      {/* 浮动操作区 */}
      {/* 选中文本复制气泡 */}
      {selectionText && selectionPos && (
        <button
          onClick={handleCopySelection}
          className="fixed z-50 flex items-center gap-1 bg-gray-800 dark:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          style={{
            left: `${selectionPos.x}px`,
            top: `${selectionPos.y - 40}px`,
            transform: 'translateX(-50%)'
          }}
        >
          <Copy className="w-3 h-3" /> 复制
        </button>
      )}

      {/* 自动滚动开关 */}
      <button
        onClick={() => setAutoScroll((v) => !v)}
        className={`absolute bottom-4 right-4 z-20 w-9 h-9 rounded-full flex items-center justify-center shadow-lg border transition-all ${
          autoScroll
            ? 'bg-primary text-white border-primary hover:opacity-90'
            : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:text-primary hover:border-primary/50'
        }`}
        title={autoScroll ? '自动滚动：开（点击关闭）' : '自动滚动：关（点击开启）'}
      >
        <ArrowDown className="w-4 h-4" />
      </button>
    </div>
  )
}
