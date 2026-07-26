import { CloudOff, Loader2, RefreshCw } from 'lucide-react'

interface NmemBannerProps {
  status: 'checking' | 'online' | 'offline'
  error?: string | null
  onRetry: () => Promise<void>
}

export default function NmemBanner({ status, error, onRetry }: NmemBannerProps) {
  if (status === 'online') return null

  if (status === 'checking') {
    return (
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-dark-border dark:bg-dark-muted dark:text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在连接知识库
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
      <CloudOff className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 flex-1" title={error || undefined}>
        知识库未连接，当前使用普通对话
      </span>
      <button
        type="button"
        onClick={() => void onRetry()}
        className="inline-flex flex-shrink-0 items-center gap-1 font-medium hover:text-amber-700 dark:hover:text-amber-100"
      >
        <RefreshCw className="h-3 w-3" />
        重新连接
      </button>
    </div>
  )
}
