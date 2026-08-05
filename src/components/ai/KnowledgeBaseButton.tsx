import { useEffect, useState } from 'react'
import { Database, Loader2, RotateCw, Trash2 } from 'lucide-react'
import { useBookStore } from '../../stores/bookStore'
import { useSettingsStore } from '../../stores/settingsStore'

type BuildState = 'idle' | 'building' | 'built'

/**
 * AI 助手头部「每书固定」的本地知识库按钮（自取当前书与 embedding 配置）：
 * - 未建（idle）：灰色 DB 图标 → 点击建库 aiVecIngest
 * - 建中（building）：旋转图标 → 点击取消 aiVecCancel
 * - 已建（built）：高亮 DB 图标 → 点击展开「重建 / 删除」菜单
 *
 * 状态来源：ai:vec:status（exists/running）+ ai:vec:progress 事件流。
 * 进度条本身仍由 NmemBanner 渲染，本按钮只负责入口与状态。
 */
export default function KnowledgeBaseButton() {
  const book = useBookStore((state) => state.currentBook)
  const embedding = useSettingsStore((state) => state.settings.ai?.embedding)
  const embeddingConfigured = Boolean(embedding?.baseUrl?.trim() && embedding?.model?.trim())

  const [state, setState] = useState<BuildState>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bookId = book?.id

  // 拉取初始状态（切书时重算）
  useEffect(() => {
    let cancelled = false
    setMenuOpen(false)
    setError(null)
    if (!bookId) {
      setState('idle')
      return
    }
    void window.api.aiVecStatus(bookId).then((s) => {
      if (cancelled) return
      setState(s.running ? 'building' : s.exists ? 'built' : 'idle')
    })
    return () => {
      cancelled = true
    }
  }, [bookId])

  // 订阅进度事件：实时反映 building 态，完成/出错时刷新状态
  useEffect(() => {
    if (!bookId) return
    const unsub = window.api.onVecProgress((p) => {
      if (p.bookId !== bookId) return
      if (p.phase === 'done') {
        setState('built')
      } else if (p.phase === 'error') {
        setState((prev) => (prev === 'building' ? 'idle' : prev))
        if (p.error && p.error !== '已取消') setError(p.error)
      } else {
        // chunking / embedding / saving
        setState('building')
      }
    })
    return unsub
  }, [bookId])

  const handleBuild = () => {
    if (!book) return
    setError(null)
    setState('building')
    void window.api.aiVecIngest(book).then((r) => {
      if (!r.success) {
        setState('idle')
        setError(r.error || '建立失败')
      }
    })
  }

  const handleCancel = () => {
    if (!bookId) return
    void window.api.aiVecCancel(bookId)
    setState('idle')
  }

  const handleDelete = () => {
    if (!bookId) return
    setMenuOpen(false)
    if (!window.confirm('删除本书本地知识库？删除后全书检索将返回 0 条，可随时重建。')) return
    void window.api.aiVecDelete(bookId).then(() => setState('idle'))
  }

  const handleRebuild = () => {
    setMenuOpen(false)
    handleBuild()
  }

  if (!book) return null

  const disabled = state !== 'building' && !embeddingConfigured
  const title = !embeddingConfigured
    ? '未配置嵌入模型，请在设置 → 嵌入模型中填写'
    : state === 'building'
      ? '正在建立本地知识库，点击取消'
      : state === 'built'
        ? '本地知识库已建立，点击重建或删除'
        : error
          ? `上次失败：${error}（点击重试）`
          : '建立本书本地知识库（用于全书检索）'

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (state === 'building') handleCancel()
          else if (state === 'built') setMenuOpen((v) => !v)
          else handleBuild()
        }}
        className={
          state === 'built' || state === 'building'
            ? 'flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/15 disabled:opacity-40'
            : 'flex h-7 w-7 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40 dark:text-primary-300/80 dark:hover:bg-primary/15'
        }
        title={title}
      >
        {state === 'building' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <Database
            className={`h-3.5 w-3.5 ${state === 'built' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
          />
        )}
      </button>

      {menuOpen && (
        <>
          {/* 点击外部关闭 */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-9 z-50 w-28 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-dark-border dark:bg-gray-800">
            <button
              type="button"
              onClick={handleRebuild}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <RotateCw className="h-3.5 w-3.5" />
              重建
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
