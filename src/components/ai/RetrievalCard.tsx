import { AlertCircle, Loader2, Search } from 'lucide-react'
import type { AiChatMessage, AiSourceRef } from '../../global'

interface RetrievalCardProps {
  status: NonNullable<AiChatMessage['retrievalStatus']>
  sources: AiSourceRef[]
  error?: string
}

export default function RetrievalCard({ status, sources, error }: RetrievalCardProps) {
  if (status === 'skipped') return null

  const isSearching = status === 'searching'
  const hasError = status === 'error'
  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-600 dark:border-dark-border dark:bg-dark-muted dark:text-gray-300">
      {isSearching ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
      ) : hasError ? (
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
      ) : (
        <Search className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
      )}
      <span>
        {isSearching
          ? '正在检索书内内容…'
          : hasError
            ? error || '书内检索失败，已改用本章正文与对话历史'
            : status === 'offline'
              ? '知识库未连接，已跳过书内检索'
              : sources.length > 0
                ? `找到 ${sources.length} 条书内来源`
                : '未找到相关书内片段（若本书未同步知识库属正常；仍可用本章正文回答）'}
      </span>
    </div>
  )
}
