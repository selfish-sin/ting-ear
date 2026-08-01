import { useEffect, useRef, useState } from 'react'
import { CloudOff, Database, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import type { AiBookIngestStatus } from '../../global'
import { useBookStore } from '../../stores/bookStore'

interface NmemBannerProps {
  status: 'checking' | 'online' | 'offline'
  error?: string | null
  bookIngestStatus?: AiBookIngestStatus['status'] | 'checking'
  bookIngestError?: string | null
  /** 仅在用户主动点「同步本书」时为 true，自动后台 ingest 不显示远程进度条 */
  nmemManualSyncing?: boolean
  onRetry: () => Promise<void>
  onSyncBook?: () => Promise<boolean>
}

interface VecProgress {
  bookId: string
  phase: 'chunking' | 'embedding' | 'saving' | 'done' | 'error'
  current: number
  total: number
  totalChunks: number
  error?: string
}

function formatEta(ms: number): string {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `约 ${s}s`
  const m = Math.floor(s / 60)
  return `约 ${m}m${s % 60 ? ` ${s % 60}s` : ''}`
}

/**
 * 知识库横幅（统一 nmem + 本地向量）：
 * - 服务离线且无本地向量 → 提示
 * - 本书未同步 → 同步本书按钮（同时触发 nmem + 本地向量）
 * - 同步中 / 本地向量化中 → 组合进度（真实进度条 + 不确定进度条 + ETA + 取消）
 * 全部就绪时不显示。
 */
export default function NmemBanner({
  status,
  error,
  bookIngestStatus = 'none',
  bookIngestError = null,
  nmemManualSyncing = false,
  onRetry,
  onSyncBook
}: NmemBannerProps) {
  const currentBookId = useBookStore((s) => s.currentBook?.id)
  const [vecProgress, setVecProgress] = useState<VecProgress | null>(null)
  const embedStartRef = useRef<number>(0)
  const [eta, setEta] = useState<string>('')

  useEffect(() => {
    const unsub = window.api.onVecProgress((p) => {
      if (p.bookId !== currentBookId) return
      if (p.phase === 'done' || p.phase === 'error') {
        setVecProgress(null)
        setEta('')
        embedStartRef.current = 0
      } else {
        // embedding 阶段计算 ETA
        if (p.phase === 'embedding' && p.total > 0) {
          if (!embedStartRef.current) embedStartRef.current = Date.now()
          const elapsed = Date.now() - embedStartRef.current
          if (p.current > 0 && elapsed > 2000) {
            const remaining = (elapsed / p.current) * (p.total - p.current)
            setEta(formatEta(remaining))
          }
        } else {
          setEta('')
        }
        setVecProgress(p)
      }
    })
    return unsub
  }, [currentBookId])

  // 切书时重置 ETA
  useEffect(() => {
    embedStartRef.current = 0
    setEta('')
  }, [currentBookId])

  const vecBuilding = vecProgress !== null
  const vecPct = vecProgress && vecProgress.total > 0
    ? Math.round((vecProgress.current / vecProgress.total) * 100)
    : 0
  // nmem 远程索引进度条只在用户「主动」同步时显示。
  // 自动后台 ingest（导入时 autoIngestBook / 探针 catchUp）虽会让 bookIngestStatus
  // 变 submitting/indexing，但不显示进度条——否则用户没点向量化按钮也会看到一个
  // 假加载界面，无法辨识是否真正向量化过。
  const nmemActive = nmemManualSyncing && (bookIngestStatus === 'submitting' || bookIngestStatus === 'indexing')

  const handleCancel = () => {
    if (currentBookId) void window.api.aiVecCancel(currentBookId)
  }

  if (status === 'checking' || bookIngestStatus === 'checking') {
    return (
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-dark-border dark:bg-dark-muted dark:text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在检查知识库…
      </div>
    )
  }

  // 进行中优先显示：本地向量化（真实进度）+ nmem 远程索引（不确定进度）组合
  // 必须在 offline / none / failed 之前，否则未同步到 nmem 的书做本地向量化时
  // 会被「none」分支截胡，进度条永远不显示。
  if (vecBuilding || nmemActive) {
    const phaseLabel = vecBuilding
      ? vecProgress.phase === 'chunking' ? '分块'
        : vecProgress.phase === 'saving' ? '保存向量'
        : '向量化'
      : null
    const chunkInfo = vecBuilding && vecProgress.totalChunks > 0
      ? vecProgress.phase === 'embedding'
        ? `${vecProgress.current}/${vecProgress.totalChunks} 块`
        : `共 ${vecProgress.totalChunks} 块`
      : ''

    return (
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-dark-border dark:bg-dark-muted">
        {/* 本地向量化：真实进度条 */}
        {vecBuilding && (
          <div className={nmemActive ? 'mb-1.5' : ''}>
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                本地知识库 · {phaseLabel}
                {chunkInfo ? ` · ${chunkInfo}` : ''}
                {eta ? ` · ${eta}` : ''}
              </span>
              {vecProgress.total > 0 && (
                <span className="flex-shrink-0 font-medium text-primary">{vecPct}%</span>
              )}
              <button
                type="button"
                onClick={handleCancel}
                title="取消本地索引"
                className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {vecProgress.total > 0 && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${vecPct}%` }}
                />
              </div>
            )}
          </div>
        )}
        {/* nmem 远程索引：不确定进度条 */}
        {nmemActive && (
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              {!vecBuilding && <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />}
              <span className="min-w-0 flex-1">
                {bookIngestStatus === 'submitting' ? '正在上传到远程知识库…' : '远程知识库索引中…'}
              </span>
            </div>
            {!vecBuilding && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-gray-400 dark:bg-gray-500" />
              </div>
            )}
          </div>
        )}
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

  return null
}
