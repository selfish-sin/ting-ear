import { useState } from 'react'
import { AlertCircle, BookOpen, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react'
import type { AiChatMessage, AiSourceRef } from '../../global'
import CitationPopover from './CitationPopover'

interface RetrievalCardProps {
  status: NonNullable<AiChatMessage['retrievalStatus']>
  sources: AiSourceRef[]
  error?: string
  onNavigateSource?: (source: AiSourceRef) => void
}

/**
 * 书内检索状态 + 可展开的具体来源条目列表。
 * 不再只显示「找到 N 条书内来源」。
 */
export default function RetrievalCard({
  status,
  sources,
  error,
  onNavigateSource = () => undefined
}: RetrievalCardProps) {
  const [expanded, setExpanded] = useState(sources.length > 0 && sources.length <= 3)

  if (status === 'skipped' && sources.length === 0) return null

  const isSearching = status === 'searching'
  const hasError = status === 'error'
  const hasSources = sources.length > 0

  const summaryText = isSearching
    ? '正在检索书内内容…'
    : hasError
      ? error || '书内检索失败，已改用本章正文与对话历史'
      : status === 'offline'
        ? '知识库未连接，已跳过书内检索'
        : hasSources
          ? `本轮引用 ${sources.length} 条书内记忆`
          : '未找到相关书内片段（若本书未同步知识库属正常；仍可用本章正文回答）'

  return (
    <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-600 dark:border-dark-border dark:bg-dark-muted dark:text-gray-300">
      <div className="flex items-start gap-2 px-2.5 py-2">
        {isSearching ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
        ) : hasError ? (
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
        ) : (
          <Search className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1">{summaryText}</span>
            {hasSources && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                title={expanded ? '收起来源' : '查看来源'}
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                查看来源
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && hasSources && (
        <ul className="space-y-1.5 border-t border-gray-200 px-2.5 py-2 dark:border-dark-border">
          {sources.map((source) => (
            <li
              key={`book-src-${source.index}-${source.memoryId}`}
              className="rounded-md border border-gray-100 bg-white/80 px-2 py-1.5 dark:border-dark-border dark:bg-dark-surface/60"
            >
              <div className="flex items-start gap-1.5">
                <BookOpen className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <CitationPopover source={source} onNavigate={onNavigateSource} />
                    <span className="font-medium text-gray-800 dark:text-gray-100">
                      {source.chapterTitle ||
                        (source.chapterIndex < 0 ? '全书' : `第 ${source.chapterIndex + 1} 章`)}
                    </span>
                    {source.chapterIndex >= 0 && (
                      <span className="text-[10px] text-gray-400">
                        章节索引 {source.chapterIndex}
                      </span>
                    )}
                    {Number.isFinite(source.score) && source.score > 0 && (
                      <span className="text-[10px] text-gray-400">
                        相关度 {(source.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                    {source.content}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigateSource(source)}
                    className="mt-1 text-[10px] font-medium text-primary hover:opacity-80"
                  >
                    定位原文
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
