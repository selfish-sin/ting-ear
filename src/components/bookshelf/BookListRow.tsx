import { CheckSquare, MoreHorizontal, Square, Star } from 'lucide-react'
import type { BookData } from '../../global'
import { FORMAT_BADGE_COLORS } from './shelfScale'

interface Props {
  book: BookData
  coverUrl?: string
  selected: boolean
  favorited: boolean
  multiSelectMode: boolean
  onToggleSelect: (id: string, e?: React.MouseEvent) => void
  onToggleFavorite: (id: string, e?: React.MouseEvent) => void
  onOpen: (book: BookData) => void
  onUploadCover: (book: BookData) => void
  onContextMenu: (e: React.MouseEvent<HTMLElement>, book: BookData) => void
  onMenuButtonClick: (e: React.MouseEvent<HTMLButtonElement>, book: BookData) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>, book: BookData) => void
  onCoverError?: (book: BookData) => void
  onSelectPointerDown: (id: string, e: React.PointerEvent) => void
  onSelectPointerEnter: (id: string) => void
  onSelectPointerUp: (id: string, e: React.PointerEvent) => void
}

export default function BookListRow({
  book,
  coverUrl,
  selected,
  favorited,
  multiSelectMode,
  onToggleSelect,
  onToggleFavorite,
  onOpen,
  onUploadCover,
  onContextMenu,
  onMenuButtonClick,
  onKeyDown,
  onCoverError,
  onSelectPointerDown,
  onSelectPointerEnter,
  onSelectPointerUp
}: Props) {
  return (
    <div
      data-book-id={book.id}
      onPointerDown={(e) => onSelectPointerDown(book.id, e)}
      onPointerEnter={() => onSelectPointerEnter(book.id)}
      onPointerUp={(e) => onSelectPointerUp(book.id, e)}
      onPointerCancel={(e) => onSelectPointerUp(book.id, e)}
      onClick={() => {
        if (multiSelectMode) onToggleSelect(book.id)
      }}
      onContextMenu={(e) => onContextMenu(e, book)}
      onKeyDown={(e) => onKeyDown(e, book)}
      tabIndex={0}
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all cursor-pointer book-card select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        multiSelectMode ? 'touch-none' : ''
      } ${
        selected
          ? 'border-primary bg-primary/5 dark:bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface hover:shadow-md hover:border-primary/30'
      }`}
      style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      <button
        type="button"
        data-no-drag-select
        onClick={(e) => onToggleSelect(book.id, e)}
        onPointerDown={(e) => e.stopPropagation()}
        className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center transition-all ${
          selected
            ? 'bg-primary text-[rgb(var(--on-primary-rgb))] shadow-sm'
            : 'bg-white/80 dark:bg-gray-800/80 text-gray-300 hover:text-primary'
        }`}
        title={selected ? '取消选择' : '选择'}
      >
        {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
      <div
        className="w-10 h-12 rounded bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          onUploadCover(book)
        }}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
            onError={() => onCoverError?.(book)}
          />
        ) : (
          <span className="text-sm font-bold text-primary/50">{book.title.charAt(0)}</span>
        )}
      </div>
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          onOpen(book)
        }}
      >
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
            {book.title}
          </h4>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              FORMAT_BADGE_COLORS[book.format] || 'bg-gray-100 text-gray-600'
            }`}
          >
            {book.format.toUpperCase()}
          </span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {book.author} · {book.sentenceCount || book.sentences.length} 句
        </p>
      </div>
      <button
        type="button"
        data-no-drag-select
        onClick={(e) => onToggleFavorite(book.id, e)}
        onPointerDown={(e) => e.stopPropagation()}
        className={`flex-shrink-0 p-1 rounded ${
          favorited
            ? 'text-amber-400'
            : 'text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100'
        }`}
        title={favorited ? '取消收藏' : '收藏'}
      >
        <Star className={`w-4 h-4 ${favorited ? 'fill-amber-400' : ''}`} />
      </button>
      <button
        type="button"
        data-no-drag-select
        onClick={(e) => onMenuButtonClick(e, book)}
        onPointerDown={(e) => e.stopPropagation()}
        className="icon-btn-sm flex-shrink-0"
        aria-label="更多书籍操作"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <div className="w-32 flex-shrink-0">
        <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full"
            style={{ width: `${book.progressPercent}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 text-right">
          {book.progressPercent.toFixed(0)}%
        </p>
      </div>
    </div>
  )
}
