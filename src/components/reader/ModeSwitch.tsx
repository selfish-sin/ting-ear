import { BookOpenText, Headphones } from 'lucide-react'
import { useBookStore } from '../../stores/bookStore'
import { cn } from '../../utils/cn'

interface ModeSwitchProps {
  className?: string
}

export default function ModeSwitch({ className }: ModeSwitchProps) {
  const readerMode = useBookStore((s) => s.readerMode)
  const setReaderMode = useBookStore((s) => s.setReaderMode)

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-lg border border-black/5 bg-black/[0.04] p-0.5 dark:border-white/10 dark:bg-white/[0.06]',
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
            ? 'bg-primary text-[rgb(var(--on-primary-rgb))] shadow-sm'
            : 'text-gray-500 hover:bg-primary/10 hover:text-primary dark:text-gray-400'
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
            ? 'bg-primary text-[rgb(var(--on-primary-rgb))] shadow-sm'
            : 'text-gray-500 hover:bg-primary/10 hover:text-primary dark:text-gray-400'
        )}
      >
        <Headphones className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">听书</span>
      </button>
    </div>
  )
}
