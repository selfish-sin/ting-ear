import { useState, useMemo, useCallback, useRef, useTransition, useEffect } from 'react'
import { X, BookOpen, Combine, History, ChevronRight, ChevronLeft } from 'lucide-react'
import type { Chapter, ChapterMode, EditRecord } from '../global'
import {
  buildPseudoChapters,
  buildDisplayChapters,
  resolveSourceBoundaries,
  loadPlayPref,
  savePlayPref,
  validatePlayPref,
  chaptersInRange,
  versionSentenceCount
} from '../utils/bookData'

interface RangeSelectorProps {
  chapters: Chapter[]
  /** 书签/目录原料边界；缺省则从 chapters 反推 */
  sourceBoundaries?: Array<{ title: string; sentenceIndex: number; depth?: number }>
  /** 书当前入库的分章模式（用于默认开关） */
  chapterMode?: ChapterMode
  editHistory?: EditRecord[]
  sentenceCount?: number
  /** 导入时的真·原文（选「原始版本」时使用） */
  originalSentences?: string[]
  /** 当前书 id：用于按书持久化预选偏好（模式/版本/章节范围） */
  bookId?: string
  /** 初始页：0=版本选择（默认），1=章节选择（跳过版本页直接选章） */
  initialPage?: 0 | 1
  onConfirm: (
    range: { start: number; end: number } | null,
    activeChapters: Chapter[],
    recordId?: string,
    chapterMode?: ChapterMode
  ) => void
  onCancel: () => void
}

/** 虚拟列表行高（与 py-2 + 文本行 约一致） */
const ROW_H = 40
const VIEWPORT_H = 260
const OVERSCAN = 6

