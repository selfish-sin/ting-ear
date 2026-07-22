/**
 * OpenAI 兼容 API 适配器。
 *
 * 覆盖所有提供 `/v1/chat/completions` 端点的服务：
 * DeepSeek、智谱 GLM、阿里百炼、OpenAI 等。
 *
 * 参考：https://platform.openai.com/docs/api-reference/chat
 */

import type { ILLMAdapter, ChatMessage, ChatOptions } from './adapter'

export class OpenAIAdapter implements ILLMAdapter {
  readonly provider = 'openai'
  readonly model: string
  readonly contextWindow: number
  private baseUrl: string
  private apiKey: string

  constructor(config: { baseUrl: string; apiKey: string; model: string; contextWindow: number }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this.contextWindow = config.contextWindow
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const body = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false
    }

    console.info(`[OpenAI] POST ${this.baseUrl}/chat/completions model=${this.model}`)

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: options?.signal
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`OpenAI API error ${resp.status}: ${errText.slice(0, 300)}`)
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      error?: { message?: string }
    }

    if (data.error) {
      throw new Error(`API error: ${data.error.message || 'unknown'}`)
    }

    const content = data.choices?.[0]?.message?.content || ''
    // 推理模型（如 deepseek-v4-flash、deepseek-reasoner）把思考过程放进 reasoning_content，
    // 真正答案在 content。若 content 为空但 reasoning_content 有值，说明推理"思考"耗尽了
    // 输出预算（max_tokens 被思考吃光，没 token 输出答案）。
    // 此时不能取 reasoning_content（那是思考过程不是答案），也不能静默返回空——
    // 抛带特殊标记的错误，让上层提示用户切换到非推理模型（如 deepseek-chat）。
    const reasoning = data.choices?.[0]?.message?.reasoning_content || ''
    if (!content && reasoning) {
      throw new Error(
        '__REASONING_OVERFLOW__ 推理模型思考耗尽输出预算（content 为空，reasoning_content 有值）。清洗任务建议使用非推理模型（如 deepseek-chat），或在模型设置里调大 max_tokens。'
      )
    }
    console.info(`[OpenAI] response: ${content.length} chars${reasoning ? ` (reasoning ${reasoning.length} chars)` : ''}`)
    return content
  }

  async testConnection(): Promise<boolean> {
    if (!this.apiKey) return false
    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false
        }),
        signal: AbortSignal.timeout(10000)
      })
      return resp.ok
    } catch {
      return false
    }
  }
}
