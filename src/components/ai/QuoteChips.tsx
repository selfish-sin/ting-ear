import { X } from 'lucide-react'

interface QuoteChipsProps {
  quotes: string[]
  onRemove: (index: number) => void
}

export default function QuoteChips({ quotes, onRemove }: QuoteChipsProps) {
  if (quotes.length === 0) return null

  return (
    <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto pb-2">
      {quotes.slice(0, 5).map((quote, index) => (
        <div
          key={`${quote}-${index}`}
          className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-gray-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-gray-200"
        >
          <span className="min-w-0 flex-1 line-clamp-2 leading-5">{quote}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="icon-btn h-6 w-6 flex-shrink-0"
            title="移除引用"
            aria-label={`移除引用 ${index + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
