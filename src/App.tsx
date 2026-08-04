import { useCallback, useEffect, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import SideNav from './components/SideNav'
import BookShelf from './components/BookShelf'
import PlayerView from './components/PlayerView'
import AppBackground from './components/AppBackground'
import AiReaderView from './components/reader/AiReaderView'
import { shouldShowFullPlaybackBar } from './components/reader/AiPlaybackCapsule'
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
  generatePseudoStructure,
  healBookLayoutForReading,
  loadPlayPref,
  normalizeBookData,
  normalizeChapters,
  normalizeSentenceRange,
  normalizeSentences,
  resolveSourceBoundaries,
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
  DEFAULT_VOLUME,
  shouldPublishBookPlaybackState
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
import type { BookData, ToastItem, Chapter, ChapterMode } from './global'
import LoadingOverlay from './components/ui/LoadingOverlay'
import { waitForReaderReady, waitUntilUiSettled } from './utils/uiReady'

export default function App() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 启动首屏：settings + 书架加载完成前盖住卡顿 */
  const [appBooting, setAppBooting] = useState(true)
  const [rangeSelectorData, setRangeSelectorData] = useState<{
    book: BookData
    initialPage?: 0 | 1
  } | null>(null)
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)

  // selector 订阅：避免 timeMap/pageIndex/books 进度写回触发整棵树重渲染
  // books 进度字段会高频更新，App 只订阅长度用于 auto-resume，完整列表用 getState()
  const booksLength = useBookStore((s) => s.books.length)
  const currentBook = useBookStore((s) => s.currentBook)
  const currentBookId = currentBook?.id
  const currentView = useBookStore((s) => s.currentView)
  const readerMode = useBookStore((s) => s.readerMode)
  const setCurrentView = useBookStore((s) => s.setCurrentView)
  const setLoading = useBookStore((s) => s.setLoading)
  const isLoading = useBookStore((s) => s.isLoading)
  const loadingMessage = useBookStore((s) => s.loadingMessage)
  const loadBooks = useBookStore((s) => s.loadBooks)
  const updateBookAndPersist = useBookStore((s) => s.updateBookAndPersist)
  const enterPlayerSession = useBookStore((s) => s.enterPlayerSession)

  // playState 仅用于历史会话 effect；句索引不订阅到 App，避免每句整树重渲染
  const playState = usePlayerStore((s) => s.playState)
  const rawSpeechActive = usePlayerStore((s) => s.rawSpeechActive)
  const setSpeed = usePlayerStore((s) => s.setSpeed)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const setVoiceId = usePlayerStore((s) => s.setVoiceId)

  const settings = useSettingsStore((s) => s.settings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadLogs = useLogStore((s) => s.loadLogs)
  const loadHistory = useHistoryStore((s) => s.loadHistory)

  // === 播放器沉浸模式（正文区右上 fixed 悬浮开关；开启后隐藏顶/底栏） ===
  const [playerImmersive, setPlayerImmersive] = useState(false)

  useEffect(() => {
    // 离开播放器时退出沉浸，避免下次进来状态错乱
    if (currentView !== 'player') setPlayerImmersive(false)
  }, [currentView])

  // === Toast helpers ===
  const showToast = useCallback((type: ToastItem['type'], message: string, duration?: number) => {
    const id = uuidv4()
    setToasts((prev) => [...prev, { id, type, message, duration }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // === Initialize：数据加载完后仍保持启动遮罩，直到首屏真正画完 ===
  useEffect(() => {
    let cancelled = false
    const startedAt = performance.now()
    ;(async () => {
      try {
        await Promise.all([loadSettings(), loadBooks()])
        if (cancelled) return
        const s = useSettingsStore.getState().settings
        setSpeed(s.defaultSpeed)
        setVolume(s.defaultVolume)
        setVoiceId(s.voiceId)
        // 书架 React 渲染/虚拟列表布局可能仍卡主线程 —— 遮罩盖到绘制完成
        await waitUntilUiSettled({ minMs: 800, frames: 4, startedAt })
      } finally {
        if (!cancelled) setAppBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadSettings, loadBooks, setSpeed, setVolume, setVoiceId])

  // 进入历史页再加载（避免启动读 history.json）
  useEffect(() => {
    if (currentView === 'history') {
      void loadHistory()
    }
  }, [currentView, loadHistory])

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
      // trusted：跳过全文 hash / 全量 structure 校验（打开热路径）
      const normalized = normalizeBookData(candidate, {
        trusted: true,
        contentHash: candidate.structureMeta?.contentHash
      })
      if (!normalized) {
        showToast('error', '该文章没有可朗读的有效内容')
        return false
      }

      // 治愈单章巨书 / 病态 structure（如 1 章 × 19 万 block），再进阅读器
      const { book, changed } = healBookLayoutForReading(normalized)

      tts.stop()
      const normalizedRange = normalizeSentenceRange(range, book.sentences.length)
      const sentenceIndex = clampSentenceIndex(
        requestedIndex ?? book.currentSentenceIndex,
        book.sentences.length,
        normalizedRange
      )
      const chapterIndex = findChapterIndex(book.chapters, sentenceIndex)

      // 各 store 一次写入，避免 6+ 次 set 连环重渲染
      enterPlayerSession(book, normalizedRange, versionId)
      usePlayerStore.getState().prepareForBook({
        totalSentences: book.sentences.length,
        sentenceIndex,
        chapterIndex,
        timeMap: book.timeMap || []
      })

      // 主文本布局被治愈：后台写回瘦身后的 chapters/structure（不阻塞遮罩）。
      // 编辑记录版本 (versionId=uuid) 绝不落盘，避免把临时句子写进书库。
      if (changed && (versionId === null || versionId === '__original__')) {
        void updateBookAndPersist({
          ...book,
          currentSentenceIndex: sentenceIndex,
          currentChapterIndex: chapterIndex
        })
      }

      return true
    },
    [enterPlayerSession, showToast, tts, updateBookAndPersist]
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
    const cleanups: Array<() => void> = []
    cleanups.push(
      window.api?.onTrayTogglePlay(() => {
        if (usePlayerStore.getState().playState === 'playing') tts.pause()
        else tts.play()
      }) ?? (() => {})
    )
    cleanups.push(window.api?.onTrayPrevSentence(() => tts.prevSentence()) ?? (() => {}))
    cleanups.push(window.api?.onTrayNextSentence(() => tts.nextSentence()) ?? (() => {}))
    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [tts])

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

  // === AI 阅读模式：停止 TTS，但保留阅读位置（不 reset 到范围起点）===
  useEffect(() => {
    if (readerMode === 'ai-reading') tts.pause()
  }, [readerMode, tts])

  // === 切到阅读器且处于 AI 阅读时，禁止残留的书籍 TTS 继续响 ===
  useEffect(() => {
    if (currentView === 'player' && readerMode === 'ai-reading') {
      const state = usePlayerStore.getState().playState
      if (state === 'playing') tts.pause()
    }
  }, [currentView, readerMode, tts])

  // === 实时日志推送（主进程 → 渲染进程） ===
  useEffect(() => {
    const cleanup = window.api?.onLogEntry((entry) => {
      if (entry?.id) useLogStore.getState().appendLog(entry)
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // === 知识库自动导入失败提示 ===
  useEffect(() => {
    const cleanup = window.api?.onAiIngestError((message) => {
      showToast('info', message)
    })
    return () => {
      cleanup?.()
    }
  }, [showToast])

  // 范围是否激活
  function sentenceRangeActive(
    book: BookData | null,
    bounds: { start: number; end: number }
  ): boolean {
    if (!book) return false
    return bounds.start !== 0 || bounds.end !== book.sentences.length
  }

  // === 悬浮球 / 字幕 / 进度：store.subscribe，不触发 App 重渲染 ===
  const lastIpcRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const publishFloating = () => {
      const book = useBookStore.getState().currentBook
      const player = usePlayerStore.getState()
      const bounds = useBookStore.getState().getRangeBounds()
      const totalSentences = book?.sentences.length || 0
      const cur = player.currentSentenceIndex
      const windowSize = Math.max(1, bounds.end - bounds.start)

      const chapters = book?.chapters || []
      let chapterTitle = ''
      if (chapters.length > 0) {
        const found = chapters.find(
          (ch) => cur >= ch.startIndex && cur < ch.startIndex + ch.sentenceCount
        )
        if (found) chapterTitle = found.title
      }

      const progressPercent = sentenceRangeActive(book, bounds)
        ? ((cur - bounds.start) / windowSize) * 100
        : totalSentences > 0
          ? (cur / totalSentences) * 100
          : 0

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

      const now = Date.now()
      if (now - lastIpcRef.current < 200) return
      lastIpcRef.current = now

      window.api?.updateFloatingBallState(snapshot)

      if (shouldPublishBookPlaybackState(player.rawSpeechActive)) {
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
      }
    }

    const scheduleProgressSave = () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      progressTimerRef.current = setTimeout(() => {
        progressTimerRef.current = null
        const book = useBookStore.getState().currentBook
        if (!book) return
        const player = usePlayerStore.getState()
        const bounds = useBookStore.getState().getRangeBounds()
        const windowSize = Math.max(1, bounds.end - bounds.start)
        const rangeActive = bounds.start !== 0 || bounds.end !== book.sentences.length
        const progressPercent = rangeActive
          ? ((player.currentSentenceIndex - bounds.start) / windowSize) * 100
          : book.sentences.length > 0
            ? (player.currentSentenceIndex / book.sentences.length) * 100
            : 0
        useBookStore.getState().updateBookProgress(book.id, {
          currentSentenceIndex: player.currentSentenceIndex,
          currentChapterIndex: player.currentChapterIndex,
          progressPercent,
          lastReadAt: new Date().toISOString()
        })
      }, 1200)
    }

    // 立即同步一次
    publishFloating()

    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      if (
        state.currentSentenceIndex === prev.currentSentenceIndex &&
        state.playState === prev.playState &&
        state.rawSpeechActive === prev.rawSpeechActive &&
        state.currentChapterIndex === prev.currentChapterIndex
      ) {
        return
      }
      publishFloating()
      if (state.currentSentenceIndex !== prev.currentSentenceIndex) {
        scheduleProgressSave()
      }
    })
    const unsubBook = useBookStore.subscribe((state, prev) => {
      if (state.currentBook?.id !== prev.currentBook?.id) {
        publishFloating()
      }
    })

    return () => {
      unsubPlayer()
      unsubBook()
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
    }
  }, [])

  // 切走页面 / 最小化前立刻落盘，避免防抖窗口内丢进度
  // 注意：flushPersist 内部有 booksHydrated 守卫，未 loadBooks 前不会写盘
  useEffect(() => {
    const flush = () => {
      void useBookStore.getState().flushPersist()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
      // 不在 React unmount 时 flush：StrictMode/HMR 会在 books=[] 时卸载，绝不能写盘
    }
  }, [])

  // === 清洗后自动打开预选页 ===
  useEffect(() => {
    const bookId = useTextCleanStore.getState().openBookAfterApply
    if (bookId && currentView === 'shelf') {
      const book = useBookStore.getState().books.find((b) => b.id === bookId)
      if (book) {
        useTextCleanStore.getState().setOpenBookAfterApply(null)
        // 清洗后句数可能变化，强制弹预选页展示最新版本，不走缓存跳过
        handleOpenBook(book, { forceSelector: true })
      }
    }
  }, [currentView, booksLength])

  // === History recording (session-based: record when play starts -> stops) ===
  const sessionStartRef = useRef<{
    time: string
    sentenceIndex: number
    chapterIndex: number
  } | null>(null)

  useEffect(() => {
    if (!shouldPublishBookPlaybackState(rawSpeechActive)) return
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

      // 记录本次会话实际使用的引擎（含千问/自定义）
      const engine = player.useSystemTTS ? 'system' : player.ttsEngine

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
  }, [playState, rawSpeechActive])

  // Cleanup session on book change
  useEffect(() => {
    return () => {
      sessionStartRef.current = null
    }
  }, [currentBook?.id])

  // === 导入进度（主进程推送） ===
  useEffect(() => {
    const cleanup = window.api?.onImportProgress((data) => {
      if (data?.detail) {
        useBookStore.getState().setLoading(true, data.detail)
      }
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // === Import file handler ===
  const handleImportFile = useCallback(
    async (filePath: string) => {
      setLoading(true, '正在解析书籍…')
      try {
        const result = (await window.api?.importFile(filePath)) as {
          success: boolean
          book?: BookData
          error?: string
          warning?: string
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
          if (result.warning) {
            showToast('warning', result.warning)
          } else {
            showToast('success', `已导入《${newBook.title}》`)
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

  /** RangeSelector 确认后进入播放器（遮罩盖到阅读器首帧画完） */
  const handleChapterConfirm = useCallback(
    async (
      book: BookData,
      range: { start: number; end: number } | null,
      activeChapters?: Chapter[],
      recordId?: string,
      chapterMode?: ChapterMode,
      options?: { skipLoading?: boolean }
    ) => {
      const startedAt = performance.now()
      if (!options?.skipLoading) {
        setLoading(true, '正在进入阅读…')
      } else {
        setLoading(true, '正在准备阅读界面…')
      }
      try {
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
      const mode: ChapterMode =
        chapterMode === 'merged' || chapterMode === 'original'
          ? chapterMode
          : book.chapterMode === 'merged'
            ? 'merged'
            : 'original'
      const sourceBoundaries = resolveSourceBoundaries(book)

      // 关键修复：把用户选中的章节写进书库，阅读器以后都认这套（不再只活在内存里）
      // 仅当激活的是主文本句数与书库一致时才持久化（编辑记录/句数不一致只会话生效）
      const canPersistChapters = !recordId && sentences.length === book.sentences.length
      let structure = book.structure
      let structureMeta = book.structureMeta
      if (canPersistChapters && activeChapters) {
        const pseudo = generatePseudoStructure(sentences, chapters)
        structure = pseudo.structure
        structureMeta = pseudo.structureMeta
        const sentenceIndex = clampSentenceIndex(book.currentSentenceIndex, sentences.length)
        const toSave = normalizeBookData(
          {
            ...book,
            chapters,
            sourceBoundaries,
            chapterMode: mode,
            structure,
            structureMeta,
            currentSentenceIndex: sentenceIndex,
            currentChapterIndex: findChapterIndex(chapters, sentenceIndex)
          },
          {
            trusted: true,
            ...(book.structureMeta?.contentHash
              ? { contentHash: book.structureMeta.contentHash }
              : {})
          }
        )
        if (toSave) {
          // 写回前再 heal，禁止预选页把超长章/巨 structure 持久化
          void updateBookAndPersist(healBookLayoutForReading(toSave).book)
        }
      }

      // 打开链路：trusted + 复用 contentHash，禁止再跑全量 block 校验
      const displayBook = normalizeBookData(
        {
          ...book,
          chapters,
          sentences,
          sourceBoundaries,
          chapterMode: mode,
          structure: canPersistChapters && activeChapters ? structure : book.structure,
          structureMeta: canPersistChapters && activeChapters ? structureMeta : book.structureMeta,
          timeMap: recordId ? undefined : book.timeMap
        },
        {
          trusted: true,
          ...(!recordId && book.structureMeta?.contentHash
            ? { contentHash: book.structureMeta.contentHash }
            : {})
        }
      )
      if (!displayBook) {
        showToast('error', '所选版本没有可朗读内容')
        return
      }
      const normalizedRange = normalizeSentenceRange(range, displayBook.sentences.length)
      const requestedIndex = recordId
        ? (normalizedRange?.start ?? 0)
        : displayBook.currentSentenceIndex
      activateReadingBook(displayBook, normalizedRange, requestedIndex, recordId || '__original__')
      // 关键：遮罩必须盖到真实正文容器挂载并完成首帧量高，而不是 loading 占位页
      await waitForReaderReady({ minMs: 600, frames: 4, startedAt, timeoutMs: 12000 })
      } finally {
        setLoading(false)
      }
    },
    [activateReadingBook, setLoading, showToast, updateBookAndPersist]
  )

  // === Open book from shelf ===
  const handleOpenBook = useCallback(
    async (book: BookData, opts?: { forceSelector?: boolean }) => {
      const startedAt = performance.now()
      setLoading(true, book.sentences.length === 0 ? '正在打开书籍…' : '正在准备阅读…')
      try {
        let normalized: BookData | null
        if (book.sentences.length === 0) {
          normalized = await useBookStore.getState().loadFullBook(book.id)
          if (!normalized) {
            showToast('error', '加载书籍数据失败')
            return
          }
        } else {
          normalized = normalizeBookData(book, {
            trusted: true,
            contentHash: book.structureMeta?.contentHash
          })
          if (!normalized) {
            showToast('error', '该文章没有可朗读的有效内容')
            return
          }
        }
        const pref = opts?.forceSelector
          ? null
          : validatePlayPref(loadPlayPref(normalized.id), normalized)
        if (pref?.range) {
          const recordId = pref.recordId ?? null
          // 子流程自己关遮罩；此处保持 loading 直到进入阅读 settle
          await handleChapterConfirm(
            normalized,
            pref.range,
            recordId ? undefined : normalized.chapters,
            recordId || undefined,
            normalized.chapterMode
          )
          return
        }
        setRangeSelectorData({ book: normalized })
        await waitUntilUiSettled({ minMs: 450, frames: 3, startedAt })
      } finally {
        // 若已进入 handleChapterConfirm，其 finally 会 setLoading(false)；
        // 这里再清一次保证选章页路径也会关掉。
        setLoading(false)
      }
    },
    [handleChapterConfirm, setLoading, showToast]
  )

  // === 每次启动进入书架页，不再自动恢复阅读位置 ===
  const autoResumedRef = useRef(false)
  useEffect(() => {
    if (autoResumedRef.current || booksLength === 0) return
    autoResumedRef.current = true
  }, [booksLength])

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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-bg relative">
      <AppBackground />
      <LoadingOverlay
        visible={appBooting}
        message="正在打开听伴…"
        detail="加载设置与书架，并等待界面就绪"
      />
      <LoadingOverlay
        visible={!appBooting && isLoading}
        message={loadingMessage || '请稍候…'}
        detail="正在完成解析与界面渲染，完成后即可流畅使用"
      />
      <TitleBar
        immersive={playerImmersive && currentView === 'player'}
        onToggleImmersive={currentView === 'player' ? () => setPlayerImmersive((v) => !v) : undefined}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar：沉浸时收成细条可点回，或保持可导航 */}
        <div
          className={
            playerImmersive && currentView === 'player'
              ? 'w-0 overflow-hidden opacity-0 pointer-events-none'
              : 'contents'
          }
        >
          <SideNav
            currentView={currentView}
            onViewChange={setCurrentView}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-transparent min-w-0">
          {currentView === 'shelf' && (
            <BookShelf
              onImportFile={handleImportFile}
              onOpenBook={handleOpenBook}
              onSelectChapters={async (book) => {
                let normalized = book.sentences.length > 0 ? normalizeBookData(book) : null
                if (!normalized) {
                  normalized = await useBookStore.getState().loadFullBook(book.id)
                }
                if (!normalized) {
                  showToast('error', '该文章没有可朗读的有效内容')
                  return
                }
                setRangeSelectorData({ book: normalized, initialPage: 1 })
              }}
              onCleanText={async (book) => {
                let fullBook = book.sentences.length > 0 ? book : null
                if (!fullBook) {
                  fullBook = await useBookStore.getState().loadFullBook(book.id)
                }
                if (!fullBook) {
                  showToast('error', '加载书籍数据失败')
                  return
                }
                const text = (fullBook.sentences || []).join('\n')
                tts.stop()
                useTextCleanStore.getState().setSource(text, book.id)
                setCurrentView('textclean')
              }}
              showToast={showToast}
            />
          )}

          <div className={currentView === 'player' ? 'flex-1 flex flex-col min-h-0 relative overflow-hidden' : 'hidden'}>
              {/* 双视图常驻，CSS 切换避免卸载重建卡顿 */}
              <div className={readerMode === 'ai-reading' ? 'contents' : 'hidden'}>
                <AiReaderView
                  immersive={playerImmersive}
                  onSpeakRaw={tts.speakRaw}
                  onStopRaw={tts.stopRaw}
                  onSeekToSentence={tts.seekTo}
                  onPlayFromSentence={tts.playFrom}
                  onPlay={tts.play}
                  onPause={tts.pause}
                  onPrevSentence={tts.prevSentence}
                  onNextSentence={tts.nextSentence}
                  onReselectRange={() => {
                    const active = useBookStore.getState().currentBook
                    if (active) setRangeSelectorData({ book: active, initialPage: 1 })
                  }}
                  onSelectVersion={(recordId) => {
                    const active = useBookStore.getState().currentBook
                    if (!active) return
                    const base = useBookStore.getState().books.find((book) => book.id === active.id)
                    if (base) void handleChapterConfirm(base, null, undefined, recordId)
                  }}
                />
              </div>
              <div className={readerMode === 'listening' ? 'contents' : 'hidden'}>
                <PlayerView
                  showToast={showToast}
                  onSeekToChapter={tts.playFrom}
                  onSelectVersion={(recordId) => {
                    const active = useBookStore.getState().currentBook
                    if (!active) return
                    const base = useBookStore.getState().books.find((book) => book.id === active.id)
                    if (base) void handleChapterConfirm(base, null, undefined, recordId)
                  }}
                  onReloadBook={(book) => activateReadingBook(book)}
                  onReselectRange={(initialPage) => {
                    const active = useBookStore.getState().currentBook
                    if (active) setRangeSelectorData({ book: active, initialPage })
                  }}
                  onToggleSubtitle={handleToggleSubtitle}
                  subtitleEnabled={subtitleEnabled}
                  immersive={playerImmersive}
                />
              </div>

              {shouldShowFullPlaybackBar(readerMode) && (
                <div
                  className={`z-30 bg-white dark:bg-dark-surface transition-transform duration-200 ease-out ${
                    playerImmersive
                      ? 'absolute bottom-0 left-0 right-0 translate-y-full pointer-events-none'
                      : 'flex-shrink-0 translate-y-0'
                  }`}
                >
                  <ProgressBar onSeek={tts.seekTo} onPause={tts.pause} onResume={tts.play} />
                  <ControlBar
                    onPlay={tts.play}
                    onPause={tts.pause}
                    onStop={tts.stop}
                    onPrevSentence={tts.prevSentence}
                    onNextSentence={tts.nextSentence}
                    onSkipChapter={handleSkipChapter}
                    showToast={showToast}
                  />
                </div>
              )}

            </div>

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
              onOpenVersion={(book, recordId) => {
                void handleChapterConfirm(book, null, undefined, recordId)
              }}
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
          sourceBoundaries={rangeSelectorData.book.sourceBoundaries}
          chapterMode={rangeSelectorData.book.chapterMode}
          editHistory={rangeSelectorData.book.editHistory}
          sentenceCount={rangeSelectorData.book.sentences.length}
          originalSentences={rangeSelectorData.book.originalSentences}
          initialPage={rangeSelectorData.initialPage}
          onCancel={() => {
            setRangeSelectorData(null)
          }}
          onConfirm={(range, activeChapters, recordId, chapterMode) => {
            const book = rangeSelectorData.book
            setRangeSelectorData(null)
            void handleChapterConfirm(book, range, activeChapters, recordId, chapterMode)
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
