import { useEffect, useState } from 'react'
import { Check, Loader2, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, RotateCw } from 'lucide-react'
import type { ChapterOutlineRecord, ChapterOutlineSection } from '../../global'
import type { StructuredChapter } from '../../global'
import { chapterDisplayTitle } from '../../utils/bookData'
import { cn } from '../../utils/cn'

interface ChapterOutlinePanelProps {
  chapter: StructuredChapter
  currentSentenceIndex: number
  record?: ChapterOutlineRecord
  loading?: boolean
  error?: string | null
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onGenerate: () => void
  onSelectSection: (startOffset: number) => void
  onUpdateRecord: (record: ChapterOutlineRecord) => void
  onRenameChapter: (title: string) => void
  onRestoreChapter: () => void
  chapterOriginalTitle?: string
  chapterCustomTitle?: string
}

function displaySectionTitle(section: ChapterOutlineSection): string {
  return section.customTitle?.trim() || section.originalTitle
}

function InlineTitleEditor({
  value,
  onSave,
  onCancel
}: {
  value: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSave(draft)
        if (event.key === 'Escape') onCancel()
      }}
      className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 text-xs outline-none dark:bg-dark-raised"
      maxLength={120}
    />
  )
}

export default function ChapterOutlinePanel({
  chapter,
  currentSentenceIndex,
  record,
  loading = false,
  error,
  collapsed = false,
  onCollapsedChange,
  onGenerate,
  onSelectSection,
  onUpdateRecord,
  onRenameChapter,
  onRestoreChapter,
  chapterOriginalTitle,
  chapterCustomTitle
}: ChapterOutlinePanelProps) {
  const [editingChapter, setEditingChapter] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)

  if (collapsed) {
    return (
      <aside className="flex h-full w-7 flex-shrink-0 flex-col items-center border-r border-gray-200 bg-white pt-2 dark:border-dark-border dark:bg-dark-surface">
        <button type="button" className="icon-btn h-6 w-6" title="展开本章大纲" onClick={() => onCollapsedChange?.(false)}>
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
        {loading && <Loader2 className="mt-2 h-3 w-3 animate-spin text-primary" />}
      </aside>
    )
  }

  const title = chapterCustomTitle || chapterOriginalTitle || chapterDisplayTitle({ title: chapter.title, startIndex: 0, sentenceCount: 0 })
  const hasCustomSectionTitle = Boolean(record?.sections.some((section) => section.customTitle))
  const activeSectionIndex = record?.sections.reduce((active, section, index) => {
    return currentSentenceIndex >= chapter.sentenceRange[0] + section.startOffset ? index : active
  }, 0) ?? 0
  const regenerate = () => {
    if (hasCustomSectionTitle && !window.confirm('重新生成会覆盖本章的小节标题，是否继续？')) return
    onGenerate()
  }

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-dark-border dark:bg-dark-surface">
      <div className="flex min-h-10 items-center gap-1 border-b border-gray-200 px-2 dark:border-dark-border">
        {editingChapter ? (
          <InlineTitleEditor value={title} onSave={(value) => { onRenameChapter(value); setEditingChapter(false) }} onCancel={() => setEditingChapter(false)} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200" title={title}>{title}</span>
        )}
        {!editingChapter && <button type="button" className="icon-btn h-6 w-6" title="编辑章节名" onClick={() => setEditingChapter(true)}><Pencil className="h-3 w-3" /></button>}
        {chapterCustomTitle && <button type="button" className="icon-btn h-6 w-6" title="恢复原章节名" onClick={onRestoreChapter}><RotateCcw className="h-3 w-3" /></button>}
        <button type="button" className="icon-btn h-6 w-6" title="收起本章大纲" onClick={() => onCollapsedChange?.(true)}><PanelLeftClose className="h-3 w-3" /></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {loading && <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[10px] text-gray-400 dark:border-dark-border"><Loader2 className="h-3 w-3 animate-spin" />正在分析本章</div>}
        {error && <div className="border-b border-red-100 px-3 py-2 text-[10px] leading-relaxed text-red-500 dark:border-red-900/40">{error}</div>}
        {record?.status === 'short_chapter' && <div className="border-b border-gray-100 px-3 py-2 text-[10px] text-gray-500 dark:border-dark-border">本章较短，无需细分</div>}
        {record?.sections.length ? (
          <nav className="min-h-0 flex-1 overflow-y-auto py-1.5" aria-label="本章小节大纲">
            {record.sections.map((section, index) => (
              <div key={section.id} className="group flex items-start gap-1 px-2 py-0.5">
                {editingSectionId === section.id ? (
                  <InlineTitleEditor
                    value={displaySectionTitle(section)}
                    onSave={(value) => {
                      const trimmed = value.trim()
                      if (!trimmed) return
                      onUpdateRecord({ ...record, sections: record.sections.map((item) => item.id === section.id ? { ...item, customTitle: trimmed === item.originalTitle ? undefined : trimmed } : item) })
                      setEditingSectionId(null)
                    }}
                    onCancel={() => setEditingSectionId(null)}
                  />
                ) : (
                  <button type="button" className={cn('min-w-0 flex-1 py-1 text-left', index === activeSectionIndex ? 'text-primary' : 'text-gray-600 dark:text-gray-300')} onClick={() => onSelectSection(section.startOffset)}>
                    <span className="block truncate text-[11px] leading-tight">{displaySectionTitle(section)}</span>
                    {section.point && <span className="mt-0.5 block line-clamp-2 text-[9px] leading-snug text-gray-400">{section.point}</span>}
                  </button>
                )}
                {!editingSectionId && record.status === 'generated' && <button type="button" className="icon-btn h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" title="编辑小节标题" onClick={() => setEditingSectionId(section.id)}><Pencil className="h-2.5 w-2.5" /></button>}
                {section.customTitle && !editingSectionId && <button type="button" className="icon-btn h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" title="恢复原小节标题" onClick={() => onUpdateRecord({ ...record, sections: record.sections.map((item) => item.id === section.id ? { ...item, customTitle: undefined } : item) })}><RotateCcw className="h-2.5 w-2.5" /></button>}
              </div>
            ))}
          </nav>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[10px] text-gray-400">
            <p>{error ? '生成失败，请重试' : '本章尚未生成大纲'}</p>
          </div>
        )}
        <button type="button" className="mx-2 mb-2 inline-flex items-center justify-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50 dark:border-dark-border dark:text-gray-300 dark:hover:bg-white/5" onClick={regenerate} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : record?.status === 'generated' || record?.status === 'short_chapter' ? <RotateCw className="h-3 w-3" /> : <Check className="h-3 w-3" />}
          {record?.status === 'generated' || record?.status === 'short_chapter' ? '重新生成' : '生成本章大纲'}
        </button>
      </div>
    </aside>
  )
}
