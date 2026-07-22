/**
 * LLM 适配器接口 + 公共类型。
 *
 * 所有适配器（Ollama / OpenAI-compatible）实现此接口，
 * 上层（text-cleaner）只依赖接口，不关心具体实现。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 取消信号：传入后可在请求进行中中断（硬取消） */
  signal?: AbortSignal
}

export interface ILLMAdapter {
  /** 适配器标识，如 'ollama' | 'openai' */
  readonly provider: string
  /** 模型名，如 'qwen3.5:4b' | 'deepseek-chat' */
  readonly model: string
  /** 模型上下文窗口大小（tokens） */
  readonly contextWindow: number

  /**
   * 发送对话请求，返回模型回复文本。
   * 出错时抛出 Error。
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>

  /** 检查连接是否可用 */
  testConnection(): Promise<boolean>
}

/** 用户保存的 LLM 配置 */
export interface LLMConfig {
  id: string
  provider: 'ollama' | 'openai'
  name: string
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxTokens: number
  temperature: number
}

/** 预设模型定义 */
export interface LLMPreset {
  id: string
  provider: 'ollama' | 'openai'
  name: string
  baseUrl: string
  model: string
  contextWindow: number
  maxTokens: number
  temperature: number
}

/**
 * 内置模型预设。
 *
 * 上下文窗口值来源于各模型官方文档（2026-07）。
 * 分块时根据有效窗口动态计算 chunk 大小，无需用户手动调整。
 */
export const LLM_PRESETS: LLMPreset[] = [
  {
    id: 'qwen3.5-4b',
    provider: 'ollama',
    name: '千问 3.5 4B（本地 · 免费）',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3.5:4b',
    contextWindow: 32768,
    maxTokens: 4096,
    temperature: 0.3
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'openai',
    name: 'DeepSeek V4 Flash（云端）',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    contextWindow: 1000000,
    maxTokens: 8192,
    temperature: 0.3
  },
  {
    id: 'glm-4.5-air',
    provider: 'openai',
    name: '智谱 GLM-4.5 Air（云端）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    contextWindow: 131072,
    maxTokens: 4096,
    temperature: 0.3
  }
]
