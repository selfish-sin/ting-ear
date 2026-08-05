import { CheckSquare, MoreHorizontal, Square, Star } from 'lucide-react'
import type { BookData } from '../../global'
import {
  FORMAT_BADGE_COLORS,
  SCALE_TO_META,
  SCALE_TO_PAD,
  SCALE_TO_TITLE
} from './shelfScale'

interface Props {
  book: BookData
  shelfScale: number
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

export default function BookGridCard({
  book,
  shelfScale,
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
      onClick={(e) => {
        // 多选：整卡点击切换；非多选交给子区域（标题打开 / 封面换图）
        if (multiSelectMode) {
          e.preventDefault()
          onToggleSelect(book.id)
        }
      }}
      onContextMenu={(e) => onContextMenu(e, book)}
      onKeyDown={(e) => onKeyDown(e, book)}
      tabIndex={0}
      className={`group relative cursor-pointer book-card select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        multiSelectMode ? 'touch-none' : ''
      } ${SCALE_TO_PAD[shelfScale]} ${
        selected ? 'border-primary/50 bg-primary/5 dark:bg-primary/10 ring-2 ring-primary/20' : ''
      }`}
      style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      {/* 勾选框：始终可点（data-no-drag-select 避免触发长按刷选） */}
      <button
        type="button"
        data-no-drag-select
        onClick={(e) => onToggleSelect(book.id, e)}
        onPointerDown={(e) => e.stopPropagation()}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded flex items-center justify-center transition-all ${
          selected
            ? 'bg-primary text-[rgb(var(--on-primary-rgb))] shadow-sm'
            : multiSelectMode
              ? 'bg-white/90 dark:bg-gray-800/90 text-gray-400 hover:text-primary'
              : 'bg-white/80 dark:bg-gray-800/80 text-gray-300 hover:text-primary opacity-0 group-hover:opacity-100'
        }`}
        title={selected ? '取消选择' : '选择'}
      >
        {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>

      <button
        type="button"
        data-no-drag-select
        onClick={(e) => onMenuButtonClick(e, book)}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-10 top-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-white/85 text-gray-500 opacity-70 shadow-sm transition hover:opacity-100 focus-visible:opacity-100 dark:bg-gray-800/85 dark:text-gray-300"
        aria-label="更多书籍操作"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      <div
        className="w-full aspect-[3/4] rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center mb-2.5 overflow-hidden relative group/cover cursor-pointer shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
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
          <span className="text-4xl font-bold text-primary/40 dark:text-primary/30">
            {book.title.charAt(0)}
          </span>
        )}
        {!multiSelectMode && (
          <div className="absolute inset-0 bg-black/0 group-hover/cover:bg-black/30 flex items-center justify-center opacity-0 group-hover/cover:opacity-100 transition-all pointer-events-none">
            <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">更换封面</span>
          </div>
        )}
        {selected && (
          <div className="absolute inset-0 bg-primary/15 pointer-events-none ring-2 ring-inset ring-primary/40 rounded-xl" />
        )}
      </div>

      <div
        onClick={(e) => {
          e.stopPropagation()
          onOpen(book)
        }}
        className="cursor-pointer"
      >
        <h4
          className={`${SCALE_TO_TITLE[shelfScale]} font-medium text-gray-800 dark:text-gray-100 truncate pr-6`}
          title={book.title}
        >
          {book.title}
        </h4>
        <p className={`${SCALE_TO_META[shelfScale]} text-gray-400 dark:text-gray-500 truncate`}>
          {book.author}
        </p>
        <span
          className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded ${
            FORMAT_BADGE_COLORS[book.format] || 'bg-gray-100 text-gray-600'
          }`}
        >
          {book.format.toUpperCase()}
        </span>
        <button
          type="button"
          data-no-drag-select
          onClick={(e) => onToggleFavorite(book.id, e)}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute bottom-14 right-2 p-1 rounded transition-opacity ${
            favorited
              ? 'text-amber-400 opacity-100'
              : 'text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100'
          }`}
          title={favorited ? '取消收藏' : '收藏'}
        >
          <Star className={`w-4 h-4 ${favorited ? 'fill-amber-400' : ''}`} />
        </button>
        <div className="mt-2">
          <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${book.progressPercent}%` }}
            />
          </div>
          <p className={`${SCALE_TO_META[shelfScale]} text-gray-400 dark:text-gray-500 mt-0.5`}>
            {book.progressPercent.toFixed(0)}% · {book.sentenceCount || book.sentences.length}句
          </p>
        </div>
      </div>
    </div>
  )
}
