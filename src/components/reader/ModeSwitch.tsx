import { BookOpenText, Headphones } from 'lucide-react'
import { useBookStore } from '../../stores/bookStore'
import { cn } from '../../utils/cn'

interface ModeSwitchProps {
  className?: string
}

export default function ModeSwitch({ className }: ModeSwitchProps) {
  const { readerMode, setReaderMode } = useBookStore()

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-dark-border dark:bg-dark-muted',
        className
      )}
      role="group"
      aria-label="阅读模式"
    >
      <button
        type="button"
        aria-pressed={readerMode === 'ai-reading'}
        onClick={() => setReaderMode('ai-reading')}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          readerMode === 'ai-reading'
            ? 'bg-white text-primary shadow-sm dark:bg-dark-raised'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
        )}
      >
        <BookOpenText className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">AI 阅读</span>
      </button>
      <button
        type="button"
        aria-pressed={readerMode === 'listening'}
        onClick={() => setReaderMode('listening')}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          readerMode === 'listening'
            ? 'bg-white text-primary shadow-sm dark:bg-dark-raised'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
        )}
      >
        <Headphones className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">听书</span>
      </button>
    </div>
  )
}