export default function RangeSelector({
  chapters,
  sourceBoundaries,
  chapterMode,
  editHistory,
  sentenceCount,
  originalSentences,
  bookId,
  initialPage = 0,
  onConfirm,
  onCancel
}: RangeSelectorProps) {
  const [page, setPage] = useState(initialPage)
  const [isPending, startTransition] = useTransition()
  const pref = useMemo(() => loadPlayPref(bookId), [bookId])

  // 仅用 length 做校验，绝不 new Array(sentenceCount)（大书会卡死）
  const prefBook = useMemo(
    () => ({
      editHistory,
      originalSentences,
      sentences: { length: sentenceCount || originalSentences?.length || 0 } as string[]
    }),
    [editHistory, originalSentences, sentenceCount]
  )

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => {
    if (pref.recordId !== undefined && validatePlayPref(pref, prefBook)) return pref.recordId
    return editHistory && editHistory.length > 0 ? editHistory[editHistory.length - 1].id : null
  })

  const recordItems = useMemo(() => {
    const total =
      (originalSentences && originalSentences.length) ||
      sentenceCount ||
      chapters.reduce((s, c) => s + c.sentenceCount, 0)
    type Item = {
      key: string
      label: string
      type: 'original' | 'ai-clean' | 'trim-spaces' | 'manual' | string
      count: number
      extra: string
    }
    const items: Item[] = [
      {
        key: '__original__',
        label: '原始版本',
        type: 'original',
        count: total,
        extra: `${chapters.length} 章`
      }
    ]
    for (const r of editHistory || []) {
      items.push({
        key: r.id,
        label: r.label,
        type: r.type,
        count: r.sentenceCount,
        extra: `${r.sentenceCount} 句`
      })
    }
    return items
  }, [editHistory, chapters, originalSentences, sentenceCount])

  const activeRecord = editHistory?.find((r) => r.id === selectedRecordId) || null
  const activeSentenceCount = activeRecord
    ? activeRecord.sentenceCount || activeRecord.sentences.length
    : originalSentences?.length || sentenceCount || 0

  const boundaries = useMemo(
    () => resolveSourceBoundaries({ sourceBoundaries, chapters }),
    [sourceBoundaries, chapters]
  )

  const [mode, setMode] = useState<ChapterMode>(() => {
    if (pref.merged === true) return 'merged'
    if (pref.merged === false) return 'original'
    if (chapterMode === 'merged' || chapterMode === 'original') return chapterMode
    return 'original'
  })

  /**
   * 一次算好 original + merged，切换模式只换指针，不再同步重算。
   * 大书首次进入章节页时算一次；编辑记录版本另算。
   */
  const chapterSets = useMemo(() => {
    if (activeRecord) {
      const pseudo = buildPseudoChapters(activeRecord.sentences)
      const merged = buildDisplayChapters(
        activeSentenceCount,
        pseudo.map((c) => ({ title: c.title, sentenceIndex: c.startIndex })),
        'merged'
      )
      return { original: pseudo, merged }
    }
    return {
      original: buildDisplayChapters(activeSentenceCount, boundaries, 'original'),
      merged: buildDisplayChapters(activeSentenceCount, boundaries, 'merged')
    }
  }, [activeRecord, activeSentenceCount, boundaries])

  const displayChapters = mode === 'merged' ? chapterSets.merged : chapterSets.original
  const originalCount = chapterSets.original.length

  const restoreFromPref = useCallback(
    (list: Chapter[]): Set<number> => {
      const valid = validatePlayPref(pref, prefBook)
      if (!valid?.range) return new Set()
      if (versionSentenceCount(selectedRecordId, prefBook) !== valid.ver) return new Set()
      return chaptersInRange(list, valid.range)
    },
    [pref, prefBook, selectedRecordId]
  )

  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(() => new Set())
  const allSelected = selectedChapters.size > 0 && selectedChapters.size === displayChapters.length

  // 虚拟列表滚动
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const switchMode = (next: ChapterMode) => {
    if (next === mode) return
    // 先让按钮立刻响应，重列表渲染放 transition
    startTransition(() => {
      setMode(next)
      setSelectedChapters(new Set())
      setScrollTop(0)
      if (listRef.current) listRef.current.scrollTop = 0
    })
  }

  const goToChapters = () => {
    const list = mode === 'merged' ? chapterSets.merged : chapterSets.original
    setSelectedChapters(restoreFromPref(list))
    setScrollTop(0)
    setPage(1)
  }

  // 进入章节页时若尚未勾选，尝试恢复
  useEffect(() => {
    if (page !== 1) return
    if (selectedChapters.size > 0) return
    const restored = restoreFromPref(displayChapters)
    if (restored.size > 0) setSelectedChapters(restored)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = () => {
    if (selectedChapters.size === 0) return
    let minStart = Infinity
    let maxEnd = 0
    for (const idx of selectedChapters) {
      const ch = displayChapters[idx]
      if (!ch) continue
      minStart = Math.min(minStart, ch.startIndex)
      maxEnd = Math.max(maxEnd, ch.startIndex + ch.sentenceCount)
    }
    if (minStart < Infinity) {
      savePlayPref(bookId, {
        merged: mode === 'merged',
        recordId: selectedRecordId,
        range: { start: minStart, end: maxEnd },
        ver: activeSentenceCount
      })
      onConfirm(
        { start: minStart, end: maxEnd },
        displayChapters,
        selectedRecordId || undefined,
        mode
      )
    }
  }

  const toggleChapter = useCallback((idx: number) => {
    setSelectedChapters((prev) => {
      const n = new Set(prev)
      if (n.has(idx)) n.delete(idx)
      else n.add(idx)
      return n
    })
  }, [])

  const total = displayChapters.length
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const visibleCount = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2
  const endIdx = Math.min(total, startIdx + visibleCount)
  const topPad = startIdx * ROW_H
  const bottomPad = Math.max(0, (total - endIdx) * ROW_H)

  // ======== PAGE 0: 编辑记录 ========
  if (page === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onCancel}
      >
        <div
          className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">编辑记录</h2>
            </div>
            <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-5 py-3 max-h-80 overflow-y-auto space-y-1">
            {recordItems.map((item) => (
              <label
                key={item.key}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                  selectedRecordId === item.key ||
                  (!selectedRecordId && item.key === '__original__')
                    ? 'bg-primary/5 border border-primary/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'
                }`}
              >
                <input
                  type="radio"
                  name="editRecord"
                  checked={
                    selectedRecordId === item.key ||
                    (!selectedRecordId && item.key === '__original__')
                  }
                  onChange={() =>
                    setSelectedRecordId(item.key === '__original__' ? null : item.key)
                  }
                  className="w-3.5 h-3.5 text-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-200">{item.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                        item.type === 'ai-clean'
                          ? 'bg-purple-100 text-purple-700'
                          : item.type === 'trim-spaces'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {item.type === 'ai-clean'
                        ? 'AI'
                        : item.type === 'trim-spaces'
                          ? '空格'
                          : item.type === 'manual'
                            ? '手动'
                            : '原文'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{item.extra}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              取消
            </button>
            <button
              onClick={goToChapters}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-primary text-[rgb(var(--on-primary-rgb))] rounded-lg hover:bg-primary/90"
            >
              下一页 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ======== PAGE 1: 章节选择 ========
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">选择章节</h2>
            {isPending && (
              <span className="text-[10px] text-gray-400 animate-pulse">切换中…</span>
            )}
          </div>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">
              {mode === 'merged'
                ? `原始 ${originalCount} 章 → 合并 ${displayChapters.length} 章`
                : `${displayChapters.length} 章（原始）`}
            </p>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => switchMode('original')}
                  className={`px-2 py-0.5 ${
                    mode === 'original'
                      ? 'bg-primary text-[rgb(var(--on-primary-rgb))]'
                      : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  原始
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('merged')}
                  className={`px-2 py-0.5 flex items-center gap-0.5 ${
                    mode === 'merged'
                      ? 'bg-primary text-[rgb(var(--on-primary-rgb))]'
                      : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <Combine className="w-3 h-3" />
                  合并
                </button>
              </div>
              <button
                onClick={() =>
                  allSelected
                    ? setSelectedChapters(new Set())
                    : setSelectedChapters(new Set(displayChapters.map((_, i) => i)))
                }
                className="text-xs text-primary hover:underline"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
          </div>

          {/* 虚拟列表：只渲染可视区 + overscan，上千章也不卡 */}
          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ height: VIEWPORT_H }}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            <div style={{ height: topPad }} />
            {displayChapters.slice(startIdx, endIdx).map((ch, offset) => {
              const idx = startIdx + offset
              return (
                <label
                  key={`${ch.startIndex}-${idx}`}
                  className="flex items-center gap-3 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  style={{ height: ROW_H }}
                >
                  <input
                    type="checkbox"
                    checked={selectedChapters.has(idx)}
                    onChange={() => toggleChapter(idx)}
                    className="w-4 h-4 rounded border-gray-300 text-primary"
                  />
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 truncate">
                    {ch.title}
                  </span>
                  <span className="text-xs text-gray-400">{ch.sentenceCount}句</span>
                </label>
              )
            })}
            <div style={{ height: bottomPad }} />
          </div>

          {selectedChapters.size > 0 && (
            <p className="text-xs text-primary mt-2">
              已选 {selectedChapters.size}/{displayChapters.length}
            </p>
          )}
        </div>
        <div className="flex justify-between gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => setPage(0)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" /> 上一页
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedChapters.size === 0}
            className={`px-4 py-1.5 text-sm rounded-lg ${selectedChapters.size === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-primary text-[rgb(var(--on-primary-rgb))] hover:bg-primary/90'}`}
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
