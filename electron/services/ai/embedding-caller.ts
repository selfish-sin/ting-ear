import axios from 'axios'
import type { AiEmbeddingSettings } from '../../../src/global'
import { sanitizeBaseUrlInput } from './llm-caller'

export interface EmbeddingResult {
  vectors: number[][]
  dimension: number
}

/**
 * 嵌入服务的可重试错误：5xx / 429 / 网络层（连接超时、断连等）。
 * 4xx（除 429）通常是参数/鉴权问题，重试无意义，直接上抛。
 */
function isRetryableEmbeddingError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    // 网络层错误（无 response）：ECONNRESET / ETIMEDOUT / 502 网关断连等
    if (!error.response) return true
    const status = error.response.status
    return status === 429 || (status >= 500 && status <= 599)
  }
  return false
}

function describeEmbeddingError(error: unknown): string {
  if (axios.isAxiosError(error) && error.response) {
    const status = error.response.status
    let detail = ''
    const d = error.response.data
    if (typeof d === 'string') detail = d.slice(0, 200)
    else if (d && typeof d === 'object') {
      try { detail = JSON.stringify(d).slice(0, 200) } catch { detail = '' }
    }
    return `嵌入服务返回 HTTP ${status}${detail ? `：${detail}` : ''}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/** 带指数退避的单批嵌入请求：瞬时 502/网关抖动不再让整本向量化失败。 */
async function postEmbeddingBatchWithRetry(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  maxAttempts = 4,
  baseDelayMs = 800
): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('cancelled')
    try {
      const resp = await axios.post(url, body, {
        headers,
        timeout: 120_000,
        signal
      })
      return resp.data
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw new Error('cancelled')
      if (!isRetryableEmbeddingError(error) || attempt === maxAttempts) {
        throw new Error(describeEmbeddingError(error))
      }
      // 指数退避 + 抖动：800ms → 1.6s → 3.2s …
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay)
        const onAbort = (): void => {
          clearTimeout(t)
          reject(new Error('cancelled'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  // 理论上不可达
  throw new Error(describeEmbeddingError(lastError))
}

/**
 * 调用 OpenAI 兼容 /embeddings 接口，返回向量数组。
 * 支持 batchSize 分批（避免单次请求过大）。
 */
export async function callEmbedding(
  texts: string[],
  settings: AiEmbeddingSettings,
  signal?: AbortSignal
): Promise<EmbeddingResult> {
  const baseUrl = sanitizeBaseUrlInput(settings.baseUrl)
  if (!baseUrl) throw new Error('未配置嵌入模型 API 地址')
  if (!settings.model) throw new Error('未配置嵌入模型名称')

  const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`
  const batchSize = settings.batchSize > 0 ? settings.batchSize : 32
  const allVectors: number[][] = []
  let dimension = 0

  for (let i = 0; i < texts.length; i += batchSize) {
    if (signal?.aborted) throw new Error('cancelled')
    const batch = texts.slice(i, i + batchSize)

    const body: Record<string, unknown> = {
      model: settings.model,
      input: batch
    }
    if (settings.dimension > 0) body.dimensions = settings.dimension

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    }

    const data = await postEmbeddingBatchWithRetry(url, body, headers, signal)
    if (!data || typeof data !== 'object' || !Array.isArray((data as { data?: unknown }).data)) {
      throw new Error(`嵌入 API 返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    }

    // 按 index 排序确保顺序
    const sorted = (data as { data: Array<{ index: number; embedding: number[] }> }).data.sort(
      (a, b) => a.index - b.index
    )
    for (const item of sorted) {
      allVectors.push(item.embedding)
      if (!dimension) dimension = item.embedding.length
    }
  }

  return { vectors: allVectors, dimension }
}
