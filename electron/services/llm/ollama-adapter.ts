/**
 * Ollama 原生 API 适配器。
 *
 * 调用 `POST /api/chat`，格式与 OpenAI 不同。
 * 参考：https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import type { ILLMAdapter, ChatMessage, ChatOptions } from './adapter'

export class OllamaAdapter implements ILLMAdapter {
  readonly provider = 'ollama'
  readonly model: string
  readonly contextWindow: number
  private baseUrl: string

  constructor(config: { baseUrl: string; model: string; contextWindow: number }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.model = config.model
    this.contextWindow = config.contextWindow
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const body = {
      model: this.model,
      messages,
      stream: false,
      // 清洗场景不需要推理过程：关闭 thinking，让模型直接给最终答案，更快、更省 token。
      // 注意：Ollama 标准行为下 message.content 始终含最终答案（think:false 不会把答案放进 thinking）。
      // 若个别模型在 think:false 下原样复读输入，由上层 text-cleaner 的"长度兜底"自动回退到正则清洗。
      think: false,
      options: {
        temperature: options?.temperature ?? 0.3,
        num_predict: options?.maxTokens ?? 4096
      }
    }

    console.info(`[Ollama] POST ${this.baseUrl}/api/chat model=${this.model}`)

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`Ollama API error ${resp.status}: ${errText}`)
    }

    const data = (await resp.json()) as {
      message?: { content?: string; thinking?: string }
      error?: string
    }
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`)
    }
    // 优先取 content；极个别模型在 think 关闭后 content 为空、答案跑到 thinking，兜底取 thinking
    const content = data.message?.content || data.message?.thinking || ''
    console.info(`[Ollama] response: ${content.length} chars`)
    return content
  }

  async testConnection(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      if (!resp.ok) return false
      const data = await resp.json() as { models?: Array<{ name: string }> }
      return (data.models || []).some((m) => m.name.startsWith(this.model.replace(/:.*$/, '')))
    } catch {
      return false
    }
  }
}
