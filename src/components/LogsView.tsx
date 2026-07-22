import { useEffect, useMemo, useState, useRef } from 'react'
import {
  ScrollText,
  Trash2,
  RefreshCw,
  Search,
  ChevronDown
} from 'lucide-react'
import { useLogStore } from '../stores/logStore'

interface LogsViewProps {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

const LEVEL_CSS = {
  ERROR: 'text-red-600 dark:text-red-400',
  WARN: 'text-yellow-600 dark:text-yellow-400',
  INFO: 'text-blue-500 dark:text-blue-400',
  DEBUG: 'text-gray-400 dark:text-gray-500'
}

export default function LogsView({ showToast }: LogsViewProps) {
  const { logs, loadLogs, clearLogs, levelFilter, setLevelFilter, searchKeyword, setSearchKeyword, getFilteredLogs } =
    useLogStore()
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadLogs() }, [loadLogs])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [logs, autoScroll])

  // Track manual scroll — if user scrolls up, disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  const filteredLogs = getFilteredLogs()
  // Store sorts newest-first; we reverse for bottom-up chronological display
  const displayLogs = [...filteredLogs].reverse()

  const stats = useMemo(() => {
    const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 }
    const sourceCounts = new Map<string, number>()
    logs.forEach((l) => {
      counts[l.level]++
      sourceCounts.set(l.source, (sourceCounts.get(l.source) || 0) + 1)
    })
    const topSources = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
    return { counts, total: logs.length, topSources }
  }, [logs])

  const handleClear = () => {
    if (confirm('确定要清空所有日志吗？')) {
      clearLogs()
      showToast('success', '日志已清空')
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  const levels = [
    { key: 'ALL' as const, label: '全部' },
    { key: 'ERROR' as const, label: '错误' },
    { key: 'WARN' as const, label: '警告' },
    { key: 'INFO' as const, label: '信息' },
    { key: 'DEBUG' as const, label: '调试' }
  ]

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-dark-bg overflow-hidden">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {levels.map((lvl) => (
            <button
              key={lvl.key}
              onClick={() => setLevelFilter(lvl.key)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                levelFilter === lvl.key
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-gray-100'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {lvl.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" placeholder="搜索日志" value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          自动滚动
        </label>
        <button onClick={() => loadLogs()} className="p-1.5 text-gray-400 hover:text-primary rounded" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={handleClear} className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="清空日志">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Log body: raw plain-text lines */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed px-4 py-2 select-text"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <ScrollText className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">暂无日志</p>
          </div>
        ) : (
          displayLogs.map((log) => (
            <div key={log.id} className={LEVEL_CSS[log.level]}>
              <span className="text-gray-400 dark:text-gray-500">{fmt(log.timestamp)}</span>
              {' ['}<span className="font-semibold">{log.level}</span>{'] '}
              {log.source}: {log.message}
            </div>
          ))
        )}
      </div>

      {/* Bottom stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-[11px] flex-shrink-0">
        <span className="text-gray-400">
          共 <b className="text-gray-600 dark:text-gray-300">{stats.total}</b> 条
        </span>
        <span className={LEVEL_CSS.ERROR}>错误 {stats.counts.ERROR}</span>
        <span className={LEVEL_CSS.WARN}>警告 {stats.counts.WARN}</span>
        <span className={LEVEL_CSS.INFO}>信息 {stats.counts.INFO}</span>
        <span className={LEVEL_CSS.DEBUG}>调试 {stats.counts.DEBUG}</span>
        <span className="text-gray-300 dark:text-gray-600 mx-1">|</span>
        {stats.topSources.map(([src, n]) => (
          <span key={src} className="text-gray-400">{src}:{n}</span>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => {
            setAutoScroll(true)
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
          className={`flex items-center gap-1 hover:text-primary transition-colors ${autoScroll ? 'text-primary' : 'text-gray-400'}`}
          title={autoScroll ? '自动滚动中' : '点击滚动到底部'}
        >
          <ChevronDown className="w-3 h-3" />
          {autoScroll ? '自动' : '底部'}
        </button>
      </div>
    </div>
  )
}
