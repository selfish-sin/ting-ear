import axios from 'axios'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  /** 搜索提供方 */
  provider?: 'ollama' | 'zhipu' | 'ddg' | 'semantic-scholar' | 'sciverse'
  /** 结果类型标签，用于 UI 展示 */
  sourceType?: string
  /** 检索时间 ISO */
  fetchedAt?: string
}

export interface WebSearchOptions {
  maxResults?: number
  signal?: AbortSignal
  /** Ollama Cloud web_search */
  ollama?: { apiKey: string; baseUrl?: string } | null
  /** 智谱 search-pro（需智谱 key；与对话模型解耦） */
  zhipu?: { apiKey: string; baseUrl?: string } | null
  /**
   * 首选后端：
   * - ollama / zhipu / ddg：强制指定（失败可回退 ddg，除 none）
   * - auto：有 Key 的依次试 Ollama → 智谱 → DDG
   * - none：不搜索
   */
  preferred?: 'auto' | 'ollama' | 'zhipu' | 'ddg' | 'none'
}

/**
 * 统一网络搜索（与对话模型厂商解耦）。
 * 默认优先 Ollama Cloud `POST /api/web_search`，失败再尝试智谱 / DuckDuckGo。
 */
export async function webSearch(
  query: string,
  maxResultsOrOptions: number | WebSearchOptions = 5,
  signalLegacy?: AbortSignal,
  zhipuLegacy?: { apiKey: string; baseUrl?: string } | null
): Promise<WebSearchResult[]> {
  // 兼容旧签名：webSearch(query, maxResults, signal, zhipu)
  const options: WebSearchOptions =
    typeof maxResultsOrOptions === 'number'
      ? {
          maxResults: maxResultsOrOptions,
          signal: signalLegacy,
          zhipu: zhipuLegacy
        }
      : maxResultsOrOptions

  const maxResults = options.maxResults ?? 5
  const signal = options.signal
  const preferred = options.preferred ?? 'auto'

  if (preferred === 'none') return []

  const fetchedAt = new Date().toISOString()
  const order = resolveProviderOrder(preferred, options)
  const errors: string[] = []

  for (const provider of order) {
    try {
      let results: WebSearchResult[] = []
      if (provider === 'ollama' && options.ollama?.apiKey) {
        results = await ollamaSearch(query, maxResults, options.ollama, signal)
      } else if (provider === 'zhipu' && options.zhipu?.apiKey) {
        results = await zhipuSearch(query, options.zhipu, signal)
      } else if (provider === 'ddg') {
        results = await ddgSearch(query, maxResults, signal)
      } else if (provider === 'ollama' && !options.ollama?.apiKey) {
        errors.push('ollama: 未配置 API Key')
        continue
      } else if (provider === 'zhipu' && !options.zhipu?.apiKey) {
        errors.push('zhipu: 未配置 API Key')
        continue
      }
      if (results.length > 0) {
        return results.map((r) => ({
          ...r,
          provider: r.provider || provider,
          sourceType: r.sourceType || defaultSourceType(provider, r.url),
          fetchedAt: r.fetchedAt || fetchedAt
        }))
      }
      errors.push(`${provider}: 无结果`)
    } catch (error) {
      // 尝试下一个提供方，但保留错误供最终诊断
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 全部失败时抛出可读错误，避免工具层只看到空数组却不知道原因
  if (errors.length > 0 && order.length > 0) {
    throw new Error(`联网搜索全部失败（${errors.join('；')}）`)
  }

  return []
}

function resolveProviderOrder(
  preferred: NonNullable<WebSearchOptions['preferred']>,
  options: WebSearchOptions
): Array<'ollama' | 'zhipu' | 'ddg'> {
  if (preferred === 'ollama') return ['ollama', 'ddg']
  if (preferred === 'zhipu') return ['zhipu', 'ddg']
  if (preferred === 'ddg') return ['ddg']
  // auto：有哪个 Key 用哪个，最后 DDG 兜底
  const order: Array<'ollama' | 'zhipu' | 'ddg'> = []
  if (options.ollama?.apiKey) order.push('ollama')
  if (options.zhipu?.apiKey) order.push('zhipu')
  order.push('ddg')
  return order
}

function defaultSourceType(provider: string, url: string): string {
  if (provider === 'ollama') return classifyUrlType(url) || '网页'
  if (provider === 'zhipu') return '智谱搜索'
  if (provider === 'ddg') return classifyUrlType(url) || '网页'
  return '网页'
}

/** 根据域名粗分类型，便于 UI 标签展示 */
export function classifyUrlType(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('pubmed') || host.includes('nih.gov')) return '学术数据库'
    if (host.includes('arxiv.org')) return '学术预印本'
    if (host.includes('wikipedia') || host.includes('wiki')) return '百科'
    if (
      host.includes('xinhua') ||
      host.includes('people.com.cn') ||
      host.includes('bbc.') ||
      host.includes('reuters') ||
      host.includes('nytimes')
    ) {
      return '权威新闻'
    }
    if (host.includes('github.com') || host.includes('stackoverflow')) return '技术社区'
    if (host.endsWith('.gov') || host.endsWith('.gov.cn')) return '政府网站'
    if (host.endsWith('.edu') || host.endsWith('.edu.cn')) return '教育机构'
    return '网页'
  } catch {
    return '网页'
  }
}

