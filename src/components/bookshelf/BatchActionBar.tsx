import { Download, ListTree, RefreshCw, Trash2, Upload, X } from 'lucide-react'

interface Progress {
  done: number
  total: number
}

interface Props {
  selectedCount: number
  allSelected: boolean
  reprocessProgress: Progress | null
  reparseProgress: Progress | null
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchReprocess: () => void
  onBatchReparse: () => void
  onMigrateAllChapters?: () => void
  onBatchExportBookmarks: () => void
  onBatchExportAudio: () => void
  onBatchDelete: () => void
}

export default function BatchActionBar({
  selectedCount,
  allSelected,
  reprocessProgress,
  reparseProgress,
  onSelectAll,
  onClearSelection,
  onBatchReprocess,
  onBatchReparse,
  onMigrateAllChapters,
  onBatchExportBookmarks,
  onBatchExportAudio,
  onBatchDelete
}: Props) {
  if (selectedCount <= 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 dark:bg-primary/10 border-b border-primary/20 flex-shrink-0 text-sm">
      <span className="font-medium text-primary">
        已选 <span className="text-base">{selectedCount}</span> 本
      </span>
      <div className="flex-1" />
      <button
        onClick={allSelected ? onClearSelection : onSelectAll}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors"
      >
        {allSelected ? '取消全选' : '全选'}
      </button>
      <button
        onClick={onClearSelection}
        className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
      >
        <X className="w-3 h-3" /> 清空
      </button>
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
      <button
        onClick={onBatchReprocess}
        disabled={reprocessProgress !== null}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-3 h-3 ${reprocessProgress ? 'animate-spin' : ''}`} />
        {reprocessProgress ? `清理中 ${reprocessProgress.done}/${reprocessProgress.total}` : '批量清理'}
      </button>
      <button
        onClick={onBatchReparse}
        disabled={reparseProgress !== null}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        title="按新「原始」规则重切选中书的章节"
      >
        <ListTree className={`w-3 h-3 ${reparseProgress ? 'animate-spin' : ''}`} />
        {reparseProgress ? `迁移中 ${reparseProgress.done}/${reparseProgress.total}` : '迁移分章'}
      </button>
      {onMigrateAllChapters && (
        <button
          onClick={onMigrateAllChapters}
          disabled={reparseProgress !== null}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="全部旧书按新「原始」规则重切"
        >
          <ListTree className="w-3 h-3" />
          迁移全部
        </button>
      )}
      <button
        onClick={onBatchExportBookmarks}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
      >
        <Upload className="w-3 h-3" /> 导出书签
      </button>
      <button
        onClick={onBatchExportAudio}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
      >
        <Download className="w-3 h-3" /> 导出音频
      </button>
      <button
        onClick={onBatchDelete}
        className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex items-center gap-1"
      >
        <Trash2 className="w-3 h-3" /> 删除
      </button>
    </div>
  )
}
