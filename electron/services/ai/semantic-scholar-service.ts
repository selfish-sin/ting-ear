import axios from 'axios'
import type { WebSearchResult } from './web-search-service'

/**
 * Semantic Scholar Graph API — 免费学术论文检索（社科/理工通用）。
 * - 无需 Key 即可用（共享限流）
 * - 可选 x-api-key 提高配额：https://www.semanticscholar.org/product/api
 *
 * 说明：社区有 Semantic Scholar MCP 服务端，但 Electron 内嵌 MCP Client 成本高。
 * 这里直连官方 REST，效果等价于「学术搜索 MCP 工具」。
 */
const S2_SEARCH = 'https://api.semanticscholar.org/graph/v1/paper/search'

export interface SemanticScholarOptions {
  maxResults?: number
  signal?: AbortSignal
  /** 可选免费 API Key */
  apiKey?: string | null
}

interface S2Paper {
  paperId?: string
  title?: string
  abstract?: string
  year?: number
  citationCount?: number
  url?: string
  venue?: string
  authors?: Array<{ name?: string }>
  openAccessPdf?: { url?: string } | null
  fieldsOfStudy?: string[]
  externalIds?: { DOI?: string }
}

export async function semanticScholarSearch(
  query: string,
  options: SemanticScholarOptions = {}
): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 300)
  if (!q) return []
  const maxResults = Math.min(10, Math.max(1, options.maxResults ?? 5))
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'ting-ear/1.0 (desktop reader; academic search)'
  }
  const key = options.apiKey?.trim()
  if (key) headers['x-api-key'] = key

  const resp = await axios.get(S2_SEARCH, {
    params: {
      query: q,
      limit: maxResults,
      fields: [
        'title',
        'abstract',
        'year',
        'citationCount',
        'url',
        'venue',
        'authors',
        'openAccessPdf',
        'fieldsOfStudy',
        'externalIds'
      ].join(',')
    },
    headers,
    timeout: 15_000,
    signal: options.signal
  })

  const data = resp.data?.data
  if (!Array.isArray(data)) return []
  const fetchedAt = new Date().toISOString()

  return data
    .map((paper: S2Paper): WebSearchResult | null => {
      const title = (paper.title || '').trim()
      if (!title) return null
      const authors = (paper.authors || [])
        .map((a) => a.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ')
      const year = paper.year ? String(paper.year) : ''
      const cites =
        typeof paper.citationCount === 'number' ? `引用 ${paper.citationCount}` : ''
      const venue = paper.venue?.trim() || ''
      const abstract = (paper.abstract || '').trim().slice(0, 1200)
      const url =
        paper.openAccessPdf?.url ||
        paper.url ||
        (paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : '') ||
        (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : '')

      const meta = [authors, year, venue, cites].filter(Boolean).join(' · ')
      const snippet = [meta, abstract].filter(Boolean).join('\n')

      return {
        title,
        url,
        snippet: snippet.slice(0, 3000),
        provider: 'semantic-scholar',
        sourceType: '学术论文',
        fetchedAt
      }
    })
    .filter((item): item is WebSearchResult => item !== null)
}
