import { useEffect, useRef, useState } from 'react'
import {
  Download,
  FolderPlus,
  FolderInput,
  RefreshCw,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { CustomAlbum } from '../../global'
import { isFavoritesAlbum, sortAlbumsForDisplay } from '../../utils/albumUtils'

interface Progress {
  done: number
  total: number
}

interface Props {
  selectedCount: number
  allSelected: boolean
  multiSelectMode: boolean
  reprocessProgress: Progress | null
  albums: CustomAlbum[]
  activeAlbumId: string | null
  onSelectAll: () => void
  /** 清空勾选但保持多选模式 */
  onClearSelection: () => void
  /** 退出多选模式 */
  onExitSelection: () => void
  onBatchReprocess: () => void
  onBatchExportBookmarks: () => void
  onBatchExportAudio: () => void
  onBatchDelete: () => void
  /** 把选中书加入已有专辑 */
  onAddToAlbum: (albumId: string) => void
  /** 新建专辑并把选中书放进去 */
  onCreateAlbumWithSelected: (title: string) => void
  /** 当前在专辑内时，批量移出 */
  onRemoveFromCurrentAlbum?: () => void
}

export default function BatchActionBar({
  selectedCount,
  allSelected,
  multiSelectMode,
  reprocessProgress,
  albums,
  activeAlbumId,
  onSelectAll,
  onClearSelection,
  onExitSelection,
  onBatchReprocess,
  onBatchExportBookmarks,
  onBatchExportAudio,
  onBatchDelete,
  onAddToAlbum,
  onCreateAlbumWithSelected,
  onRemoveFromCurrentAlbum
}: Props) {
  const [albumMenuOpen, setAlbumMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!multiSelectMode) {
      setAlbumMenuOpen(false)
      setCreating(false)
      setNewTitle('')
    }
  }, [multiSelectMode])

  useEffect(() => {
    if (!albumMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAlbumMenuOpen(false)
        setCreating(false)
        setNewTitle('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [albumMenuOpen])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  if (!multiSelectMode) return null

  const otherAlbums = sortAlbumsForDisplay(albums.filter((a) => a.id !== activeAlbumId))

  const submitCreate = () => {
    const title = newTitle.trim()
    if (!title) return
    onCreateAlbumWithSelected(title)
    setCreating(false)
    setNewTitle('')
    setAlbumMenuOpen(false)
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 dark:bg-primary/10 border-b border-primary/20 flex-shrink-0 text-sm">
      <button
        type="button"
        onClick={onExitSelection}
        className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
        title="退出多选"
      >
        <X className="w-3.5 h-3.5" /> 退出
      </button>
      <span className="font-medium text-primary">
        已选 <span className="text-base">{selectedCount}</span> 本
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={allSelected ? onClearSelection : onSelectAll}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors"
      >
        {allSelected ? '取消全选' : '全选'}
      </button>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => {
            setAlbumMenuOpen((v) => !v)
            setCreating(false)
            setNewTitle('')
          }}
          disabled={selectedCount === 0}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="把选中书籍加入专辑"
        >
          <FolderInput className="w-3 h-3" /> 加入专辑
        </button>
        {albumMenuOpen && (
          <div className="absolute right-0 top-full mt-1 z-40 w-56 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl py-1">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-primary hover:bg-primary/5"
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新建专辑并放入…
            </button>
            {creating && (
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 space-y-2">
                <input
                  ref={inputRef}
                  value={newTitle}
                  maxLength={40}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitCreate()
                    }
                    if (e.key === 'Escape') {
                      setCreating(false)
                      setNewTitle('')
                    }
                  }}
                  placeholder="专辑名称"
                  className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setNewTitle('')
                    }}
                    className="px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitCreate}
                    disabled={!newTitle.trim()}
                    className="px-2 py-0.5 text-[11px] bg-primary text-[rgb(var(--on-primary-rgb))] rounded disabled:opacity-50"
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
            {otherAlbums.length === 0 && !creating && (
              <p className="px-3 py-2 text-[11px] text-gray-400">暂无其他专辑，可新建</p>
            )}
            {otherAlbums.map((album) => (
              <button
                key={album.id}
                type="button"
                onClick={() => {
                  onAddToAlbum(album.id)
                  setAlbumMenuOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 truncate"
                title={album.title}
              >
                {isFavoritesAlbum(album) ? (
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                ) : null}
                <span className="truncate">{album.title}</span>
                <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">
                  {album.items.filter((i) => i.resourceType === 'book').length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {onRemoveFromCurrentAlbum && (
        <button
          type="button"
          onClick={onRemoveFromCurrentAlbum}
          disabled={selectedCount === 0}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          移出专辑
        </button>
      )}

      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
      <button
        type="button"
        onClick={onBatchReprocess}
        disabled={reprocessProgress !== null || selectedCount === 0}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-3 h-3 ${reprocessProgress ? 'animate-spin' : ''}`} />
        {reprocessProgress
          ? `清理中 ${reprocessProgress.done}/${reprocessProgress.total}`
          : '批量清理'}
      </button>
      <button
        type="button"
        onClick={onBatchExportBookmarks}
        disabled={selectedCount === 0}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Upload className="w-3 h-3" /> 导出书签
      </button>
      <button
        type="button"
        onClick={onBatchExportAudio}
        disabled={selectedCount === 0}
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-3 h-3" /> 导出音频
      </button>
      <button
        type="button"
        onClick={onBatchDelete}
        disabled={selectedCount === 0}
        className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3 h-3" /> 删除
      </button>
    </div>
  )
}
