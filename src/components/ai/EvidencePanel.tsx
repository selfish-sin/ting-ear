import { useState, type ReactNode } from 'react'
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  GraduationCap,
  Loader2,
  Plug,
  Search,
  Wrench
} from 'lucide-react'
import type { AiChatMessage, AiSourceRef, AiToolTrace, AiWebSourceRef } from '../../global'
import CitationPopover from './CitationPopover'

interface EvidencePanelProps {
  status?: AiChatMessage['retrievalStatus']
  sources?: AiSourceRef[]
  webSources?: AiWebSourceRef[]
  webSearchUsed?: boolean
  toolTraces?: AiToolTrace[]
  error?: string
  onNavigateSource?: (source: AiSourceRef) => void
}

const ACADEMIC_PROVIDERS = new Set(['semantic-scholar', 'sciverse'])

function isAcademic(s: AiWebSourceRef): boolean {
  if (ACADEMIC_PROVIDERS.has(s.provider)) return true
  const t = (s.sourceType || '').toLowerCase()
  return t.includes('学术') || t.includes('论文') || t.includes('scholar')
}

function hostLabel(url: string, title: string): string {
  if (!url) return title || '未知来源'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return title || url
  }
}

function toolLabel(name: string): string {
  if (name === 'search_book') return '书内检索'
  if (name === 'web_search') return '联网搜索'
  if (name === 'semantic_scholar') return 'Semantic Scholar'
  if (name === 'sciverse') return 'SciVerse'
  if (name.startsWith('mcp_')) {
    const rest = name.slice(4)
    const idx = rest.indexOf('_')
    if (idx > 0) return `MCP·${rest.slice(0, idx)}·${rest.slice(idx + 1)}`
    return `MCP·${rest}`
  }
  return name
}

function toolKind(name: string): 'book' | 'web' | 'academic' | 'mcp' | 'other' {
  if (name === 'search_book') return 'book'
  if (name === 'web_search') return 'web'
  if (name === 'semantic_scholar' || name === 'sciverse') return 'academic'
  if (name.startsWith('mcp_')) return 'mcp'
  return 'other'
}

/**
 * 本轮证据总览：书内 / 联网 / 学术 / MCP 工具，一眼看清引用了什么。
 */
