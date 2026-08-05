/**
 * 独立联网搜索模块：与 LLM provider 解耦。
 * 实际检索在主进程 `web-search-service.ts` 完成（Ollama / 智谱 / DDG）。
 * 本文件仅处理：设置项元数据、以及「是否向模型下发智谱原生 tool」的兼容逻辑。
 */
import type { AiLlmSettings, AiProvider, AiSettings } from './global'
import { detectProvider } from './aiProvider'

export type WebSearchBackendId = 'auto' | 'ollama' | 'zhipu' | 'zhipu-native' | 'ddg' | 'none'

export interface WebSearchBackendMeta {
  id: WebSearchBackendId
  label: string
  description: string
}

export const WEB_SEARCH_BACKENDS: WebSearchBackendMeta[] = [
  {
    id: 'auto',
    label: '自动切换',
    description: '有 Ollama Key 先 Ollama，再智谱独立搜索，最后 DuckDuckGo'
  },
  {
    id: 'ollama',
    label: 'Ollama Cloud',
    description: 'ollama.com/api/web_search，与对话模型无关'
  },
  {
    id: 'zhipu',
    label: '智谱独立搜索',
    description: '单独调智谱 search-pro，不要求对话模型是智谱'
  },
  {
    id: 'ddg',
    label: 'DuckDuckGo',
    description: '免费无 Key，结果质量一般，作兜底'
  },
  {
    id: 'zhipu-native',
    label: '智谱原生 tool（旧）',
    description: '仅当对话引擎为智谱时向模型下发 tool'
  },
  {
    id: 'none',
    label: '关闭真实搜索',
    description: '不发起 HTTP 搜索'
  }
]

/** 解析主进程实际使用的搜索后端（不含 zhipu-native tool 路径） */
export function resolveWebSearchHttpBackend(
  settings: Pick<AiSettings, 'webSearch'>
): 'auto' | 'ollama' | 'zhipu' | 'ddg' | 'none' {
  const configured = settings.webSearch?.backend
  if (configured === 'none') return 'none'
  if (configured === 'ollama') return 'ollama'
  if (configured === 'zhipu' || configured === 'zhipu-native') return 'zhipu'
  if (configured === 'ddg') return 'ddg'
  return 'auto'
}

/**
 * @deprecated 保留给旧调用；新逻辑请用 resolveWebSearchHttpBackend
 */
export function resolveWebSearchBackend(
  settings: Pick<AiSettings, 'webSearch'>,
  engine: AiLlmSettings & { provider?: AiProvider }
): Exclude<WebSearchBackendId, 'auto'> {
  const configured = settings.webSearch?.backend
  if (configured === 'none' || configured === 'ollama' || configured === 'zhipu') {
    return configured
  }
  if (configured === 'zhipu-native') return 'zhipu-native'
  // auto：仅影响「是否下发原生 tool」；HTTP 搜索在主进程另算
  const provider = engine.provider || detectProvider(engine.baseUrl || '')
  return provider === 'zhipu' ? 'zhipu-native' : 'none'
}

/**
 * 构建可传给 OpenAI 兼容 chat.completions 的 tools。
 * 仅 zhipu-native 且对话引擎为智谱时返回 tool；Ollama/独立搜索不走 tool。
 */
export function buildWebSearchTools(
  settings: Pick<AiSettings, 'webSearch'>,
  engine: AiLlmSettings & { provider?: AiProvider }
): unknown[] | undefined {
  if (!settings.webSearch?.enabled) return undefined
  if (settings.webSearch.backend !== 'zhipu-native') return undefined
  const provider = engine.provider || detectProvider(engine.baseUrl || '')
  if (provider !== 'zhipu') return undefined
  return [{ type: 'web_search', web_search: { search_engine: 'search-pro' } }]
}

/** @deprecated 兼容旧 import 路径 */
export function buildWebSearchToolsForEngine(
  config: AiLlmSettings & { provider?: AiProvider }
): unknown[] | undefined {
  return buildWebSearchTools({ webSearch: { enabled: true, prompt: '', backend: 'zhipu-native' } }, config)
}
