import { ChevronRight } from 'lucide-react'
import type { BookData } from '../../global'

interface Props {
  book: BookData
  coverUrl?: string
  onOpen: (book: BookData) => void
  onCoverError?: (book: BookData) => void
}

export default function ContinueReadingCard({ book, coverUrl, onOpen, onCoverError }: Props) {
  const chapterTitle =
    book.chapters?.[book.currentChapterIndex]?.title || `第 ${book.currentChapterIndex + 1} 章`

  return (
    <div
      className="mb-5 flex items-center gap-3.5 p-3.5 rounded-2xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/[0.08] cursor-pointer hover:border-primary/40 hover:bg-primary/[0.07] dark:hover:bg-primary/[0.12] transition-all group/resume"
      onClick={() => onOpen(book)}
    >
      <div className="w-11 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => onCoverError?.(book)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg font-bold text-primary/40">
            {book.title.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
            继续阅读
          </span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{book.title}</span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
          {chapterTitle}
          {' · '}
          {Math.round(book.progressPercent)}%
        </p>
        <div className="mt-1.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/70 transition-all"
            style={{ width: `${Math.min(100, book.progressPercent)}%` }}
          />
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover/resume:text-primary transition-colors flex-shrink-0" />
    </div>
  )
}
