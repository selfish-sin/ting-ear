import { CloudOff, Database, Loader2, RefreshCw, Upload } from 'lucide-react'
import type { AiBookIngestStatus } from '../../global'

interface NmemBannerProps {
  status: 'checking' | 'online' | 'offline'
  error?: string | null
  bookIngestStatus?: AiBookIngestStatus['status'] | 'checking'
  bookIngestError?: string | null
  onRetry: () => Promise<void>
  onSyncBook?: () => Promise<boolean>
}

/**
 * 知识库横幅：
 * - 服务离线
 * - 本书未同步 / 同步中 / 失败
 * 在线且本书 searchable 时不显示。
 */
export default function NmemBanner({
  status,
  error,
  bookIngestStatus = 'none',
  bookIngestError = null,
  onRetry,
  onSyncBook
}: NmemBannerProps) {
  if (status === 'checking' || bookIngestStatus === 'checking') {
    return (
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-dark-border dark:bg-dark-muted dark:text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在检查知识库…
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
        <CloudOff className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1" title={error || undefined}>
          知识库未连接，当前仅用本章正文 + 对话历史（无全书检索）
        </span>
        <button
          type="button"
          onClick={() => void onRetry()}
          className="inline-flex flex-shrink-0 items-center gap-1 font-medium hover:text-amber-700 dark:hover:text-amber-100"
        >
          <RefreshCw className="h-3 w-3" />
          重试
        </button>
      </div>
    )
  }

  // 服务在线，但本书未入库
  if (bookIngestStatus === 'none' || bookIngestStatus === 'failed') {
    return (
      <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200">
        <Database className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1" title={bookIngestError || undefined}>
          {bookIngestStatus === 'failed'
            ? `本书同步失败${bookIngestError ? `：${bookIngestError}` : ''}，检索可能为空`
            : '本书尚未同步到知识库，全书检索会返回 0 条；可先同步，或依赖本章正文作答'}
        </span>
        {onSyncBook && (
          <button
            type="button"
            onClick={() => void onSyncBook()}
            className="inline-flex flex-shrink-0 items-center gap-1 font-medium hover:text-sky-700 dark:hover:text-sky-100"
          >
            <Upload className="h-3 w-3" />
            同步本书
          </button>
        )}
      </div>
    )
  }

  if (bookIngestStatus === 'submitting' || bookIngestStatus === 'indexing') {
    return (
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-dark-border dark:bg-dark-muted dark:text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {bookIngestStatus === 'submitting' ? '正在上传本书到知识库…' : '知识库索引中，稍后可检索全书'}
      </div>
    )
  }

  return null
}
