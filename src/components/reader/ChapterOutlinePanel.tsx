import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, RotateCw, Sparkles } from 'lucide-react'
import type { ChapterOutlineRecord, ChapterOutlineSection, ChapterHinge } from '../../global'
import type { StructuredChapter } from '../../global'
import { chapterDisplayTitle } from '../../utils/bookData'
import { cn } from '../../utils/cn'

interface ChapterOutlinePanelProps {
  chapter: StructuredChapter
  currentSentenceIndex: number
  record?: ChapterOutlineRecord
  loading?: boolean
  generating?: boolean
  /** 0–100 生成进度（伪进度或完成时的 100） */
  progress?: number
  error?: string | null
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** 生成大纲；force=true 覆盖已有缓存（重新生成/升级） */
  onGenerate: (force: boolean) => void
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
  generating = false,
  progress,
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
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!generating) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [generating])

  if (collapsed) {
    return (
      <aside className="panel-surface flex h-full w-7 flex-shrink-0 flex-col items-center border-r border-gray-200 bg-white/80 pt-2 dark:border-dark-border dark:bg-dark-surface/80">
        <button type="button" className="icon-btn h-6 w-6" title="展开本章大纲" onClick={() => onCollapsedChange?.(false)}>
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
        {(loading || generating) && <Loader2 className="mt-2 h-3 w-3 animate-spin text-primary" />}
      </aside>
    )
  }

  const title = chapterCustomTitle || chapterOriginalTitle || chapterDisplayTitle({ title: chapter.title, startIndex: 0, sentenceCount: 0 })
  const hasCustomSectionTitle = Boolean(record?.sections.some((section) => section.customTitle))
  const activeSectionIndex = record?.sections.reduce((active, section, index) => {
    return currentSentenceIndex >= chapter.sentenceRange[0] + section.startOffset ? index : active
  }, 0) ?? 0
  const hasRecord = Boolean(record && (record.status === 'generated' || record.status === 'short_chapter') && record.sections.length > 0)
  const regenerate = () => {
    if (generating) return
    if (hasCustomSectionTitle && !window.confirm('重新生成会覆盖本章的小节标题，是否继续？')) return
    // 有缓存 → force=true（重新生成/升级）；无缓存 → force=false（缓存 miss 才生成，不浪费）
    onGenerate(hasRecord)
  }

  const progressPct = Math.max(0, Math.min(100, progress ?? (generating ? 8 : 0)))
  const busy = generating

  return (
    <aside className="panel-surface flex h-full w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white/80 dark:border-dark-border dark:bg-dark-surface/80 sm:w-60">
      {/* Header */}
      <div className="flex min-h-9 items-center justify-between border-b border-gray-200 dark:border-dark-border">
        <span className="px-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">本章大纲</span>
        <button type="button" className="icon-btn h-7 w-7 mx-0.5" title="收起本章大纲" onClick={() => onCollapsedChange?.(true)}><PanelLeftClose className="h-3 w-3" /></button>
      </div>

      {/* Chapter title + edit row */}
      <div className="flex min-h-10 items-center gap-1 border-b border-gray-200 px-2 dark:border-dark-border">
        {editingChapter ? (
          <InlineTitleEditor value={title} onSave={(value) => { onRenameChapter(value); setEditingChapter(false) }} onCancel={() => setEditingChapter(false)} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200" title={title}>{title}</span>
        )}
        {!editingChapter && <button type="button" className="icon-btn h-6 w-6" title="编辑章节名" onClick={() => setEditingChapter(true)}><Pencil className="h-3 w-3" /></button>}
        {chapterCustomTitle && <button type="button" className="icon-btn h-6 w-6" title="恢复原章节名" onClick={onRestoreChapter}><RotateCcw className="h-3 w-3" /></button>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {generating && (
          <div className="border-b border-gray-100 px-3 py-2 dark:border-dark-border" data-outline-progress="true">
            <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                正在分析本章结构
              </span>
              <span className="tabular-nums">{Math.round(progressPct)}% · {elapsed}s</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1 text-[9px] leading-snug text-gray-400">
              分析仍在后台进行，可继续阅读；完成后会自动显示结果
            </p>
          </div>
        )}
        {/* 仅首次无缓存时显示加载条，避免已有大纲时闪烁 */}
        {!generating && loading && !record?.sections.length && (
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[10px] text-gray-400 dark:border-dark-border">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载大纲缓存…
          </div>
        )}
        {error && (
          <div className="border-b border-red-100 px-3 py-2 text-[10px] leading-relaxed text-red-500 dark:border-red-900/40">
            {error}
          </div>
        )}
        {record?.status === 'short_chapter' && (
          <div className="border-b border-gray-100 px-3 py-2 text-[10px] text-gray-500 dark:border-dark-border">
            本章较短，无需细分
          </div>
        )}
        {record?.sections.length ? (
          <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="本章大纲">
            {/* schema=2 ChapterBrief：章级主张 + 为何重要 */}
            {record.schemaVersion === 2 && record.thesis && (
              <div className="border-b border-gray-100 px-3 py-2 dark:border-dark-border">
                <p className="text-[11px] font-semibold leading-snug text-gray-800 dark:text-gray-100">
                  {record.thesis}
                </p>
                {record.whyItMatters && (
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                    {record.whyItMatters}
                  </p>
                )}
              </div>
            )}
            {/* 论证脊骨：可点跳的小节列表（schema=1/2 共用） */}
            <div className="py-1.5">
              {record.sections.map((section, index) => (
                <div key={section.id} className="group flex items-start gap-1 px-2 py-0.5">
                  {editingSectionId === section.id ? (
                    <InlineTitleEditor
                      value={displaySectionTitle(section)}
                      onSave={(value) => {
                        const trimmed = value.trim()
                        if (!trimmed) return
                        onUpdateRecord({
                          ...record,
                          sections: record.sections.map((item) =>
                            item.id === section.id
                              ? { ...item, customTitle: trimmed === item.originalTitle ? undefined : trimmed }
                              : item
                          )
                        })
                        setEditingSectionId(null)
                      }}
                      onCancel={() => setEditingSectionId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        'min-w-0 flex-1 py-1 text-left',
                        index === activeSectionIndex ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                      )}
                      onClick={() => onSelectSection(section.startOffset)}
                    >
                      <span className="block truncate text-[11px] leading-tight">{displaySectionTitle(section)}</span>
                      {section.summary && (
                        <span className="mt-0.5 block line-clamp-2 text-[9px] leading-snug text-gray-400">
                          {section.summary}
                        </span>
                      )}
                      {!section.summary && section.point && (
                        <span className="mt-0.5 block line-clamp-2 text-[9px] leading-snug text-gray-400">
                          {section.point}
                        </span>
                      )}
                    </button>
                  )}
                  {!editingSectionId && record.status === 'generated' && (
                    <button
                      type="button"
                      className="icon-btn h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                      title="编辑小节标题"
                      onClick={() => setEditingSectionId(section.id)}
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  )}
                  {section.customTitle && !editingSectionId && (
                    <button
                      type="button"
                      className="icon-btn h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                      title="恢复原小节标题"
                      onClick={() =>
                        onUpdateRecord({
                          ...record,
                          sections: record.sections.map((item) =>
                            item.id === section.id ? { ...item, customTitle: undefined } : item
                          )
                        })
                      }
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* schema=2 阿基米德支点：可点跳的关键句 */}
            {record.schemaVersion === 2 && record.hinges && record.hinges.length > 0 && (
              <div className="border-t border-gray-100 px-3 py-2 dark:border-dark-border">
                <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-gray-400">支点</p>
                {record.hinges.map((hinge, hi) => (
                  <button
                    key={hi}
                    type="button"
                    className="mb-1 block w-full rounded bg-amber-50/60 px-2 py-1 text-left transition-colors hover:bg-amber-100/70 dark:bg-amber-900/10 dark:hover:bg-amber-900/20"
                    onClick={() => onSelectSection(hinge.at)}
                    title="跳转到该句"
                  >
                    <span className="block text-[10px] font-medium leading-snug text-amber-700 dark:text-amber-400">
                      第 {hinge.at} 句
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-600 dark:text-gray-300">
                      {hinge.insight}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {/* schema=1 legacy：提示可升级 */}
            {record.schemaVersion !== 2 && record.status === 'generated' && (
              <div className="border-t border-gray-100 px-3 py-2 dark:border-dark-border">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50"
                  onClick={() => onGenerate(true)}
                  disabled={busy}
                  title="用新格式重新生成（含主张/支点）"
                >
                  <Sparkles className="h-3 w-3" />
                  升级为阅读简报
                </button>
              </div>
            )}
          </nav>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[10px] text-gray-400">
            {loading ? (
              <p className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在读取大纲…
              </p>
            ) : (
              <p>{error ? '生成失败，请重试' : generating ? '分析进行中…' : '本章尚未生成大纲'}</p>
            )}
          </div>
        )}
        <button
          type="button"
          className="mx-2 mb-2 inline-flex items-center justify-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-gray-300 dark:hover:bg-white/5"
          onClick={regenerate}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : record?.status === 'generated' || record?.status === 'short_chapter' ? (
            <RotateCw className="h-3 w-3" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {busy
            ? `分析中 ${Math.round(progressPct)}%`
            : record?.status === 'generated' || record?.status === 'short_chapter'
              ? '重新生成'
              : '生成本章大纲'}
        </button>
      </div>
    </aside>
  )
}
