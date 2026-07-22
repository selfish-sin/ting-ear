import { useCallback, useEffect, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import SideNav from './components/SideNav'
import BookShelf from './components/BookShelf'
import PlayerView from './components/PlayerView'
import ControlBar from './components/ControlBar'
import ProgressBar from './components/ProgressBar'
import BookmarksView from './components/BookmarksView'
import HistoryView from './components/HistoryView'
import LogsView from './components/LogsView'
import SettingsModal from './components/SettingsModal'
import RangeSelector from './components/RangeSelector'
import { FloatingBallWindow } from './components/FloatingBall'
import QuickTextPanel from './components/QuickTextPanel'
import TextCleanerView from './components/TextCleanerView'
import { generateCoverDataUrl } from './utils/coverGenerator'
import {
  buildPseudoChapters,
  clampSentenceIndex,
  findChapterIndex,
  loadPlayPref,
  mergeSmallChapters,
  normalizeBookData,
  normalizeChapters,
  normalizeSentenceRange,
  normalizeSentences,
  splitReadableSentences,
  validatePlayPref
} from './utils/bookData'
import ScreenshotOverlay from './components/ScreenshotOverlay'
import { SubtitleWindow } from './components/SubtitleWindow'
import ToastContainer from './components/Toast'
import { useTTS } from './hooks/useTTS'
import { useKeyboard, useClipboardHotkey } from './hooks/useKeyboard'
import { useBookStore } from './stores/bookStore'
import {
  usePlayerStore,
  SPEED_STEP,
  VOLUME_STEP,
  DEFAULT_SPEED,
  DEFAULT_VOLUME
} from './stores/playerStore'
import PlayerOSD from './components/PlayerOSD'
import { useOsdStore } from './stores/osdStore'
import { useSettingsStore } from './stores/settingsStore'
import { useLogStore } from './stores/logStore'
import { useHistoryStore } from './stores/historyStore'
import { useFloatingBallStore } from './stores/floatingBallStore'
import { useQuickTextStore } from './stores/quickTextStore'
import { useTextCleanStore } from './stores/textCleanStore'
import { v4 as uuidv4 } from 'uuid'
import type { BookData, ToastItem, Chapter } from './global'

export default function App() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rangeSelectorData, setRangeSelectorData] = useState<{
    book: BookData
    initialPage?: 0 | 1
  } | null>(null)
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)

  const {
    books,
    currentBook,
    setCurrentBook,
    setSentences,
    setChapters,
    setCurrentView,
    currentView,
    setLoading,
    loadBooks,
    updateBookProgress,
    setSentenceRange,
    setCurrentVersionId
  } = useBookStore()

  const {
    setTotalSentences,
    setCurrentSentenceIndex,
    setCurrentChapterIndex,
    setSpeed,
    setVolume,
    setVoiceId,
    playState,
    currentSentenceIndex
  } = usePlayerStore()

  const { settings, loadSettings } = useSettingsStore()
  const { loadLogs } = useLogStore()
  const { loadHistory } = useHistoryStore()

  // === Toast helpers ===
  const showToast = useCallback((type: ToastItem['type'], message: string, duration?: number) => {
    const id = uuidv4()
    setToasts((prev) => [...prev, { id, type, message, duration }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // === Initialize ===
  useEffect(() => {
    const init = async () => {
      await loadSettings()
      await loadBooks()
      await loadLogs()
      await loadHistory()

      // Sync player store from settings
      const s = useSettingsStore.getState().settings
      setSpeed(s.defaultSpeed)
      setVolume(s.defaultVolume)
      setVoiceId(s.voiceId)
    }
    init()
  }, [loadSettings, loadBooks, loadLogs, loadHistory, setSpeed, setVolume, setVoiceId])

  // === Theme handling ===
  useEffect(() => {
    const applyTheme = (theme: 'light' | 'dark') => {
      if (theme === 'dark') document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
    }
    if (settings.theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      applyTheme(prefersDark ? 'dark' : 'light')
    } else {
      applyTheme(settings.theme)
    }
  }, [settings.theme])

  // === TTS hook ===
  const tts = useTTS({ showToast })

  const activateReadingBook = useCallback(
    (
      candidate: BookData,
      range: { start: number; end: number } | null = null,
      requestedIndex?: number,
      versionId: string | null = null
    ) => {
      const book = normalizeBookData(candidate)
      if (!book) {
        showToast('error', '该文章没有可朗读的有效内容')
        return false
      }

      tts.stop()
      const normalizedRange = normalizeSentenceRange(range, book.sentences.length)
      const sentenceIndex = clampSentenceIndex(
        requestedIndex ?? book.currentSentenceIndex,
        book.sentences.length,
        normalizedRange
      )
      const chapterIndex = findChapterIndex(book.chapters, sentenceIndex)
      const player = usePlayerStore.getState()

      setCurrentBook(book)
      setSentences(book.sentences)
      setChapters(book.chapters)
      setSentenceRange(normalizedRange)
      setCurrentVersionId(versionId)
      setTotalSentences(book.sentences.length)
      setCurrentSentenceIndex(sentenceIndex)
      setCurrentChapterIndex(chapterIndex)
      player.setPageIndex(Math.floor(sentenceIndex / player.pageSize))
      player.setTimeMap(book.timeMap || [])
      setCurrentView('player')
      return true
    },
    [
      setChapters,
      setCurrentBook,
      setCurrentChapterIndex,
      setCurrentSentenceIndex,
      setCurrentView,
      setCurrentVersionId,
      setSentenceRange,
      setSentences,
      setTotalSentences,
      showToast,
      tts
    ]
  )

  // === Keyboard shortcuts ===
  // 方向键的「上一句/下一句」已由全局快捷键（设置里可改）接管，此处不再绑定，
  // 否则按 Ctrl+方向键会同时触发内部与全局两份逻辑。
  useKeyboard({
    onPlay: tts.play,
    onPause: tts.pause,
    onStop: tts.stop
  })

  // === Start reading arbitrary text (from clipboard/hotkey) ===
  const startReadingText = useCallback(
    (text: string) => {
      // Create a temporary "book" from the text
      const trimmed = text.trim()
      if (!trimmed) return

      const sentences = splitReadableSentences(trimmed)
      if (sentences.length === 0) return

      const tempBook: BookData = {
        id: uuidv4(),
        title: '剪贴板文本',
        author: '临时朗读',
        filePath: '',
        format: 'txt',
        sentences,
        chapters: [{ title: '临时文本', startIndex: 0, sentenceCount: sentences.length }],
        currentChapterIndex: 0,
        currentSentenceIndex: 0,
        progressPercent: 0,
        isCompleted: false,
        addedAt: new Date().toISOString(),
        lastReadAt: new Date().toISOString()
      }

      if (activateReadingBook(tempBook, null, 0)) {
        showToast('success', `开始朗读 ${sentences.length} 句文本`)
      }
    },
    [activateReadingBook, showToast]
  )

  // === Clipboard + global hotkey ===
  useClipboardHotkey({ showToast, onStartReadingText: startReadingText })

  // === Tray events ===
  useEffect(() => {
    window.api?.onTrayTogglePlay(() => {
      if (playState === 'playing') tts.pause()
      else tts.play()
    })
    window.api?.onTrayPrevSentence(() => tts.prevSentence())
    window.api?.onTrayNextSentence(() => tts.nextSentence())
  }, [playState, tts])

  // === Floating ball events ===
  useEffect(() => {
    const cleanups: Array<() => void> = []

    cleanups.push(window.api?.onFloatingBallPlay(() => tts.play()) ?? (() => {}))
    cleanups.push(window.api?.onFloatingBallPause(() => tts.pause()) ?? (() => {}))
    cleanups.push(window.api?.onFloatingBallPrev(() => tts.prevSentence()) ?? (() => {}))
    cleanups.push(window.api?.onFloatingBallNext(() => tts.nextSentence()) ?? (() => {}))
    cleanups.push(
      window.api?.onFloatingBallExpand(() => {
        useFloatingBallStore.getState().setVisible(false)
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onFloatingBallRequestOcr(() => {
        void window.api?.startScreenshotOcr()
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onFloatingBallReadClipboard((text: string) => {
        startReadingText(text)
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onOcrResult((text: string) => {
        navigator.clipboard.writeText(text).catch(() => {})
        useQuickTextStore.getState().setText(text)
        setCurrentView('quicktext')
        showToast('success', `已识别 ${text.length} 字，已自动复制`)
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onOcrError((msg: string) => {
        showToast('error', `OCR 失败：${msg}`)
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onFloatingBallPrevChapter(() => {
        const book = useBookStore.getState().currentBook
        if (!book) return
        const player = usePlayerStore.getState()
        const bounds = useBookStore.getState().getRangeBounds()
        const curChapter = book.chapters.find(
          (ch) =>
            player.currentSentenceIndex >= ch.startIndex &&
            player.currentSentenceIndex < ch.startIndex + ch.sentenceCount
        )
        if (!curChapter) {
          tts.seekTo(bounds.start)
          return
        }
        const curIdx = book.chapters.indexOf(curChapter)
        const prevIdx = Math.max(0, curIdx - 1)
        if (prevIdx !== curIdx) {
          const prevCh = book.chapters[prevIdx]
          const target = Math.max(bounds.start, prevCh.startIndex)
          tts.seekTo(target)
        } else {
          tts.seekTo(bounds.start)
        }
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onFloatingBallNextChapter(() => {
        const book = useBookStore.getState().currentBook
        if (!book) return
        const player = usePlayerStore.getState()
        const bounds = useBookStore.getState().getRangeBounds()
        const curChapter = book.chapters.find(
          (ch) =>
            player.currentSentenceIndex >= ch.startIndex &&
            player.currentSentenceIndex < ch.startIndex + ch.sentenceCount
        )
        if (!curChapter) {
          tts.seekTo(bounds.end - 1)
          return
        }
        const curIdx = book.chapters.indexOf(curChapter)
        const nextIdx = Math.min(book.chapters.length - 1, curIdx + 1)
        if (nextIdx !== curIdx) {
          const nextCh = book.chapters[nextIdx]
          const target = Math.min(bounds.end - 1, nextCh.startIndex)
          tts.seekTo(target)
        } else {
          tts.seekTo(bounds.end - 1)
        }
      }) ?? (() => {})
    )
    cleanups.push(
      window.api?.onFloatingBallSeekTo((index: number) => {
        tts.seekTo(index)
      }) ?? (() => {})
    )

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [tts, startReadingText, showToast])

  // === Subtitle window playback control events ===
  useEffect(() => {
    const cleanups: Array<() => void> = []
    cleanups.push(window.api?.onSubtitlePlay(() => tts.play()) ?? (() => {}))
    cleanups.push(window.api?.onSubtitlePause(() => tts.pause()) ?? (() => {}))
    cleanups.push(window.api?.onSubtitlePrev(() => tts.prevSentence()) ?? (() => {}))
    cleanups.push(window.api?.onSubtitleNext(() => tts.nextSentence()) ?? (() => {}))
    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [tts])

  // === 实时日志推送（主进程 → 渲染进程） ===
  useEffect(() => {
    const cleanup = window.api?.onLogEntry((entry) => {
      if (entry?.id) useLogStore.getState().appendLog(entry)
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // === Update floating ball state when player changes ===
  useEffect(() => {
    const book = useBookStore.getState().currentBook
    const player = usePlayerStore.getState()
    const bounds = useBookStore.getState().getRangeBounds()
    const totalSentences = book?.sentences.length || 0
    const cur = player.currentSentenceIndex
    const windowSize = Math.max(1, bounds.end - bounds.start)

    // 查找当前章节标题（chapters 全局，自洽）
    const chapters = book?.chapters || []
    let chapterTitle = ''
    if (chapters.length > 0) {
      const found = chapters.find(
        (ch) => cur >= ch.startIndex && cur < ch.startIndex + ch.sentenceCount
      )
      if (found) chapterTitle = found.title
    }

    // range-aware 进度：范围激活时按窗口内相对位置计算
    const progressPercent = sentenceRangeActive(book, bounds)
      ? ((cur - bounds.start) / windowSize) * 100
      : totalSentences > 0
        ? (cur / totalSentences) * 100
        : 0

    // 构建附近句子窗口（4句：当前-1, 当前, 当前+1, 当前+2，clamp到范围边界）
    const nearbySentences: Array<{ index: number; text: string; isCurrent: boolean }> = []
    if (book && totalSentences > 0) {
      const windowStart = Math.max(bounds.start, cur - 1)
      const windowEnd = Math.min(bounds.end, cur + 3)
      for (let i = windowStart; i < windowEnd; i++) {
        nearbySentences.push({
          index: i,
          text: book.sentences[i] || '',
          isCurrent: i === cur
        })
      }
    }

    const snapshot = {
      hasContent: !!book && totalSentences > 0,
      isPlaying: player.playState === 'playing',
      isLoading: player.playState === 'playing' && !book?.sentences[cur],
      error: useFloatingBallStore.getState().error,
      bookTitle: book?.title || '',
      chapterTitle,
      currentSentenceText: book?.sentences[cur] || '',
      progressPercent,
      nearbySentences
    }

    useFloatingBallStore.getState().setSnapshot(snapshot)

    window.api?.updateFloatingBallState(snapshot)

    // === 同步字幕窗口 ===
    if (book && totalSentences > 0) {
      window.api?.subtitleSendUpdate({
        text: book.sentences[cur] || '',
        bookTitle: book.title,
        chapterTitle,
        isPlaying: player.playState === 'playing',
        hasContent: true,
        progressPercent
      })
    } else {
      window.api?.subtitleSendUpdate({
        text: '',
        isPlaying: false,
        hasContent: false,
        progressPercent: 0
      })
    }
  }, [playState, currentSentenceIndex, currentBook])

  // 范围是否激活：sentences 全集长度 > 窗口大小
  // 不直接用 bookStore.sentenceRange 是为了避免该 effect 额外订阅它造成抖动；
  // 当 bounds 与全集不一致即视为范围生效。
  function sentenceRangeActive(
    book: BookData | null,
    bounds: { start: number; end: number }
  ): boolean {
    if (!book) return false
    return bounds.start !== 0 || bounds.end !== book.sentences.length
  }

  // === Auto-save progress on sentence change ===
  useEffect(() => {
    if (!currentBook) return
    const saveTimer = setTimeout(async () => {
      const player = usePlayerStore.getState()
      const bounds = useBookStore.getState().getRangeBounds()
      const windowSize = Math.max(1, bounds.end - bounds.start)
      // range-aware 进度：范围激活时按窗口内相对位置
      const rangeActive = bounds.start !== 0 || bounds.end !== currentBook.sentences.length
      const progressPercent = rangeActive
        ? ((player.currentSentenceIndex - bounds.start) / windowSize) * 100
        : currentBook.sentences.length > 0
          ? (player.currentSentenceIndex / currentBook.sentences.length) * 100
          : 0
      const progress = {
        currentSentenceIndex: player.currentSentenceIndex, // 全局索引
        currentChapterIndex: player.currentChapterIndex,
        progressPercent,
        lastReadAt: new Date().toISOString()
      }
      updateBookProgress(currentBook.id, progress)
    }, 1000)
    return () => clearTimeout(saveTimer)
  }, [currentSentenceIndex, currentBook, updateBookProgress])

  // === 清洗后自动打开预选页 ===
  useEffect(() => {
    const bookId = useTextCleanStore.getState().openBookAfterApply
    if (bookId && currentView === 'shelf') {
      const book = books.find((b) => b.id === bookId)
      if (book) {
        useTextCleanStore.getState().setOpenBookAfterApply(null)
        // 清洗后句数可能变化，强制弹预选页展示最新版本，不走缓存跳过
        handleOpenBook(book, { forceSelector: true })
      }
    }
  }, [currentView, books])

  // === History recording (session-based: record when play starts -> stops) ===
  const sessionStartRef = useRef<{
    time: string
    sentenceIndex: number
    chapterIndex: number
  } | null>(null)

  useEffect(() => {
    const book = useBookStore.getState().currentBook
    if (!book) {
      sessionStartRef.current = null
      return
    }

    if (playState === 'playing' && !sessionStartRef.current) {
      const player = usePlayerStore.getState()
      sessionStartRef.current = {
        time: new Date().toISOString(),
        sentenceIndex: player.currentSentenceIndex,
        chapterIndex: player.currentChapterIndex
      }
    } else if (
      (playState === 'paused' || playState === 'stopped' || playState === 'idle') &&
      sessionStartRef.current
    ) {
      const player = usePlayerStore.getState()
      const start = sessionStartRef.current
      sessionStartRef.current = null

      // Only record system/edge TTS sessions, skip qwen
      const engine = player.useSystemTTS ? 'system' : player.ttsEngine
      if (engine === 'qwen') return

      const chapter = book.chapters[start.chapterIndex]
      const endPreview = book.sentences[player.currentSentenceIndex]?.slice(0, 100) || ''
      const duration = Math.round((Date.now() - new Date(start.time).getTime()) / 1000)
      if (duration < 5) return
      useHistoryStore.getState().addHistory({
        bookId: book.id,
        bookTitle: book.title,
        chapterIndex: start.chapterIndex,
        chapterTitle: chapter?.title || '',
        startSentenceIndex: start.sentenceIndex,
        endSentenceIndex: player.currentSentenceIndex,
        startTime: start.time,
        endTime: new Date().toISOString(),
        durationSeconds: duration,
        contentPreview: endPreview,
        isCompleted: false,
        engineUsed: engine,
        sentenceRange: useBookStore.getState().sentenceRange
      })
    }
  }, [playState])

  // Cleanup session on book change
  useEffect(() => {
    return () => {
      sessionStartRef.current = null
    }
  }, [currentBook?.id])

  // === Import file handler ===
  const handleImportFile = useCallback(
    async (filePath: string) => {
      setLoading(true, '正在解析书籍…')
      try {
        const result = (await window.api?.importFile(filePath)) as {
          success: boolean
          book?: BookData
          error?: string
        }

        if (result?.success && result.book) {
          const newBook = normalizeBookData({
            ...result.book,
            // 固定保存真·原文，供「原始版本」回看，不被清洗/自动保存覆盖
            originalSentences: result.book.originalSentences ?? result.book.sentences
          })
          if (!newBook) {
            showToast('error', '导入结果不包含可朗读文本')
            return
          }
          // Add to books array
          useBookStore.getState().addBook(newBook)

          // Auto-generate cover if none exists
          if (!newBook.coverPath) {
            const dataUrl = generateCoverDataUrl(newBook.title, newBook.author)
            window.api?.saveCover(newBook.id, dataUrl).then((res) => {
              if (res?.success && res.coverPath) {
                newBook.coverPath = res.coverPath
                useBookStore.getState().updateBook(newBook)
              }
            })
          }
        } else {
          showToast('error', result?.error || '导入失败')
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        showToast('error', `导入失败：${msg}`)
      } finally {
        setLoading(false)
      }
    },
    [setLoading, showToast]
  )

  /** RangeSelector 确认后进入播放器 */
  const handleChapterConfirm = useCallback(
    (
      book: BookData,
      range: { start: number; end: number } | null,
      activeChapters?: Chapter[],
      recordId?: string
    ) => {
      // 选「原始版本」（recordId 为空）时，永远用导入时的真·原文，而非被覆盖过的 book.sentences
      let sentences =
        !recordId && book.originalSentences && book.originalSentences.length > 0
          ? book.originalSentences
          : book.sentences
      let chapters = activeChapters || book.chapters
      // 如果选了编辑记录版本，用记录里的句子
      if (recordId) {
        const record = book.editHistory?.find((r) => r.id === recordId)
        if (record) {
          sentences = record.sentences
          // 如果章节来自记录（伪章节），用传入的；否则保留原始章节
          if (!activeChapters) chapters = buildPseudoChapters(sentences)
        }
      }
      sentences = normalizeSentences(sentences)
      chapters = normalizeChapters(chapters, sentences.length)
      const displayBook = normalizeBookData({
        ...book,
        chapters,
        sentences,
        timeMap: recordId ? undefined : book.timeMap
      })
      if (!displayBook) {
        showToast('error', '所选版本没有可朗读内容')
        return
      }
      const normalizedRange = normalizeSentenceRange(range, displayBook.sentences.length)
      const requestedIndex = recordId
        ? (normalizedRange?.start ?? 0)
        : displayBook.currentSentenceIndex
      activateReadingBook(displayBook, normalizedRange, requestedIndex, recordId || '__original__')
    },
    [activateReadingBook, showToast]
  )

  // === Open book from shelf ===
  const handleOpenBook = useCallback(
    (book: BookData, opts?: { forceSelector?: boolean }) => {
      const normalized = normalizeBookData(book)
      if (!normalized) {
        showToast('error', '该文章没有可朗读的有效内容')
        return
      }
      // 上次的预选缓存仍有效（版本句数没变）→ 跳过预选页，按上次的选择直接进播放器
      const pref = opts?.forceSelector ? null : validatePlayPref(loadPlayPref(normalized.id), normalized)
      if (pref?.range) {
        const recordId = pref.recordId ?? null
        const record = recordId ? normalized.editHistory?.find((r) => r.id === recordId) : undefined
        const rawSentences = record
          ? record.sentences
          : normalized.originalSentences?.length
            ? normalized.originalSentences
            : normalized.sentences
        const base = record
          ? buildPseudoChapters(rawSentences)
          : normalizeChapters(normalized.chapters, normalizeSentences(rawSentences).length)
        const activeChapters = pref.merged ? mergeSmallChapters(base) : base
        handleChapterConfirm(normalized, pref.range, activeChapters, recordId || undefined)
        return
      }
      setRangeSelectorData({ book: normalized })
    },
    [handleChapterConfirm, showToast]
  )

  // === Chapter/page skip (ControlBar buttons) ===
  const handleSkipChapter = useCallback(
    (direction: -1 | 1) => {
      const store = usePlayerStore.getState()
      const bookStore = useBookStore.getState()
      const book = bookStore.currentBook
      if (!book) return
      const bounds = bookStore.getRangeBounds()

      if ((book.chapters?.length || 0) > 1) {
        const eligible = book.chapters.filter(
          (chapter) =>
            chapter.startIndex + chapter.sentenceCount > bounds.start &&
            chapter.startIndex < bounds.end
        )
        const currentEligibleIndex = eligible.findIndex(
          (chapter) =>
            store.currentSentenceIndex >= chapter.startIndex &&
            store.currentSentenceIndex < chapter.startIndex + chapter.sentenceCount
        )
        const newEligibleIndex = Math.max(
          0,
          Math.min(
            eligible.length - 1,
            (currentEligibleIndex >= 0 ? currentEligibleIndex : 0) + direction
          )
        )
        if (newEligibleIndex === currentEligibleIndex || !eligible[newEligibleIndex]) return
        const ch = eligible[newEligibleIndex]
        const target = Math.max(bounds.start, Math.min(ch.startIndex, bounds.end - 1))
        store.setCurrentChapterIndex(findChapterIndex(book.chapters, target))
        if (ch) {
          store.setCurrentSentenceIndex(target)
          tts.playFrom(target)
        }
      } else {
        const minPage = Math.floor(bounds.start / store.pageSize)
        const maxPage = Math.floor((bounds.end - 1) / store.pageSize)
        const newPage = Math.max(minPage, Math.min(maxPage, store.pageIndex + direction))
        if (newPage === store.pageIndex) return
        store.setPageIndex(newPage)
        const newStart = Math.max(bounds.start, newPage * store.pageSize)
        store.setCurrentSentenceIndex(newStart)
        tts.playFrom(newStart)
      }
    },
    [tts]
  )

  // === Custom global shortcuts (player) ===
  useEffect(() => {
    const cleanup = window.api?.onShortcut((action) => {
      switch (action) {
        case 'toggle':
          if (usePlayerStore.getState().playState === 'playing') tts.pause()
          else tts.play()
          break
        case 'stop':
          tts.stop()
          break
        case 'prevSentence':
          tts.prevSentence()
          break
        case 'nextSentence':
          tts.nextSentence()
          break
        case 'prevChapter':
          handleSkipChapter(-1)
          break
        case 'nextChapter':
          handleSkipChapter(1)
          break
        case 'speedUp':
          usePlayerStore.getState().setSpeed(usePlayerStore.getState().speed + SPEED_STEP)
          useOsdStore.getState().show('speed')
          break
        case 'speedDown':
          usePlayerStore.getState().setSpeed(usePlayerStore.getState().speed - SPEED_STEP)
          useOsdStore.getState().show('speed')
          break
        case 'volumeUp':
          usePlayerStore.getState().setVolume(usePlayerStore.getState().volume + VOLUME_STEP)
          useOsdStore.getState().show('volume')
          break
        case 'volumeDown':
          usePlayerStore.getState().setVolume(usePlayerStore.getState().volume - VOLUME_STEP)
          useOsdStore.getState().show('volume')
          break
        case 'resetDefaults':
          usePlayerStore.getState().setSpeed(DEFAULT_SPEED)
          usePlayerStore.getState().setVolume(DEFAULT_VOLUME)
          useOsdStore.getState().show('reset')
          break
      }
    })
    return () => {
      cleanup?.()
    }
  }, [tts, handleSkipChapter])

  // === Floating ball toggle ===
  const handleToggleFloatingBall = useCallback(() => {
    const { settings, setFloatingBallEnabled } = useSettingsStore.getState()
    setFloatingBallEnabled(!settings.floatingBallEnabled)
  }, [])

  // === Subtitle toggle ===
  const handleToggleSubtitle = useCallback(() => {
    if (!subtitleEnabled) {
      window.api?.subtitleShow()
      setSubtitleEnabled(true)
      showToast('success', '桌面字幕已开启')
    } else {
      window.api?.subtitleHide()
      setSubtitleEnabled(false)
      showToast('info', '桌面字幕已关闭')
    }
  }, [subtitleEnabled, showToast])

  // Listen for subtitle hidden events (from right-click menu close)
  useEffect(() => {
    const cleanup = window.api?.onSubtitleHidden(() => {
      setSubtitleEnabled(false)
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // === Detect if this is the floating ball window (via hash routing) ===
  if (typeof window !== 'undefined' && window.location.hash === '#/floating') {
    return <FloatingBallWindow />
  }
  // === Screenshot selection overlay window ===
  if (typeof window !== 'undefined' && window.location.hash === '#/screenshot') {
    return <ScreenshotOverlay />
  }
  // === Desktop subtitle window ===
  if (typeof window !== 'undefined' && window.location.hash === '#/subtitle') {
    return <SubtitleWindow />
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-white dark:bg-dark-bg overflow-hidden">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <SideNav
          currentView={currentView}
          onViewChange={setCurrentView}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentView === 'shelf' && (
            <BookShelf
              onImportFile={handleImportFile}
              onOpenBook={handleOpenBook}
              onSelectChapters={(book) => {
                const normalized = normalizeBookData(book)
                if (!normalized) {
                  showToast('error', '该文章没有可朗读的有效内容')
                  return
                }
                setRangeSelectorData({ book: normalized, initialPage: 1 })
              }}
              onCleanText={(book) => {
                const text = (book.sentences || []).join('\n')
                tts.stop()
                useTextCleanStore.getState().setSource(text, book.id)
                setCurrentView('textclean')
              }}
              showToast={showToast}
            />
          )}

          {currentView === 'player' && (
            <>
              <PlayerView
                showToast={showToast}
                onSeekToChapter={tts.playFrom}
                onSelectVersion={(recordId) => {
                  const active = useBookStore.getState().currentBook
                  if (!active) return
                  const base = useBookStore.getState().books.find((book) => book.id === active.id)
                  if (base) handleChapterConfirm(base, null, undefined, recordId)
                }}
                onReloadBook={(book) => activateReadingBook(book)}
                onReselectRange={(initialPage) => {
                  const active = useBookStore.getState().currentBook
                  if (active) setRangeSelectorData({ book: active, initialPage })
                }}
              />
              <ProgressBar onSeek={tts.seekTo} onPause={tts.pause} onResume={tts.play} />
              <ControlBar
                onPlay={tts.play}
                onPause={tts.pause}
                onStop={tts.stop}
                onPrevSentence={tts.prevSentence}
                onNextSentence={tts.nextSentence}
                onSkipChapter={handleSkipChapter}
                onToggleFloatingBall={handleToggleFloatingBall}
                onToggleSubtitle={handleToggleSubtitle}
                subtitleEnabled={subtitleEnabled}
                showToast={showToast}
              />
            </>
          )}

          {currentView === 'bookmarks' && (
            <BookmarksView
              showToast={showToast}
              onOpenBookAt={(book, sentenceIndex) => activateReadingBook(book, null, sentenceIndex)}
            />
          )}
          {currentView === 'history' && (
            <HistoryView
              showToast={showToast}
              onContinueReading={(book, sentenceIndex, range) =>
                activateReadingBook(book, range, sentenceIndex)
              }
            />
          )}
          {currentView === 'logs' && <LogsView showToast={showToast} />}
          {currentView === 'quicktext' && (
            <QuickTextPanel showToast={showToast} onRead={startReadingText} />
          )}
          {currentView === 'textclean' && (
            <TextCleanerView
              showToast={showToast}
              onBackToShelf={() => setCurrentView('shelf')}
              onOpenVersion={(book, recordId) =>
                handleChapterConfirm(book, null, undefined, recordId)
              }
            />
          )}
        </div>
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} showToast={showToast} />
      )}

      {/* Chapter selector (for chaptered books) */}
      {rangeSelectorData && (
        <RangeSelector
          bookId={rangeSelectorData.book.id}
          chapters={rangeSelectorData.book.chapters}
          editHistory={rangeSelectorData.book.editHistory}
          sentenceCount={rangeSelectorData.book.sentences.length}
          originalSentences={rangeSelectorData.book.originalSentences}
          initialPage={rangeSelectorData.initialPage}
          onCancel={() => {
            setRangeSelectorData(null)
          }}
          onConfirm={(range, activeChapters, recordId) => {
            const book = rangeSelectorData.book
            setRangeSelectorData(null)
            handleChapterConfirm(book, range, activeChapters, recordId)
          }}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 播放控制 OSD（倍速 / 音量反馈） */}
      <PlayerOSD />
    </div>
  )
}
