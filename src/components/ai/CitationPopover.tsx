import { LocateFixed } from 'lucide-react'
import type { AiSourceRef } from '../../global'

interface CitationPopoverProps {
  source: AiSourceRef
  onNavigate: (source: AiSourceRef) => void
}

export default function CitationPopover({ source, onNavigate }: CitationPopoverProps) {
  return (
    <details className="group relative inline-block align-baseline">
      <summary className="mx-0.5 inline-flex cursor-pointer list-none items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300">
        [{source.index}]
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-5 text-gray-700 shadow-lg dark:border-dark-border dark:bg-dark-surface dark:text-gray-200">
        <div className="mb-1 font-semibold text-gray-800 dark:text-gray-100">
          {source.chapterTitle}
        </div>
        <p className="max-h-32 overflow-y-auto">{source.content}</p>
        <button
          type="button"
          onClick={() => onNavigate(source)}
          className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:opacity-80"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          定位原文
        </button>
      </div>
    </details>
  )
}