export default function EvidencePanel({
  status,
  sources = [],
  webSources = [],
  webSearchUsed = false,
  toolTraces = [],
  error,
  onNavigateSource = () => undefined
}: EvidencePanelProps) {
  const academicSources = webSources.filter(isAcademic)
  const plainWebSources = webSources.filter((s) => !isAcademic(s))
  const mcpTraces = toolTraces.filter((t) => toolKind(t.name) === 'mcp')
  const otherTraces = toolTraces.filter((t) => toolKind(t.name) !== 'mcp')

  const isSearching = status === 'searching'
  const hasError = status === 'error' || status === 'offline'
  const hasBook = sources.length > 0
  const hasWeb = plainWebSources.length > 0
  const hasAcademic = academicSources.length > 0
  const hasMcp = mcpTraces.length > 0
  const hasAnyTrace = toolTraces.length > 0
  const hasAnyEvidence = hasBook || hasWeb || hasAcademic || hasMcp || hasAnyTrace || webSearchUsed

  // 完全无检索/工具痕迹时不占位（纯闲聊）
  if (!isSearching && !hasError && !hasAnyEvidence && status !== 'done' && status !== 'skipped') {
    return null
  }
  if (!isSearching && !hasError && !hasAnyEvidence && !status) {
    return null
  }

  const [expanded, setExpanded] = useState(
    hasBook || hasWeb || hasAcademic || hasMcp || (hasAnyTrace && toolTraces.some((t) => !t.ok))
  )

  const chips: Array<{ key: string; label: string; tone: string; icon: ReactNode }> = []
  if (isSearching) {
    chips.push({
      key: 'searching',
      label: '检索中…',
      tone: 'bg-primary/10 text-primary',
      icon: <Loader2 className="h-3 w-3 animate-spin" />
    })
  }
  chips.push({
    key: 'book',
    label: hasBook ? `书内 ${sources.length}` : status === 'offline' ? '书内·离线' : '书内 0',
    tone: hasBook
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    icon: <BookOpen className="h-3 w-3" />
  })
  chips.push({
    key: 'web',
    label: hasWeb
      ? `联网 ${plainWebSources.length}`
      : webSearchUsed
        ? '联网 0'
        : '未联网',
    tone:
      hasWeb || webSearchUsed
        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    icon: <Globe className="h-3 w-3" />
  })
  if (hasAcademic || otherTraces.some((t) => toolKind(t.name) === 'academic')) {
    chips.push({
      key: 'academic',
      label: hasAcademic ? `学术 ${academicSources.length}` : '学术 0',
      tone: hasAcademic
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      icon: <GraduationCap className="h-3 w-3" />
    })
  }
  if (hasMcp || mcpTraces.length > 0) {
    chips.push({
      key: 'mcp',
      label: hasMcp ? `MCP ${mcpTraces.length}` : 'MCP 0',
      tone: hasMcp
        ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      icon: <Plug className="h-3 w-3" />
    })
  }
  if (otherTraces.length > 0 && !hasBook && !webSearchUsed) {
    // 有工具痕迹但上面没盖住时补一条
  }
  if (toolTraces.length > 0) {
    chips.push({
      key: 'tools',
      label: `工具 ${toolTraces.length}`,
      tone: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
      icon: <Wrench className="h-3 w-3" />
    })
  }

  const canExpand =
    hasBook || hasWeb || hasAcademic || hasMcp || toolTraces.length > 0 || Boolean(error)

  return (
    <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-600 dark:border-dark-border dark:bg-dark-muted dark:text-gray-300">
      <div className="flex items-start gap-2 px-2.5 py-2">
        {isSearching ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
        ) : hasError ? (
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
        ) : (
          <Search className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="font-medium text-gray-700 dark:text-gray-200">本轮引用</span>
            {hasError && (
              <span className="text-[10px] text-red-500">
                {error || (status === 'offline' ? '知识库离线' : '检索异常')}
              </span>
            )}
            {!isSearching && !hasBook && !hasWeb && !hasAcademic && !hasMcp && (
              <span className="text-[10px] text-gray-400">
                {webSearchUsed
                  ? '已检索但无命中片段'
                  : '未引用外部片段（可能仅用本章正文）'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {chips.map((c) => (
              <span
                key={c.key}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${c.tone}`}
              >
                {c.icon}
                {c.label}
              </span>
            ))}
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                title={expanded ? '收起详情' : '展开引用详情'}
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {expanded ? '收起' : '展开详情'}
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && canExpand && (
        <div className="space-y-2.5 border-t border-gray-200 px-2.5 py-2 dark:border-dark-border">
          {/* 工具调用列表 */}
          {toolTraces.length > 0 && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                工具调用
              </div>
              <ul className="space-y-1">
                {toolTraces.map((t, i) => (
                  <li
                    key={`trace-${i}-${t.name}`}
                    className="flex flex-wrap items-center gap-1.5 rounded border border-gray-100 bg-white/80 px-2 py-1 dark:border-dark-border dark:bg-dark-surface/60"
                  >
                    {toolKind(t.name) === 'mcp' ? (
                      <Plug className="h-3 w-3 text-violet-600" />
                    ) : (
                      <Wrench className="h-3 w-3 text-indigo-600" />
                    )}
                    <span className="font-medium text-gray-800 dark:text-gray-100">
                      {toolLabel(t.name)}
                    </span>
                    <span
                      className={`rounded px-1 text-[9px] ${
                        t.ok
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                      }`}
                    >
                      {t.ok ? '成功' : '失败'}
                    </span>
                    {typeof t.durationMs === 'number' && (
                      <span className="text-[10px] text-gray-400">{t.durationMs}ms</span>
                    )}
                    {t.summary && (
                      <span className="min-w-0 flex-1 truncate text-[10px] text-gray-500">
                        {t.summary}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 书内 */}
          {hasBook && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                书内记忆（nmem / 本地向量）
              </div>
              <ul className="space-y-1.5">
                {sources.map((source) => (
                  <li
                    key={`book-src-${source.index}-${source.memoryId}`}
                    className="rounded-md border border-gray-100 bg-white/80 px-2 py-1.5 dark:border-dark-border dark:bg-dark-surface/60"
                  >
                    <div className="flex items-start gap-1.5">
                      <BookOpen className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <CitationPopover source={source} onNavigate={onNavigateSource} />
                          <span className="font-medium text-gray-800 dark:text-gray-100">
                            {source.chapterTitle ||
                              (source.chapterIndex < 0 ? '全书' : `第 ${source.chapterIndex + 1} 章`)}
                          </span>
                          {Number.isFinite(source.score) && source.score > 0 && (
                            <span className="text-[10px] text-gray-400">
                              相关度 {(source.score * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                          {source.content}
                        </p>
                        <button
                          type="button"
                          onClick={() => onNavigateSource(source)}
                          className="mt-1 text-[10px] font-medium text-primary hover:opacity-80"
                        >
                          定位原文
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 联网 */}
          {(hasWeb || webSearchUsed) && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                联网搜索
              </div>
              {plainWebSources.length === 0 ? (
                <p className="text-[10px] text-gray-400">已调用联网，但未命中可用结果</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {plainWebSources.map((source) => (
                    <WebChip key={`web-${source.index}-${source.url || source.title}`} source={source} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 学术 */}
          {hasAcademic && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                学术检索
              </div>
              <div className="flex flex-wrap gap-1.5">
                {academicSources.map((source) => (
                  <WebChip
                    key={`acad-${source.index}-${source.url || source.title}`}
                    source={source}
                    academic
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function WebChip({ source, academic = false }: { source: AiWebSourceRef; academic?: boolean }) {
  const tone = academic
    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
    : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'
  return (
    <details className="group relative max-w-full">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium hover:opacity-90 ${tone}`}
      >
        {academic ? <GraduationCap className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
        来自{hostLabel(source.url, source.title)}
        <span className="rounded bg-white/70 px-1 text-[9px] dark:bg-black/20">
          {source.sourceType}
        </span>
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-5 text-gray-700 shadow-lg dark:border-dark-border dark:bg-dark-surface dark:text-gray-200">
        <div className="mb-1 font-semibold text-gray-800 dark:text-gray-100">{source.title}</div>
        <div className="mb-1 flex flex-wrap gap-1 text-[10px] text-gray-400">
          <span>{source.provider}</span>
          <span>·</span>
          <span>{source.sourceType}</span>
          {source.fetchedAt && (
            <>
              <span>·</span>
              <span>{new Date(source.fetchedAt).toLocaleString()}</span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5">
            {source.snippet}
          </p>
        )}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:opacity-80"
            onClick={(e) => {
              e.preventDefault()
              window.open(source.url, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            打开原始链接
          </a>
        )}
      </div>
    </details>
  )
}
