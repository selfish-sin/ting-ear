import { useState } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen, RotateCw } from 'lucide-react'
import type { ChapterSections } from './AiReaderView'
import { cn } from '../../utils/cn'

interface SectionNavProps {
  sections?: ChapterSections
  currentSentenceIndex: number
  outlineGenerating?: boolean
  outlineError?: string | null
  onRetry?: () => void
}

/**
 * 左缘章内小节导航。
 * 默认收起为细条（图标按钮），点击 pin 展开为常驻面板，再点收回。
 */
export default function SectionNav({
  sections,
  currentSentenceIndex,
  outlineGenerating = false,
  outlineError,
  onRetry
}: SectionNavProps) {
  const [pinned, setPinned] = useState(false)

  const hasSections = sections && sections.length > 1

  let activeSection = 0
  if (hasSections) {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (currentSentenceIndex >= sections[i].globalStart) {
        activeSection = i
        break
      }
    }
  }

  const scrollToSection = (globalStart: number) => {
    const container = document.querySelector('[data-content-cards]')
    if (!container) return
    const cards = container.querySelectorAll('[data-sentence-start]')
    for (const card of cards) {
      const start = Number(card.getAttribute('data-sentence-start'))
      if (start >= globalStart) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' })
        break
      }
    }
  }

  return (
    <div className="relative flex-shrink-0">
      {/* 收起态：细条 + 按钮 */}
      {!pinned && (
        <div className="flex h-full w-6 flex-col items-center border-r border-gray-200 bg-white pt-2.5 dark:border-dark-border dark:bg-dark-surface">
          <button
            type="button"
            onClick={() => setPinned(true)}
            className="flex h-7 w-5 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-100 hover:text-primary dark:text-gray-600 dark:hover:bg-white/5 dark:hover:text-primary"
            title="展开本章大纲"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
          {outlineGenerating && <Loader2 className="mt-2 h-3 w-3 animate-spin text-primary/50" />}
          {outlineError && !outlineGenerating && <span className="mt-2 h-1.5 w-1.5 rounded-full bg-red-400" />}
        </div>
      )}

      {/* 展开态：常驻面板 */}
      {pinned && (
        <div className="flex h-full w-44 flex-col border-r border-gray-200 bg-white dark:border-dark-border dark:bg-dark-surface">
          <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-gray-200 px-2.5 dark:border-dark-border">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">本章大纲</span>
            <button
              type="button"
              onClick={() => setPinned(false)}
              className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200"
              title="收起"
            >
              <PanelLeftClose className="h-3 w-3" />
            </button>
          </div>

          {hasSections ? (
            <nav className="flex-1 overflow-y-auto py-1.5">
              {sections.map((section, idx) => (
                <button
                  key={`${section.title}-${idx}`}
                  type="button"
                  onClick={() => scrollToSection(section.globalStart)}
                  className={cn(
                    'flex w-full flex-col border-l-2 py-1.5 pl-3 pr-2 text-left transition-colors',
                    idx === activeSection
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200'
                  )}
                >
                  <span className={cn('truncate text-[11px] leading-tight', idx === activeSection && 'font-medium')}>{section.title}</span>
                  {section.point && (
                    <span className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-gray-400/80 dark:text-gray-500/80">{section.point}</span>
                  )}
                </button>
              ))}
            </nav>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-3">
              {outlineGenerating ? (
                <div className="flex flex-col items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
                  <p className="text-center text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">正在分析论证结构…</p>
                </div>
              ) : outlineError ? (
                <>
                  <p className="text-center text-[10px] leading-relaxed text-red-400 dark:text-red-400/80">{outlineError}</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      <RotateCw className="h-3 w-3" />
                      重试
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-center text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">本章尚未生成大纲</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      <RotateCw className="h-3 w-3" />
                      生成大纲
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
