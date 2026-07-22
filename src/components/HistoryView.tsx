import { useEffect, useMemo, useState } from 'react'
import { History as HistoryIcon, Trash2, Play, BookOpen, FileText } from 'lucide-react'
import { useHistoryStore } from '../stores/historyStore'
import { useBookStore } from '../stores/bookStore'
import { usePlayerStore } from '../stores/playerStore'
import type { BookData, HistoryEntry } from '../global'

interface HistoryViewProps {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  onContinueReading: (
    book: BookData,
    sentenceIndex: number,
    range: { start: number; end: number } | null
  ) => void
}

type TimeRange = 'all' | 'today' | '7days' | '30days'

export default function HistoryView({ showToast, onContinueReading }: HistoryViewProps) {
  const { history, loadHistory, clearHistory, getTotalDurationSeconds, getActiveDays } =
    useHistoryStore()
  const { books, setCurrentView } = useBookStore()
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [filterFormat, setFilterFormat] = useState<string>('all')

  // Reload when navigating to this tab
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Filter
  const filtered = useMemo(() => {
    let result = history
    const now = Date.now()
    if (timeRange === 'today') {
      const start = new Date().setHours(0, 0, 0, 0)
      result = result.filter((h) => new Date(h.startTime).getTime() >= start)
    } else if (timeRange === '7days') {
      result = result.filter((h) => new Date(h.startTime).getTime() >= now - 7 * 86400000)
    } else if (timeRange === '30days') {
      result = result.filter((h) => new Date(h.startTime).getTime() >= now - 30 * 86400000)
    }
    if (filterFormat !== 'all') {
      result = result.filter((h) => {
        const book = books.find((b) => b.id === h.bookId)
        return book?.format === filterFormat
      })
    }
    return result
  }, [history, timeRange, filterFormat, books])

  // Available formats from books with history
  const historyFormats = useMemo(() => {
    const fmts = new Set<string>()
    history.forEach((h) => {
      const b = books.find((bk) => bk.id === h.bookId)
      if (b?.format) fmts.add(b.format)
    })
    return Array.from(fmts)
  }, [history, books])

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const h of filtered) {
      const d = new Date(h.startTime)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      let label: string
      if (d.toDateString() === today.toDateString()) label = '今天'
      else if (d.toDateString() === yesterday.toDateString()) label = '昨天'
      else label = `${d.getMonth() + 1}月${d.getDate()}日`
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(h)
    }
    return Array.from(map.entries())
  }, [filtered])

  const totalSec = getTotalDurationSeconds()
  const activeDays = getActiveDays()
  const hasData = history.length > 0

  const fmtDuration = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0 && m > 0) return `${h}h${m}m`
    if (h > 0) return `${h}h`
    return `${m}m`
  }

  const fmtTime = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  const handleContinue = (entry: HistoryEntry) => {
    const book = books.find((b) => b.id === entry.bookId)
    if (!book) {
      showToast('error', '找不到对应书籍')
      return
    }
    const idx = entry.endSentenceIndex ?? entry.startSentenceIndex
    // Default to system TTS (Edge), user can switch to Qwen later
    const player = usePlayerStore.getState()
    if (player.ttsEngine === 'qwen' && !player.useSystemTTS) {
      player.setUseSystemTTS(true)
    }
    onContinueReading(book, idx, entry.sentenceRange ?? null)
  }

  const handleClear = () => {
    if (confirm('确定要清空全部历史记录吗？此操作不可撤销。')) {
      clearHistory()
      showToast('success', '历史记录已清空')
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-dark-bg overflow-hidden">
      {/* Stats bar */}
      <div className="flex items-center gap-6 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">累计收听</p>
          <p className="text-lg font-bold text-primary">{fmtDuration(totalSec)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">活跃天数</p>
          <p className="text-lg font-bold text-gray-700 dark:text-gray-200">{activeDays} 天</p>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          disabled={!hasData}
          title={hasData ? '清空历史' : '暂无历史记录，无需清空'}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          清空历史
        </button>
      </div>

      {/* Filter bar — hidden when no data */}
      {hasData && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {(['all', 'today', '7days', '30days'] as TimeRange[]).map((k) => (
              <button
                key={k}
                onClick={() => setTimeRange(k)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  timeRange === k
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {{ all: '全部', today: '今天', '7days': '7天', '30days': '30天' }[k]}
              </button>
            ))}
          </div>
          {historyFormats.length > 0 && (
            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-300"
            >
              <option value="all">全部格式</option>
              {historyFormats.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-3">
            <HistoryIcon className="w-16 h-16 opacity-30" />
            <p className="text-lg">还没有收听记录</p>
            <p className="text-sm">开始朗读一本书，或导入文本生成记录</p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setCurrentView('shelf')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
              >
                <BookOpen className="w-4 h-4" /> 去书架
              </button>
              <button
                onClick={() => setCurrentView('quicktext')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <FileText className="w-4 h-4" /> 快速文本
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(([day, entries]) => (
              <div key={day}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs text-gray-400 px-2">{day}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="flex flex-col gap-2">
                  {entries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-sm transition-shadow"
                    >
                      <div className="flex-shrink-0 text-xs text-gray-400 w-16">
                        {fmtTime(e.startTime)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                            {e.bookTitle}
                          </span>
                          <span className="text-xs text-gray-400 truncate">{e.chapterTitle}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                          {e.contentPreview}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          第 {e.startSentenceIndex + 1} →{' '}
                          {e.endSentenceIndex != null ? e.endSentenceIndex + 1 : '?'} 句 ·{' '}
                          {fmtDuration(e.durationSeconds)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleContinue(e)}
                        className="p-1.5 text-primary hover:bg-primary/10 rounded flex-shrink-0"
                        title="继续播放"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
