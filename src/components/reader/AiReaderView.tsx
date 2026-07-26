import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  ListChecks,
  ListTree,
  Loader2,
  MessageSquareText,
  X
} from 'lucide-react'
import { useBookStore } from '../../stores/bookStore'
import { usePlayerStore } from '../../stores/playerStore'
import type { Block, BookData, Chapter, ChapterOutlineRecord, StructuredChapter } from '../../global'
import { chapterDisplayTitle, chapterKey } from '../../utils/bookData'
import ReaderHeader from './ReaderHeader'
import ChapterOutlinePanel from './ChapterOutlinePanel'
import ContentCards from './ContentCards'
import AiChatPanel from '../ai/AiChatPanel'

/** 全书大纲任务进度（手动触发） */
export interface BookOutlineJobProgress {
  running: boolean
  /** 当前处理到第几章（1-based） */
  current: number
  total: number
  chapterTitle: string
  done: number
  failed: number
  skipped: number
}

interface AiReaderViewProps {
  immersive?: boolean
  onSpeakRaw?: (text: string, onSentence?: (sentenceIndex: number, total: number) => void) => Promise<void>
  onStopRaw?: () => void
  /** 只移动播放头，不启动 TTS（AI 阅读默认行为） */
  onSeekToSentence?: (sentenceIndex: number) => void
  /** 明确从某句开始听书（右键「从此处播放」） */
  onPlayFromSentence?: (sentenceIndex: number) => void
  /** @deprecated 兼容旧名，等同 onPlayFromSentence */
  onSeekToChapter?: (sentenceIndex: number) => void
  onReselectRange?: (initialPage?: number) => void
  onSelectVersion?: (recordId?: string) => void
}

interface AiReaderContentProps extends AiReaderViewProps {
  currentBook: BookData | null
  sentences: string[]
  currentSentenceIndex: number
  isLoading: boolean
}

export interface OutlineSection {
  title: string
  globalStart: number
  point?: string
}

export type ChapterSections = OutlineSection[]

function buildFallbackStructure(book: BookData): StructuredChapter[] {
  const chapters = book.chapters.length
    ? book.chapters
    : [{ title: book.title || '正文', startIndex: 0, sentenceCount: book.sentences.length }]
  return chapters.map((chapter, chapterIndex) => {
    const end = Math.min(book.sentences.length, chapter.startIndex + chapter.sentenceCount)
    const blocks: Block[] = [{
      blockId: `legacy-heading-${book.id}-${chapterIndex}`,
      type: 'heading',
      level: 1,
      text: chapterDisplayTitle(chapter),
      ttsSkip: false,
      sentenceRange: [chapter.startIndex, chapter.startIndex]
    }]
    for (let start = chapter.startIndex; start < end; start += 5) {
      const blockEnd = Math.min(start + 5, end)
      blocks.push({
        blockId: `legacy-${book.id}-${chapterIndex}-${start}`,
        type: 'paragraph',
        text: book.sentences.slice(start, blockEnd).join(' '),
        ttsSkip: false,
        sentenceRange: [start, blockEnd]
      })
    }
    return { title: chapterDisplayTitle(chapter), level: 1, blocks, sentenceRange: [chapter.startIndex, end] }
  })
}

function findChapterBySentence(structure: StructuredChapter[], sentenceIndex: number): number {
  const index = structure.findIndex((chapter) => sentenceIndex >= chapter.sentenceRange[0] && sentenceIndex < chapter.sentenceRange[1])
  return index >= 0 ? index : 0
}

