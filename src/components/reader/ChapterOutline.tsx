import { useState } from 'react'
import { ChevronRight, Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { StructuredChapter } from '../../global'
import type { ChapterSections } from './AiReaderView'
import { cn } from '../../utils/cn'

interface ChapterOutlineProps {
  structure: StructuredChapter[]
  currentSentenceIndex: number
  activeChapterIndex: number
  onSelectChapter: (index: number) => void
  chapterSections?: Map<number, ChapterSections>
  outlineGenerating?: boolean
}

export default function ChapterOutline({
  structure,
  currentSentenceIndex,
  activeChapterIndex,
  onSelectChapter,
  chapterSections,
  outlineGenerating = false
}: ChapterOutlineProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set())

  const toggleExpand = (index: number) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <aside
      className={cn(
        'hidden flex-shrink-0 border-r border-gray-200 bg-surface transition-[width] dark:border-dark-border dark:bg-dark-surface lg:flex lg:flex-col',
        collapsed ? 'w-10' : 'w-44'
      )}
    >
      <div className="flex h-9 items-center border-b border-gray-200 px-1.5 dark:border-dark-border">
        {!collapsed && (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate px-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
            大纲
            {outlineGenerating && <Loader2 className="h-3 w-3 animate-spin text-primary/60" />}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="icon-btn h-7 w-7 flex-shrink-0"
          title={collapsed ? '展开目录' : '收起目录'}
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <nav className="min-h-0 flex-1 overflow-y-auto py-1.5" aria-label="章节大纲">
          {structure.map((chapter, index) => {
            const [start, end] = chapter.sentenceRange
            const isPlaying = currentSentenceIndex >= start && currentSentenceIndex < end
            const isActive = index === activeChapterIndex
            const sections = chapterSections?.get(index)
            const isExpanded = expandedChapters.has(index) || isActive

            return (
              <div key={`${chapter.title}-${start}-${index}`}>
                {/* 章标题 */}
                <button
                  type="button"
                  onClick={() => {
                    onSelectChapter(index)
                    if (sections && sections.length > 1) toggleExpand(index)
                  }}
                  className={cn(
                    'flex w-full items-center gap-1 border-l-2 py-1.5 pr-2 text-left text-[11px] leading-tight transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100'
                  )}
                  style={{ paddingLeft: `${Math.min(4, Math.max(1, chapter.level)) * 6 + 4}px` }}
                >
                  <ChevronRight
                    className={cn(
                      'h-2.5 w-2.5 flex-shrink-0 transition-transform',
                      isExpanded && sections && sections.length > 1 && 'rotate-90',
                      isPlaying ? 'text-primary opacity-100' : 'opacity-40'
                    )}
                  />
                  <span className="truncate">{chapter.title}</span>
                </button>

                {/* 节标题（AI 细分） */}
                {sections && sections.length > 1 && isExpanded && (
                  <div className="ml-4 border-l border-gray-100 dark:border-dark-border/50">
                    {sections.map((section, sIdx) => {
                      const sectionActive = currentSentenceIndex >= section.globalStart
                      return (
                        <button
                          key={`${section.title}-${sIdx}`}
                          type="button"
                          onClick={() => onSelectChapter(index)}
                          className={cn(
                            'flex w-full flex-col py-1 pl-3 pr-2 text-left transition-colors',
                            sectionActive
                              ? 'text-primary'
                              : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
                          )}
                        >
                          <span className={cn('truncate text-[10px] leading-tight', sectionActive && 'font-medium')}>{section.title}</span>
                          {section.point && (
                            <span className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-gray-400/80 dark:text-gray-500/80">{section.point}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
