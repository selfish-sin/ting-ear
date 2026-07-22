/**
 * 适配器工厂：从 LLMConfig 创建对应的适配器实例。
 */

import type { ILLMAdapter, LLMConfig } from './adapter'
import { OllamaAdapter } from './ollama-adapter'
import { OpenAIAdapter } from './openai-adapter'

export function createAdapter(config: LLMConfig): ILLMAdapter {
  if (config.provider === 'ollama') {
    return new OllamaAdapter({
      baseUrl: config.baseUrl,
      model: config.model,
      contextWindow: config.contextWindow
    })
  }
  // openai-compatible (covers DeepSeek, GLM, etc.)
  return new OpenAIAdapter({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    contextWindow: config.contextWindow
  })
}
