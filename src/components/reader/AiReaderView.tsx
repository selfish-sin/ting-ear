import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Layers, ListChecks, Loader2, MessageSquareText } from 'lucide-react'
import { useBookStore } from '../../stores/bookStore'
import { usePlayerStore } from '../../stores/playerStore'
import type { Block, BookData, ChapterOutlineRecord, StructuredChapter } from '../../global'
import { chapterDisplayTitle, chapterKey } from '../../utils/bookData'
import ReaderHeader from './ReaderHeader'
import ChapterOutlinePanel from './ChapterOutlinePanel'
import ContentCards from './ContentCards'
import AiChatPanel from '../ai/AiChatPanel'

interface AiReaderViewProps {
  immersive?: boolean
  onSpeakRaw?: (text: string, onSentence?: (sentenceIndex: number, total: number) => void) => Promise<void>
  onStopRaw?: () => void
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
  onSeekToChapter,
  onReselectRange,
  onSelectVersion
}: AiReaderContentProps) {
  const structure = useMemo(() => currentBook?.structure?.length ? currentBook.structure : currentBook ? buildFallbackStructure(currentBook) : [], [currentBook])
  const [activeChapter, setActiveChapter] = useState(0)
  const [chapterRecords, setChapterRecords] = useState<Map<string, ChapterOutlineRecord>>(new Map())
  const [outlineStates, setOutlineStates] = useState<Record<string, { loading: boolean; error?: string }>>({})
  const [outlineCollapsed, setOutlineCollapsed] = useState(false)
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const userNavigatedRef = useRef(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const playState = usePlayerStore((state) => state.playState)
  const setCurrentSentenceIndex = usePlayerStore((state) => state.setCurrentSentenceIndex)
  const renameChapter = useBookStore((state) => state.renameChapter)
  const restoreChapterTitle = useBookStore((state) => state.restoreChapterTitle)

  useEffect(() => {
    if (structure.length === 0 || userNavigatedRef.current) return
    setActiveChapter(findChapterBySentence(structure, currentSentenceIndex))
  }, [currentSentenceIndex, structure])

  useEffect(() => {
    setActiveChapter(0)
    setChapterRecords(new Map())
    setOutlineStates({})
    userNavigatedRef.current = false
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

  useEffect(() => {
    if (!request || !window.api?.aiOutlineGet) return
    let cancelled = false
    setOutlineStates((state) => ({ ...state, [request.chapterKey]: { loading: true } }))
    window.api.aiOutlineGet(request).then((result) => {
      if (cancelled) return
      if (result.record) setChapterRecords((records) => new Map(records).set(request.chapterKey, result.record!))
      setOutlineStates((state) => ({ ...state, [request.chapterKey]: { loading: false, error: result.error } }))
    }).catch((error) => {
      if (!cancelled) setOutlineStates((state) => ({ ...state, [request.chapterKey]: { loading: false, error: error instanceof Error ? error.message : '大纲读取失败' } }))
    })
    return () => { cancelled = true }
  }, [request])

  const generateOutline = useCallback(() => {
    if (!request || !window.api?.aiOutlineGenerate) return
    const key = request.chapterKey
    setOutlineStates((state) => ({ ...state, [key]: { loading: true, error: undefined } }))
    window.api.aiOutlineGenerate(request).then((result) => {
      if (result.record) setChapterRecords((records) => new Map(records).set(key, result.record!))
      setOutlineStates((state) => ({ ...state, [key]: { loading: false, error: result.success ? undefined : result.error } }))
    }).catch((error) => setOutlineStates((state) => ({ ...state, [key]: { loading: false, error: error instanceof Error ? error.message : '大纲生成失败' } })))
  }, [request])

  const navigateToChapter = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(structure.length - 1, index))
    setActiveChapter(clamped)
    userNavigatedRef.current = true
    clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => { userNavigatedRef.current = false }, 3000)
    const start = structure[clamped]?.sentenceRange[0]
    if (start === undefined) return
    setCurrentSentenceIndex(start)
    onSeekToChapter?.(start)
  }, [structure, onSeekToChapter, setCurrentSentenceIndex])

  const selectSection = useCallback((startOffset: number) => {
    const globalStart = rangeStart + startOffset
    setCurrentSentenceIndex(globalStart)
    if (playState === 'playing') onSeekToChapter?.(globalStart)
  }, [rangeStart, setCurrentSentenceIndex, playState, onSeekToChapter])

  const updateRecord = useCallback((record: ChapterOutlineRecord) => {
    setChapterRecords((records) => new Map(records).set(record.chapterKey, record))
    void window.api?.aiOutlineUpdate(record)
  }, [])

  if (isLoading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="h-5 w-5 animate-spin text-primary" />正在加载文档</div>
  if (!currentBook || sentences.length === 0) return <div className="flex flex-1 items-center justify-center text-gray-400"><div className="text-center"><BookOpenText className="mx-auto mb-3 h-12 w-12 opacity-40" /><p className="text-sm">请从书架选择一本书开始阅读</p></div></div>

  const hasMultipleChapters = structure.length > 1
  const state = outlineStates[activeChapterKey]
  const record = chapterRecords.get(activeChapterKey)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface dark:bg-dark-bg">
      <ReaderHeader
        immersive={immersive}
        left={hasMultipleChapters ? <div className="relative"><button type="button" onClick={() => setChapterDropdownOpen((value) => !value)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"><span className="max-w-[12rem] truncate">{chapterTitle}</span><ChevronDown className="h-3 w-3 opacity-50" /></button>{chapterDropdownOpen && <div className="absolute left-0 top-full z-dropdown mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-raised">{structure.map((item, index) => <button key={`${item.sentenceRange[0]}-${index}`} type="button" onClick={() => { navigateToChapter(index); setChapterDropdownOpen(false) }} className={`flex w-full items-center px-3 py-1.5 text-left text-xs ${index === activeChapter ? 'bg-primary/10 font-medium text-primary' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5'}`}><span className="truncate">{item.title}</span></button>)}</div>}</div> : undefined}
        right={<><span className="mr-1 hidden truncate text-[11px] text-gray-400 lg:inline" style={{ maxWidth: '10rem' }}>{currentBook.title}</span>{onSelectVersion && <button type="button" onClick={() => onSelectVersion()} className="icon-btn" title="切换版本"><Layers className="h-4 w-4" /></button>}{onReselectRange && <button type="button" onClick={() => onReselectRange()} className="icon-btn" title="重选章节范围"><ListChecks className="h-4 w-4" /></button>}<button type="button" onClick={() => setAiPanelOpen((value) => !value)} className="icon-btn" title="AI 对话"><MessageSquareText className="h-4 w-4" /></button></>}
      />
      <div className="flex min-h-0 flex-1">
        {!immersive && chapter && <ChapterOutlinePanel chapter={chapter} currentSentenceIndex={currentSentenceIndex} record={record} loading={state?.loading} error={state?.error} collapsed={outlineCollapsed} onCollapsedChange={setOutlineCollapsed} onGenerate={generateOutline} onSelectSection={selectSection} onUpdateRecord={updateRecord} onRenameChapter={(title) => { if (currentBook) void renameChapter(currentBook.id, activeChapter, title) }} onRestoreChapter={() => { if (currentBook) void restoreChapterTitle(currentBook.id, activeChapter) }} chapterOriginalTitle={persistedChapter?.originalTitle} chapterCustomTitle={persistedChapter?.customTitle} />}
        <main className="flex min-w-0 flex-1 flex-col"><ContentCards chapter={chapter} sentences={sentences} currentSentenceIndex={currentSentenceIndex} onSpeakRaw={onSpeakRaw} onStopRaw={onStopRaw} onSeekToChapter={onSeekToChapter} />{hasMultipleChapters && !immersive && <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-200 bg-white px-4 py-1.5 dark:border-dark-border dark:bg-dark-surface"><button type="button" disabled={activeChapter === 0} onClick={() => navigateToChapter(activeChapter - 1)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /><span className="max-w-[10rem] truncate">{structure[activeChapter - 1]?.title || '上一章'}</span></button><button type="button" disabled={activeChapter === structure.length - 1} onClick={() => navigateToChapter(activeChapter + 1)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 disabled:opacity-30"><span className="max-w-[10rem] truncate">{structure[activeChapter + 1]?.title || '下一章'}</span><ChevronRight className="h-3.5 w-3.5" /></button></div>}</main>
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
