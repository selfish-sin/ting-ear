import { ExternalLink, Globe } from 'lucide-react'
import type { AiWebSourceRef } from '../../global'

interface WebSourceTagsProps {
  sources: AiWebSourceRef[]
  webSearchUsed?: boolean
}

function hostLabel(url: string, title: string): string {
  if (!url) return title || '未知来源'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return title || url
  }
}

/**
 * 回答下方的外部信息源标签：可点击展开摘要、链接、时间。
 */
export default function WebSourceTags({ sources, webSearchUsed }: WebSourceTagsProps) {
  if (!webSearchUsed && sources.length === 0) return null

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            webSearchUsed
              ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          }`}
          title={webSearchUsed ? '本轮回答启用了联网搜索' : '本轮未启用联网搜索'}
        >
          <Globe className="h-3 w-3" />
          {webSearchUsed ? '联网搜索已用' : '未联网'}
        </span>
        {sources.length === 0 && webSearchUsed && (
          <span className="text-[10px] text-gray-400">未命中外部结果</span>
        )}
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <details
              key={`web-${source.index}-${source.url || source.title}`}
              className="group relative max-w-full"
            >
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70">
                来自{hostLabel(source.url, source.title)}
                <span className="rounded bg-white/70 px-1 text-[9px] text-sky-600 dark:bg-black/20 dark:text-sky-400">
                  {source.sourceType}
                </span>
              </summary>
              <div className="absolute left-0 z-30 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-5 text-gray-700 shadow-lg dark:border-dark-border dark:bg-dark-surface dark:text-gray-200">
                <div className="mb-1 font-semibold text-gray-800 dark:text-gray-100">
                  {source.title}
                </div>
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
                      // 走 setWindowOpenHandler → safeOpenExternal
                      window.open(source.url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    打开原始链接
                  </a>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