/**
 * Ollama Cloud Web Search
 * POST https://ollama.com/api/web_search
 * Auth: Bearer <OLLAMA_API_KEY>
 * Body: { query, max_results? }
 * Response: { results: [{ title, url, content }] }
 */
async function ollamaSearch(
  query: string,
  maxResults: number,
  config: { apiKey: string; baseUrl?: string },
  signal?: AbortSignal
): Promise<WebSearchResult[]> {
  const baseUrl = (config.baseUrl || 'https://ollama.com').replace(/\/+$/, '')
  const resp = await axios.post(
    `${baseUrl}/api/web_search`,
    {
      query,
      max_results: Math.min(Math.max(1, maxResults), 10)
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      timeout: 20_000,
      signal
    }
  )

  const raw = resp.data?.results
  if (!Array.isArray(raw)) return []

  return raw
    .map((item: { title?: unknown; url?: unknown; content?: unknown; snippet?: unknown }) => {
      const title = typeof item.title === 'string' ? item.title : ''
      const url = typeof item.url === 'string' ? item.url : ''
      const snippet =
        typeof item.content === 'string'
          ? item.content
          : typeof item.snippet === 'string'
            ? item.snippet
            : ''
      if (!title && !url && !snippet) return null
      return {
        title: title || url || '未命名来源',
        url,
        snippet: snippet.slice(0, 3000),
        provider: 'ollama' as const,
        sourceType: classifyUrlType(url)
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, maxResults)
}

/**
 * 智谱搜索：调 glm-4-flash + web_search tool (search-pro)。
 * 注意：这是独立搜索调用，不依赖对话引擎是否为智谱模型。
 */
async function zhipuSearch(
  query: string,
  config: { apiKey: string; baseUrl?: string },
  signal?: AbortSignal
): Promise<WebSearchResult[]> {
  const baseUrl = (config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '')
  const resp = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model: 'glm-4-flash',
      messages: [{ role: 'user', content: query }],
      tools: [{ type: 'web_search', web_search: { search_engine: 'search-pro' } }],
      stream: false
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      timeout: 20_000,
      signal
    }
  )

  const content: string = resp.data?.choices?.[0]?.message?.content || ''
  if (!content) return []

  return [
    {
      title: '智谱搜索',
      url: '',
      snippet: content.slice(0, 3000),
      provider: 'zhipu',
      sourceType: '智谱搜索'
    }
  ]
}

/**
 * DuckDuckGo HTML 轻量搜索（免费、无 key、无需代理）。
 */
async function ddgSearch(
  query: string,
  maxResults = 5,
  signal?: AbortSignal
): Promise<WebSearchResult[]> {
  const url = 'https://lite.duckduckgo.com/lite/'
  const resp = await axios.post(url, `q=${encodeURIComponent(query)}`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 15_000,
    signal
  })

  const html: string = resp.data
  return parseDdgLite(html, maxResults).map((r) => ({
    ...r,
    provider: 'ddg' as const,
    sourceType: classifyUrlType(r.url)
  }))
}

/** 解析 DDG lite HTML */
function parseDdgLite(html: string, max: number): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi

  const links: Array<{ url: string; title: string }> = []
  let m: RegExpExecArray | null
  while ((m = linkRegex.exec(html)) !== null) {
    links.push({ url: cleanHtml(m[1]), title: cleanHtml(m[2]) })
  }

  const snippets: string[] = []
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(cleanHtml(m[1]))
  }

  for (let i = 0; i < links.length && results.length < max; i++) {
    const link = links[i]
    if (!link.url || link.url.includes('duckduckgo.com')) continue
    results.push({
      title: link.title || link.url,
      url: link.url,
      snippet: snippets[i] || ''
    })
  }

  return results
}

function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}
