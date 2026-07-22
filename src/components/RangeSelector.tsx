import { useState, useMemo } from 'react'
import { X, BookOpen, Combine, History, ChevronRight, ChevronLeft } from 'lucide-react'
import type { Chapter, EditRecord } from '../global'
import {
  buildPseudoChapters,
  normalizeChapters,
  normalizeSentences,
  mergeSmallChapters,
  loadPlayPref,
  savePlayPref,
  validatePlayPref,
  chaptersInRange,
  versionSentenceCount
} from '../utils/bookData'

interface RangeSelectorProps {
  chapters: Chapter[]
  editHistory?: EditRecord[]
  sentenceCount?: number
  /** 导入时的真·原文（选「原始版本」时使用） */
  originalSentences?: string[]
  /** 当前书 id：用于按书持久化预选偏好（合并/版本/章节范围） */
  bookId?: string
  /** 初始页：0=版本选择（默认），1=章节选择（跳过版本页直接选章） */
  initialPage?: 0 | 1
  onConfirm: (
    range: { start: number; end: number } | null,
    activeChapters: Chapter[],
    recordId?: string
  ) => void
  onCancel: () => void
}

export default function RangeSelector({
  chapters,
  editHistory,
  sentenceCount,
  originalSentences,
  bookId,
  initialPage = 0,
  onConfirm,
  onCancel
}: RangeSelectorProps) {
  const [page, setPage] = useState(initialPage) // 0=编辑记录, 1=章节选择
  // 本书缓存的预选偏好（合并/版本/章节范围），用于自动恢复上次选择
  const pref = useMemo(() => loadPlayPref(bookId), [bookId])
  const prefBook = useMemo(
    () => ({
      editHistory,
      originalSentences,
      // 老书可能没有 originalSentences，用 sentenceCount 占位保证句数校验一致
      sentences: originalSentences?.length
        ? originalSentences
        : new Array<string>(sentenceCount || 0).fill('')
    }),
    [editHistory, originalSentences, sentenceCount]
  )
  // 默认选中「最新编辑记录」；若缓存的上次版本仍有效则沿用缓存
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => {
    if (pref.recordId !== undefined && validatePlayPref(pref, prefBook)) return pref.recordId
    return editHistory && editHistory.length > 0 ? editHistory[editHistory.length - 1].id : null
  })

  // 编辑记录列表（原始 + 所有处理版本）
  const recordItems = useMemo(() => {
    const total =
      (originalSentences && originalSentences.length) ||
      sentenceCount ||
      chapters.reduce((s, c) => s + c.sentenceCount, 0)
    const items = [
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
    ? normalizeSentences(activeRecord.sentences).length
    : originalSentences?.length || sentenceCount || 0
  const baseChapters = activeRecord
    ? buildPseudoChapters(activeRecord.sentences)
    : normalizeChapters(chapters, activeSentenceCount)

  // 章节选择：「合并」开关默认沿用本书上次的选择（持久化在 localStorage）
  const [merged, setMerged] = useState<boolean>(() => !!pref.merged)
  const displayChapters = useMemo(
    () => (merged ? mergeSmallChapters(baseChapters) : baseChapters),
    [merged, baseChapters]
  )

  // 从缓存范围恢复勾选（仅当版本句数没变时有效）
  const restoreFromPref = (): Set<number> => {
    const valid = validatePlayPref(pref, prefBook)
    if (!valid?.range) return new Set()
    if (versionSentenceCount(selectedRecordId, prefBook) !== valid.ver) return new Set()
    return chaptersInRange(displayChapters, valid.range)
  }
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(restoreFromPref)
  const allSelected = selectedChapters.size > 0 && selectedChapters.size === displayChapters.length

  const goToChapters = () => {
    // 已有勾选 → 保留（过滤越界项）；否则尝试从缓存恢复
    setSelectedChapters((prev) => {
      if (prev.size > 0) {
        const valid = new Set([...prev].filter((i) => i < displayChapters.length))
        if (valid.size > 0) return valid
      }
      return restoreFromPref()
    })
    setPage(1)
  }
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
    // 记住本书的完整预选（合并/版本/范围），下次打开自动沿用或直接跳过预选页
    if (minStart < Infinity) {
      savePlayPref(bookId, {
        merged,
        recordId: selectedRecordId,
        range: { start: minStart, end: maxEnd },
        ver: activeSentenceCount
      })
      onConfirm({ start: minStart, end: maxEnd }, displayChapters, selectedRecordId || undefined)
    }
  }

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
                          ? '剪切'
                          : '原始'}
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
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
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
          </div>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-3 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">
              {merged
                ? `${baseChapters.length}→${displayChapters.length}`
                : `${baseChapters.length} 章`}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setMerged((m) => !m)
                  setSelectedChapters(new Set())
                }}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${merged ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:text-primary'}`}
              >
                <Combine className="w-3 h-3" />
                合并
              </button>
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
          {displayChapters.map((ch, idx) => (
            <label
              key={idx}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedChapters.has(idx)}
                onChange={() =>
                  setSelectedChapters((prev) => {
                    const n = new Set(prev)
                    if (n.has(idx)) n.delete(idx)
                    else n.add(idx)
                    return n
                  })
                }
                className="w-4 h-4 rounded border-gray-300 text-primary"
              />
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 truncate">
                {ch.title}
              </span>
              <span className="text-xs text-gray-400">{ch.sentenceCount}句</span>
            </label>
          ))}
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
            className={`px-4 py-1.5 text-sm rounded-lg ${selectedChapters.size === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-primary text-white hover:bg-primary/90'}`}
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