export function AiReaderContent({
  currentBook,
  sentences,
  currentSentenceIndex,
  isLoading,
  immersive = false,
  onSpeakRaw,
  onStopRaw,
  onSeekToSentence,
  onPlayFromSentence,
  onSeekToChapter,
  onReselectRange,
  onSelectVersion
}: AiReaderContentProps) {
  const structure = useMemo(() => currentBook?.structure?.length ? currentBook.structure : currentBook ? buildFallbackStructure(currentBook) : [], [currentBook])
  // 按当前阅读进度定位章节，避免先闪第 0 章再跳回
  const [activeChapter, setActiveChapter] = useState(() =>
    structure.length ? findChapterBySentence(structure, currentSentenceIndex) : 0
  )
  const [chapterRecords, setChapterRecords] = useState<Map<string, ChapterOutlineRecord>>(new Map())
  const [outlineStates, setOutlineStates] = useState<Record<string, { loading: boolean; generating?: boolean; progress?: number; error?: string }>>({})
  const [outlineCollapsed, setOutlineCollapsed] = useState(false)
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [bookOutlineJob, setBookOutlineJob] = useState<BookOutlineJobProgress | null>(null)
  const userNavigatedRef = useRef(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const loadedKeysRef = useRef(new Set<string>())
  /** 全书任务取消标记；当前章跑完后停止后续章 */
  const bookOutlineCancelRef = useRef(false)
  const bookOutlineRunningRef = useRef(false)
  const playState = usePlayerStore((state) => state.playState)
  const setCurrentSentenceIndex = usePlayerStore((state) => state.setCurrentSentenceIndex)
  const renameChapter = useBookStore((state) => state.renameChapter)
  const restoreChapterTitle = useBookStore((state) => state.restoreChapterTitle)

  // 只定位播放头，绝不自动开 TTS（AI 阅读默认）
  const seekOnly = useCallback((index: number) => {
    setCurrentSentenceIndex(index)
    onSeekToSentence?.(index)
  }, [onSeekToSentence, setCurrentSentenceIndex])

  const playFrom = onPlayFromSentence || onSeekToChapter

  useEffect(() => {
    if (structure.length === 0 || userNavigatedRef.current) return
    setActiveChapter(findChapterBySentence(structure, currentSentenceIndex))
  }, [currentSentenceIndex, structure])

  useEffect(() => {
    const next = structure.length ? findChapterBySentence(structure, currentSentenceIndex) : 0
    setActiveChapter(next)
    setChapterRecords(new Map())
    setOutlineStates({})
    loadedKeysRef.current = new Set()
    userNavigatedRef.current = false
    // 换书时取消全书任务
    bookOutlineCancelRef.current = true
    bookOutlineRunningRef.current = false
    setBookOutlineJob(null)
    // 仅在换书时重置；currentSentenceIndex 故意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id])

  const chapter = structure[activeChapter]
  const rangeStart = chapter?.sentenceRange[0] ?? 0
  const rangeEnd = chapter?.sentenceRange[1] ?? rangeStart
  const persistedChapter = currentBook?.chapters[activeChapter]
  const chapterIdentity = persistedChapter || { title: chapter?.title || currentBook?.title || '正文', startIndex: rangeStart, sentenceCount: rangeEnd - rangeStart }
  const activeChapterKey = chapterKey(chapterIdentity, activeChapter)
  const chapterTitle = chapterDisplayTitle(chapterIdentity)
  const request = useMemo(() => currentBook ? ({
    bookId: currentBook.id,
    chapterIndex: activeChapter,
    chapterKey: activeChapterKey
  }) : null, [currentBook, activeChapter, activeChapterKey])

  const requestBookId = request?.bookId ?? ''
  const requestChapterIndex = request?.chapterIndex ?? -1
  const requestChapterKey = request?.chapterKey ?? ''

  useEffect(() => {
    if (!requestBookId || requestChapterIndex < 0 || !window.api?.aiOutlineGet) return
    // 正在生成时不重复拉取
    if (outlineStates[requestChapterKey]?.generating) return
    // 本会话已加载过该章缓存，避免切回时反复 loading 闪烁
    if (loadedKeysRef.current.has(requestChapterKey) && chapterRecords.has(requestChapterKey)) return

    let cancelled = false
    const hasCached = chapterRecords.has(requestChapterKey)
    // 有缓存时静默刷新，不把整个面板打成 loading 闪烁
    if (!hasCached) {
      setOutlineStates((state) => ({
        ...state,
        [requestChapterKey]: { ...state[requestChapterKey], loading: true, error: undefined }
      }))
    }

    window.api.aiOutlineGet({ bookId: requestBookId, chapterIndex: requestChapterIndex, chapterKey: requestChapterKey }).then((result) => {
      if (cancelled) return
      loadedKeysRef.current.add(requestChapterKey)
      if (result.record) setChapterRecords((records) => new Map(records).set(requestChapterKey, result.record!))
      setOutlineStates((state) => ({
        ...state,
        [requestChapterKey]: { loading: false, generating: false, error: result.error }
      }))
    }).catch((error) => {
      if (!cancelled) {
        setOutlineStates((state) => ({
          ...state,
          [requestChapterKey]: {
            loading: false,
            generating: false,
            error: error instanceof Error ? error.message : '大纲读取失败'
          }
        }))
      }
    })
    return () => { cancelled = true }
    // outlineStates / chapterRecords 故意不进依赖，避免自触发循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestBookId, requestChapterIndex, requestChapterKey])

  const generateOutline = useCallback(() => {
    if (!request || !window.api?.aiOutlineGenerate) return
    if (bookOutlineRunningRef.current) {
      window.alert('全书大纲正在生成中，请稍候或先取消。')
      return
    }
    const key = request.chapterKey
    setOutlineStates((state) => ({
      ...state,
      [key]: { loading: false, generating: true, progress: 8, error: undefined }
    }))
    // 伪进度：让用户知道还在跑，完成后跳到 100
    const startedAt = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      // 约 45s 逼近 90%，之后缓慢爬升，避免假满
      const pseudo = Math.min(92, 8 + Math.log1p(elapsed) * 22)
      setOutlineStates((state) => {
        if (!state[key]?.generating) return state
        return { ...state, [key]: { ...state[key], progress: pseudo } }
      })
    }, 400)

    window.api.aiOutlineGenerate({ ...request, force: true }).then((result) => {
      window.clearInterval(tick)
      if (result.record) setChapterRecords((records) => new Map(records).set(key, result.record!))
      loadedKeysRef.current.add(key)
      setOutlineStates((state) => ({
        ...state,
        [key]: {
          loading: false,
          generating: false,
          progress: result.success ? 100 : undefined,
          error: result.success ? undefined : result.error
        }
      }))
    }).catch((error) => {
      window.clearInterval(tick)
      setOutlineStates((state) => ({
        ...state,
        [key]: {
          loading: false,
          generating: false,
          progress: undefined,
          error: error instanceof Error ? error.message : '大纲生成失败'
        }
      }))
    })
  }, [request])

  const cancelBookOutlineJob = useCallback(() => {
    if (!bookOutlineRunningRef.current) return
    bookOutlineCancelRef.current = true
    setBookOutlineJob((job) =>
      job ? { ...job, chapterTitle: `${job.chapterTitle}（取消中…）` } : job
    )
  }, [])

  /**
   * 手动全书大纲：按章顺序排队生成（复用单章 IPC + 进程内队列）。
   * - force=false：已有大纲跳过
   * - force=true（按住 Shift）：覆盖重生成
   * 绝不自动触发。
   */
  const generateBookOutlines = useCallback(
    async (options?: { force?: boolean }) => {
      if (!currentBook || !window.api?.aiOutlineGenerate || !window.api?.aiOutlineGet) return
      if (bookOutlineRunningRef.current) {
        window.alert('全书大纲已在生成中。可点进度条右侧「取消」停止后续章节。')
        return
      }

      const chapters: Chapter[] = currentBook.chapters.length
        ? currentBook.chapters
        : [
            {
              title: currentBook.title || '正文',
              startIndex: 0,
              sentenceCount: currentBook.sentences.length
            }
          ]
      const total = chapters.length
      if (total === 0) return

      const force = Boolean(options?.force)
      const ok = window.confirm(
        force
          ? `将强制重新生成《${currentBook.title}》全部 ${total} 章大纲（覆盖已有），可能较久。\n\n确定开始？`
          : `将为《${currentBook.title}》全部 ${total} 章生成大纲（手动）。\n\n• 已有大纲的章节会跳过\n• 按住 Shift 再点可强制全部重生成\n• 生成中可取消后续章节\n\n确定开始？`
      )
      if (!ok) return

      bookOutlineRunningRef.current = true
      bookOutlineCancelRef.current = false
      let done = 0
      let failed = 0
      let skipped = 0

      setBookOutlineJob({
        running: true,
        current: 0,
        total,
        chapterTitle: '准备中…',
        done: 0,
        failed: 0,
        skipped: 0
      })

      for (let index = 0; index < total; index += 1) {
        if (bookOutlineCancelRef.current) break

        const chapterMeta = chapters[index]
        const key = chapterKey(chapterMeta, index)
        const title = chapterDisplayTitle(chapterMeta)

        setBookOutlineJob({
          running: true,
          current: index + 1,
          total,
          chapterTitle: title,
          done,
          failed,
          skipped
        })

        // 非强制：先查缓存，有则跳过（不打生成接口）
        if (!force) {
          try {
            const cached = await window.api.aiOutlineGet({
              bookId: currentBook.id,
              chapterIndex: index,
              chapterKey: key
            })
            if (
              cached.record &&
              (cached.record.status === 'generated' || cached.record.status === 'short_chapter')
            ) {
              setChapterRecords((records) => new Map(records).set(key, cached.record!))
              loadedKeysRef.current.add(key)
              setOutlineStates((state) => ({
                ...state,
                [key]: { loading: false, generating: false, error: undefined }
              }))
              skipped += 1
              continue
            }
          } catch {
            // 读取失败则继续尝试生成
          }
        }

        if (bookOutlineCancelRef.current) break

        setOutlineStates((state) => ({
          ...state,
          [key]: { loading: false, generating: true, progress: 8, error: undefined }
        }))
        const startedAt = Date.now()
        const tick = window.setInterval(() => {
          const elapsed = (Date.now() - startedAt) / 1000
          const pseudo = Math.min(92, 8 + Math.log1p(elapsed) * 22)
          setOutlineStates((state) => {
            if (!state[key]?.generating) return state
            return { ...state, [key]: { ...state[key], progress: pseudo } }
          })
        }, 400)

        try {
          const result = await window.api.aiOutlineGenerate({
            bookId: currentBook.id,
            chapterIndex: index,
            chapterKey: key,
            force
          })
          window.clearInterval(tick)
          if (result.success && result.record) {
            setChapterRecords((records) => new Map(records).set(key, result.record!))
            loadedKeysRef.current.add(key)
            setOutlineStates((state) => ({
              ...state,
              [key]: { loading: false, generating: false, progress: 100, error: undefined }
            }))
            done += 1
          } else {
            setOutlineStates((state) => ({
              ...state,
              [key]: {
                loading: false,
                generating: false,
                progress: undefined,
                error: result.error || '生成失败'
              }
            }))
            failed += 1
          }
        } catch (error) {
          window.clearInterval(tick)
          setOutlineStates((state) => ({
            ...state,
            [key]: {
              loading: false,
              generating: false,
              progress: undefined,
              error: error instanceof Error ? error.message : '大纲生成失败'
            }
          }))
          failed += 1
        }
      }

      const cancelled = bookOutlineCancelRef.current
      bookOutlineRunningRef.current = false
      bookOutlineCancelRef.current = false
      setBookOutlineJob(null)

      const parts = [
        `完成 ${done} 章`,
        skipped > 0 ? `跳过 ${skipped} 章` : '',
        failed > 0 ? `失败 ${failed} 章` : '',
        cancelled ? '（已取消后续）' : ''
      ].filter(Boolean)
      window.alert(`全书大纲任务结束：${parts.join('，')}`)
    },
    [currentBook]
  )

  const navigateToChapter = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(structure.length - 1, index))
    setActiveChapter(clamped)
    userNavigatedRef.current = true
    clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => { userNavigatedRef.current = false }, 3000)
    const start = structure[clamped]?.sentenceRange[0]
    if (start === undefined) return
    // AI 阅读：切章只定位，绝不自动 TTS
    seekOnly(start)
  }, [structure, seekOnly])

  const selectSection = useCallback((startOffset: number) => {
    const globalStart = rangeStart + startOffset
    if (playState === 'playing' && playFrom) {
      playFrom(globalStart)
    } else {
      seekOnly(globalStart)
    }
  }, [rangeStart, playState, playFrom, seekOnly])

  const updateRecord = useCallback((record: ChapterOutlineRecord) => {
    setChapterRecords((records) => new Map(records).set(record.chapterKey, record))
    void window.api?.aiOutlineUpdate(record)
  }, [])

  // 字数：本章 / 全书（与对话注入统计口径一致：句子拼接）
  const chapterCharCount = useMemo(() => {
    if (!chapter) return 0
    return sentences
      .slice(chapter.sentenceRange[0], chapter.sentenceRange[1])
      .join('')
      .length
  }, [chapter, sentences])
  const bookCharCount = useMemo(() => sentences.join('').length, [sentences])

  if (isLoading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="h-5 w-5 animate-spin text-primary" />正在加载文档</div>
  if (!currentBook || sentences.length === 0) return <div className="flex flex-1 items-center justify-center text-gray-400"><div className="text-center"><BookOpenText className="mx-auto mb-3 h-12 w-12 opacity-40" /><p className="text-sm">请从书架选择一本书开始阅读</p></div></div>

  const hasMultipleChapters = structure.length > 1
  const state = outlineStates[activeChapterKey]
  const record = chapterRecords.get(activeChapterKey)
  const fmtCount = (n: number) => n.toLocaleString('zh-CN')

  const bookJobPct =
    bookOutlineJob && bookOutlineJob.total > 0
      ? Math.round(
          ((bookOutlineJob.done + bookOutlineJob.skipped + bookOutlineJob.failed) /
            bookOutlineJob.total) *
            100
        )
      : 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface dark:bg-dark-bg">
      <ReaderHeader
        immersive={immersive}
        left={hasMultipleChapters ? <div className="relative"><button type="button" onClick={() => setChapterDropdownOpen((value) => !value)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"><span className="max-w-[12rem] truncate">{chapterTitle}</span><ChevronDown className="h-3 w-3 opacity-50" /></button>{chapterDropdownOpen && <div className="absolute left-0 top-full z-dropdown mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-raised">{structure.map((item, index) => <button key={`${item.sentenceRange[0]}-${index}`} type="button" onClick={() => { navigateToChapter(index); setChapterDropdownOpen(false) }} className={`flex w-full items-center px-3 py-1.5 text-left text-xs ${index === activeChapter ? 'bg-primary/10 font-medium text-primary' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5'}`}><span className="truncate">{item.title}</span></button>)}</div>}</div> : undefined}
        right={
          <>
            <span className="mr-1 hidden truncate text-[11px] text-gray-400 lg:inline" style={{ maxWidth: '10rem' }}>
              {currentBook.title}
            </span>
            <button
              type="button"
              data-book-outline-btn="true"
              className="icon-btn"
              title={
                bookOutlineJob
                  ? '全书大纲生成中…点击进度条可取消'
                  : '全书大纲（手动；Shift+点击=强制重生成）'
              }
              disabled={Boolean(bookOutlineJob)}
              onClick={(event) => {
                void generateBookOutlines({ force: event.shiftKey })
              }}
            >
              {bookOutlineJob ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <ListTree className="h-4 w-4" />
              )}
            </button>
            {onSelectVersion && (
              <button type="button" onClick={() => onSelectVersion()} className="icon-btn" title="切换版本">
                <Layers className="h-4 w-4" />
              </button>
            )}
            {onReselectRange && (
              <button type="button" onClick={() => onReselectRange()} className="icon-btn" title="重选章节范围">
                <ListChecks className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setAiPanelOpen((value) => !value)} className="icon-btn" title="AI 对话">
              <MessageSquareText className="h-4 w-4" />
            </button>
          </>
        }
      />
      {bookOutlineJob && !immersive && (
        <div
          data-book-outline-progress="true"
          className="flex flex-shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-1.5 dark:bg-primary/10"
        >
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-600 dark:text-gray-300">
              <span className="truncate">
                全书大纲 {bookOutlineJob.current}/{bookOutlineJob.total}：{bookOutlineJob.chapterTitle}
              </span>
              <span className="flex-shrink-0 tabular-nums text-gray-400">
                完成{bookOutlineJob.done} 跳过{bookOutlineJob.skipped}
                {bookOutlineJob.failed > 0 ? ` 失败${bookOutlineJob.failed}` : ''} · {bookJobPct}%
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, bookJobPct)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            className="icon-btn h-6 w-6 flex-shrink-0"
            title="取消后续章节（当前章会跑完）"
            onClick={cancelBookOutlineJob}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {!immersive && chapter && (
          <ChapterOutlinePanel
            chapter={chapter}
            currentSentenceIndex={currentSentenceIndex}
            record={record}
            loading={state?.loading}
            generating={state?.generating}
            progress={state?.progress}
            error={state?.error}
            collapsed={outlineCollapsed}
            onCollapsedChange={setOutlineCollapsed}
            onGenerate={generateOutline}
            onSelectSection={selectSection}
            onUpdateRecord={updateRecord}
            onRenameChapter={(title) => {
              if (currentBook) void renameChapter(currentBook.id, activeChapter, title)
            }}
            onRestoreChapter={() => {
              if (currentBook) void restoreChapterTitle(currentBook.id, activeChapter)
            }}
            chapterOriginalTitle={persistedChapter?.originalTitle}
            chapterCustomTitle={persistedChapter?.customTitle}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <ContentCards
            chapter={chapter}
            sentences={sentences}
            currentSentenceIndex={currentSentenceIndex}
            onSpeakRaw={onSpeakRaw}
            onStopRaw={onStopRaw}
            onSeekToSentence={seekOnly}
            onPlayFromSentence={playFrom}
            onGenerateBookOutlines={() => {
              void generateBookOutlines({ force: false })
            }}
            onForceGenerateBookOutlines={() => {
              void generateBookOutlines({ force: true })
            }}
            bookOutlineRunning={Boolean(bookOutlineJob)}
          />
          {!immersive && (
            <div className="flex flex-shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-3 py-1.5 dark:border-dark-border dark:bg-dark-surface">
              {hasMultipleChapters ? (
                <>
                  <button
                    type="button"
                    disabled={activeChapter === 0}
                    onClick={() => navigateToChapter(activeChapter - 1)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span className="max-w-[8rem] truncate sm:max-w-[10rem]">
                      {structure[activeChapter - 1]?.title || '上一章'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={activeChapter === structure.length - 1}
                    onClick={() => navigateToChapter(activeChapter + 1)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 disabled:opacity-30"
                  >
                    <span className="max-w-[8rem] truncate sm:max-w-[10rem]">
                      {structure[activeChapter + 1]?.title || '下一章'}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-gray-400">正文</span>
              )}
              <div className="flex-1" />
              <span
                data-reader-char-count="true"
                className="flex-shrink-0 tabular-nums text-[10px] text-gray-400 dark:text-gray-500"
                title={
                  chapterCharCount > 50000
                    ? '本章超过 5 万字，对话不注入本章正文（仍会检索）'
                    : '本章字数 / 全书字数（注入按本章 ≤5 万）'
                }
              >
                本章 {fmtCount(chapterCharCount)} / 全书 {fmtCount(bookCharCount)}
                {chapterCharCount > 50000 ? (
                  <span className="ml-1 text-amber-500/80">·本章超5万</span>
                ) : null}
              </span>
            </div>
          )}
        </main>
        <div data-ai-chat-host="mounted" className={aiPanelOpen && !immersive ? 'contents' : 'hidden'} aria-hidden={!aiPanelOpen || immersive}><AiChatPanel onSpeakRaw={onSpeakRaw} onStopRaw={onStopRaw} /></div>
      </div>
      {chapterDropdownOpen && <div className="fixed inset-0 z-[99]" onClick={() => setChapterDropdownOpen(false)} />}
    </div>
  )
}

export default function AiReaderView(props: AiReaderViewProps) {
  const currentBook = useBookStore((state) => state.currentBook)
  const sentences = useBookStore((state) => state.sentences)
  const isLoading = useBookStore((state) => state.isLoading)
  const currentSentenceIndex = usePlayerStore((state) => state.currentSentenceIndex)
  return <AiReaderContent {...props} currentBook={currentBook} sentences={sentences} currentSentenceIndex={currentSentenceIndex} isLoading={isLoading} />
}
