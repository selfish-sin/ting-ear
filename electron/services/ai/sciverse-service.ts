import axios from 'axios'
import type { WebSearchResult } from './web-search-service'

/**
 * SciVerse meta-search — 学术元数据检索（上海 AI Lab OpenDataLab）。
 * POST https://api.sciverse.space/meta-search
 * Auth: Bearer <token>（控制台申请，有免费起步配额）
 * 文档: https://sciverse.space/docs/sciverse/api/meta-search
 *
 * 返回论文标题/DOI/年份/期刊等元数据，适合社科与理工文献列表；
 * 全文证据需另用 agentic-search（后续可扩展）。
 */
export interface SciVerseOptions {
  maxResults?: number
  signal?: AbortSignal
  apiKey: string
  baseUrl?: string
  /** 起始年份过滤，默认不限 */
  yearGte?: number
}

interface SciVerseHit {
  title?: string
  doi?: string
  abstract?: string
  publication_published_year?: number
  publication_venue_name_unified?: string
  citation_count?: number
  author?: Array<{ name?: string }>
  doc_id?: string
  unique_id?: string
}

export async function sciverseMetaSearch(
  query: string,
  options: SciVerseOptions
): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 300)
  const key = options.apiKey?.trim()
  if (!q || !key) return []

  const maxResults = Math.min(20, Math.max(1, options.maxResults ?? 5))
  const baseUrl = (options.baseUrl || 'https://api.sciverse.space').replace(/\/+$/, '')

  const body: Record<string, unknown> = {
    query: q,
    collection: 'papers',
    fields: [
      'title',
      'doi',
      'abstract',
      'publication_published_year',
      'publication_venue_name_unified',
      'citation_count',
      'author',
      'doc_id'
    ],
    page: 1,
    page_size: maxResults
  }
  if (typeof options.yearGte === 'number' && options.yearGte > 0) {
    body.filters = [
      {
        field: 'publication_published_year',
        operator: 'FILTER_OP_GTE',
        value: options.yearGte
      }
    ]
  }

  const resp = await axios.post(`${baseUrl}/meta-search`, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'ting-ear/1.0 (desktop reader; sciverse meta-search)'
    },
    timeout: 20_000,
    signal: options.signal
  })

  const raw = resp.data?.results
  if (!Array.isArray(raw)) return []
  const fetchedAt = new Date().toISOString()

  return raw
    .map((hit: SciVerseHit): WebSearchResult | null => {
      const title = (hit.title || '').trim()
      if (!title) return null
      const authors = (hit.author || [])
        .map((a) => a.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ')
      const year = hit.publication_published_year ? String(hit.publication_published_year) : ''
      const venue = hit.publication_venue_name_unified?.trim() || ''
      const cites =
        typeof hit.citation_count === 'number' ? `引用 ${hit.citation_count}` : ''
      const abstract = (hit.abstract || '').trim().slice(0, 1200)
      const doi = hit.doi?.trim()
      const url = doi
        ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}`
        : hit.doc_id
          ? `https://sciverse.space` // 无 DOI 时仅作标识
          : ''

      const meta = [authors, year, venue, cites, doi ? `DOI ${doi}` : ''].filter(Boolean).join(' · ')
      const snippet = [meta, abstract].filter(Boolean).join('\n')

      return {
        title,
        url,
        snippet: snippet.slice(0, 3000),
        provider: 'sciverse',
        sourceType: '学术论文',
        fetchedAt
      }
    })
    .filter((item): item is WebSearchResult => item !== null)
}
