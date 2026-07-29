/**
 * 独立联网搜索模块：与 LLM provider 解耦。
 * - zhipu-native：智谱原生 web_search tool（需引擎本身是智谱）
 * - none：不附带 tool（仅注入提示词，由模型自行说明无法检索）
 * 后续可在此扩展 SerpAPI / Tavily / SearXNG 等适配器。
 */
import type { AiLlmSettings, AiProvider, AiSettings } from './global'
import { detectProvider } from './aiProvider'

export type WebSearchBackendId = 'auto' | 'zhipu-native' | 'none'

export interface WebSearchBackendMeta {
  id: WebSearchBackendId
  label: string
  description: string
}

export const WEB_SEARCH_BACKENDS: WebSearchBackendMeta[] = [
  {
    id: 'auto',
    label: '自动',
    description: '智谱引擎用原生搜索，其它引擎仅提示词'
  },
  {
    id: 'zhipu-native',
    label: '智谱原生搜索',
    description: '仅当对话引擎为智谱时生效'
  },
  {
    id: 'none',
    label: '仅提示（无 tool）',
    description: '不向模型下发搜索 tool，只附带联网说明'
  }
]

export function resolveWebSearchBackend(
  settings: Pick<AiSettings, 'webSearch'>,
  engine: AiLlmSettings & { provider?: AiProvider }
): Exclude<WebSearchBackendId, 'auto'> {
  const configured = (settings.webSearch as { backend?: WebSearchBackendId } | undefined)?.backend
  if (configured === 'none' || configured === 'zhipu-native') return configured
  // auto
  const provider = engine.provider || detectProvider(engine.baseUrl || '')
  return provider === 'zhipu' ? 'zhipu-native' : 'none'
}

/**
 * 构建可传给 OpenAI 兼容 chat.completions 的 tools。
 * 返回 undefined 表示本轮不附带搜索 tool。
 */
export function buildWebSearchTools(
  settings: Pick<AiSettings, 'webSearch'>,
  engine: AiLlmSettings & { provider?: AiProvider }
): unknown[] | undefined {
  if (!settings.webSearch?.enabled) return undefined
  const backend = resolveWebSearchBackend(settings, engine)
  if (backend === 'zhipu-native') {
    const provider = engine.provider || detectProvider(engine.baseUrl || '')
    if (provider !== 'zhipu') return undefined
    return [{ type: 'web_search', web_search: { search_engine: 'search-pro' } }]
  }
  return undefined
}

/** @deprecated 兼容旧 import 路径：仅按引擎猜智谱 */
export function buildWebSearchToolsForEngine(
  config: AiLlmSettings & { provider?: AiProvider }
): unknown[] | undefined {
  return buildWebSearchTools({ webSearch: { enabled: true, prompt: '' } }, config)
}
