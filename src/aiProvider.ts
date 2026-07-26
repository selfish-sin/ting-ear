import type { AiLlmSettings, AiProvider } from './global'

/** 根据 baseUrl 自动推断提供商 */
export function detectProvider(baseUrl: string): AiProvider {
  const url = baseUrl.toLowerCase()
  if (url.includes('bigmodel.cn') || url.includes('zhipuai')) return 'zhipu'
  if (url.includes('volces.com') || url.includes('volcengine')) return 'volcengine'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('siliconflow')) return 'siliconflow'
  if (url.includes('dashscope') || url.includes('aliyuncs')) return 'dashscope'
  if (url.includes('moonshot')) return 'moonshot'
  if (url.includes('xf-yun') || url.includes('iflytek')) return 'spark'
  if (url.includes('openai.com') || url.includes('api.openai')) return 'openai'
  return 'other'
}

export interface ProviderPreset {
  provider: AiProvider
  label: string
  baseUrl: string
  defaultModel: string
  defaultFallback: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: 'zhipu',
    label: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    defaultFallback: 'glm-4-flash'
  },
  {
    provider: 'volcengine',
    label: '火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k',
    defaultFallback: 'doubao-1-5-lite-32k'
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    defaultFallback: ''
  },
  {
    provider: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    defaultFallback: 'Qwen/Qwen2.5-72B-Instruct'
  },
  {
    provider: 'dashscope',
    label: '通义千问（百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    defaultFallback: 'qwen-turbo'
  },
  {
    provider: 'moonshot',
    label: 'Moonshot（Kimi）',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    defaultFallback: ''
  },
  {
    provider: 'spark',
    label: '讯飞星火',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    defaultModel: 'generalv3.5',
    defaultFallback: ''
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultFallback: ''
  },
  {
    provider: 'other',
    label: '其他（OpenAI 兼容）',
    baseUrl: '',
    defaultModel: '',
    defaultFallback: ''
  }
]

/** 构建联网搜索 tools 参数——仅智谱支持原生 web_search */
export function buildWebSearchTools(
  config: AiLlmSettings & { provider?: AiProvider }
): unknown[] | undefined {
  const provider = config.provider || detectProvider(config.baseUrl)
  if (provider === 'zhipu') {
    return [{ type: 'web_search', web_search: { search_engine: 'search-pro' } }]
  }
  // 其他提供商暂不支持内置联网搜索 tool
  return undefined
}
