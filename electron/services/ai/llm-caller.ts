import type { AiLlmSettings, AiPromptMessage } from '../../../src/global'
import axios from 'axios'

export type AiErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'timeout'
  | 'model_error'
  | 'network_error'
  | 'cancelled'
  | 'invalid_response'

export class AiServiceError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'AiServiceError'
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`
}

function requestModelId(config: AiLlmSettings, model: string): string {
  if (
    /bigmodel\.cn|zhipuai/i.test(config.baseUrl) &&
    model.trim().toLowerCase() === 'glm-4.7-flash'
  ) {
    return 'glm-4.7'
  }
  return model
}

function httpError(status: number, details: string): AiServiceError {
  if (status === 401 || status === 403) {
    return new AiServiceError('auth_failed', 'API Key 无效或没有访问权限', status)
  }
  if (status === 429) return new AiServiceError('rate_limited', '请求过于频繁，请稍后再试', status)
  if (status >= 500) return new AiServiceError('model_error', `模型服务暂时不可用：${details}`, status)
  return new AiServiceError('model_error', `模型请求失败（HTTP ${status}）：${details}`, status)
}

/** Electron's Node fetch does not read the system proxy environment variables. */
function useElectronProxyTransport(): boolean {
  return Boolean(
    process.versions.electron &&
    (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
  )
}

function axiosError(error: unknown, signal: AbortSignal, timedOut: boolean): AiServiceError {
  if (signal.aborted) return new AiServiceError('cancelled', '请求已取消')
  if (timedOut || (axios.isAxiosError(error) && error.code === 'ECONNABORTED')) {
    return new AiServiceError('timeout', '模型请求超时')
  }
  if (axios.isAxiosError(error) && error.response) {
    const details = typeof error.response.data === 'string' ? error.response.data.slice(0, 300) : ''
    return httpError(error.response.status, details)
  }
  return new AiServiceError(
    'network_error',
    `无法连接模型服务：${error instanceof Error ? error.message : String(error)}`
  )
}

async function readAxiosBody(stream: NodeJS.ReadableStream): Promise<string> {
  let result = ''
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    result += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (result.length >= 300) break
  }
  return result.slice(0, 300)
}

export async function listModels(config: AiLlmSettings): Promise<string[]> {
  if (useElectronProxyTransport()) {
    try {
      const response = await axios.get(modelsEndpoint(config.baseUrl), {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        timeout: Math.max(1, config.timeoutMs)
      })
      const payload = response.data as { data?: unknown; models?: unknown }
      const raw = payload?.data ?? payload?.models
      if (!Array.isArray(raw)) throw new AiServiceError('invalid_response', '模型服务未返回模型列表')
      const models = raw.flatMap((item): string[] => {
        if (typeof item === 'string') return item.trim() ? [item.trim()] : []
        if (!item || typeof item !== 'object') return []
        const value = item as { id?: unknown; name?: unknown }
        const id = typeof value.id === 'string' ? value.id : value.name
        return typeof id === 'string' && id.trim() ? [id.trim()] : []
      })
      return [...new Set(models)].sort((left, right) => left.localeCompare(right))
    } catch (error) {
      throw axiosError(error, new AbortController().signal, false)
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.timeoutMs))
  try {
    let response: Response
    try {
      response = await fetch(modelsEndpoint(config.baseUrl), {
        method: 'GET',
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) throw new AiServiceError('timeout', '获取模型列表超时')
      throw new AiServiceError(
        'network_error',
        `无法连接模型服务：${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!response.ok) {
      throw httpError(response.status, (await response.text()).slice(0, 300))
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AiServiceError('invalid_response', '模型列表不是有效的 JSON')
    }
    const raw = (payload as { data?: unknown; models?: unknown })?.data ??
      (payload as { models?: unknown })?.models
    if (!Array.isArray(raw)) {
      throw new AiServiceError('invalid_response', '模型服务未返回模型列表')
    }
    const models = raw.flatMap((item): string[] => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : []
      if (!item || typeof item !== 'object') return []
      const value = item as { id?: unknown; name?: unknown }
      const id = typeof value.id === 'string' ? value.id : value.name
      return typeof id === 'string' && id.trim() ? [id.trim()] : []
    })
    return [...new Set(models)].sort((left, right) => left.localeCompare(right))
  } finally {
    clearTimeout(timeout)
  }
}

function contentFromData(data: string): string | null {
  if (!data || data === '[DONE]') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new AiServiceError('invalid_response', '模型返回了无法解析的流式数据')
  }

  const error = (parsed as { error?: unknown }).error
  if (error) {
    const message =
      typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '模型服务返回错误')
        : String(error)
    throw new AiServiceError('model_error', `模型服务返回错误：${message}`)
  }

  const content = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta
    ?.content
  return typeof content === 'string' ? content : null
}

async function* requestModel(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  model: string,
  tools?: unknown[]
): AsyncGenerator<string> {
  if (useElectronProxyTransport()) {
    yield* requestModelViaAxios(config, messages, signal, model, tools)
    return
  }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  const idleMs = Math.max(1, config.timeoutMs)
  let timeout = setTimeout(() => controller.abort(), idleMs)
  const resetIdle = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(), idleMs)
  }

  try {
    let response: Response
    try {
      response = await fetch(endpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: config.temperature,
          stream: true,
          ...(tools && tools.length > 0 ? { tools } : {})
        }),
        signal: controller.signal
      })
    } catch (error) {
      if (signal.aborted) throw new AiServiceError('cancelled', '请求已取消')
      if (controller.signal.aborted) throw new AiServiceError('timeout', '模型请求超时')
      throw new AiServiceError(
        'network_error',
        `无法连接模型服务：${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!response.ok) {
      const details = (await response.text()).slice(0, 300)
      throw httpError(response.status, details)
    }
    if (!response.body) throw new AiServiceError('invalid_response', '模型响应没有可读取的数据流')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    let streamEnded = false
    let receivedContent = false

    while (!done && !streamEnded) {
      const result = await reader.read()
      done = result.done
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          streamEnded = true
          break
        }
        const content = contentFromData(data)
        if (content) {
          resetIdle()
          if (content.trim()) receivedContent = true
          yield content
        }
      }
    }

    if (!streamEnded && buffer.startsWith('data:')) {
      const content = contentFromData(buffer.slice(5).trim())
      if (content) {
        if (content.trim()) receivedContent = true
        yield content
      }
    }

    if (!receivedContent) throw new AiServiceError('invalid_response', '模型响应未包含有效正文')
  } catch (error) {
    if (error instanceof AiServiceError) throw error
    if (signal.aborted) throw new AiServiceError('cancelled', '请求已取消')
    if (controller.signal.aborted) throw new AiServiceError('timeout', '模型请求超时')
    throw new AiServiceError(
      'network_error',
      `读取模型响应失败：${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

async function* requestModelViaAxios(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  model: string,
  tools?: unknown[]
): AsyncGenerator<string> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  let timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, config.timeoutMs))
  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1, config.timeoutMs))
  }

  try {
    const response = await axios.post(endpoint(config.baseUrl), {
      model,
      messages,
      temperature: config.temperature,
      stream: true,
      ...(tools && tools.length > 0 ? { tools } : {})
    }, {
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      responseType: 'stream',
      timeout: Math.max(1, config.timeoutMs),
      signal: controller.signal
    })

    if (response.status < 200 || response.status >= 300) {
      const details = await readAxiosBody(response.data)
      throw httpError(response.status, details)
    }

    let buffer = ''
    let streamEnded = false
    let receivedContent = false
    resetTimeout()
    for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
      resetTimeout()
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          streamEnded = true
          break
        }
        const content = contentFromData(data)
        if (content) {
          if (content.trim()) receivedContent = true
          yield content
        }
      }
      if (streamEnded) break
    }

    if (!streamEnded && buffer.startsWith('data:')) {
      const content = contentFromData(buffer.slice(5).trim())
      if (content) {
        if (content.trim()) receivedContent = true
        yield content
      }
    }
    if (!receivedContent) throw new AiServiceError('invalid_response', '模型响应未包含有效正文')
  } catch (error) {
    if (error instanceof AiServiceError) throw error
    throw axiosError(error, signal, timedOut)
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

export async function* streamChat(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  tools?: unknown[]
): AsyncGenerator<string> {
  try {
    yield* requestModel(config, messages, signal, requestModelId(config, config.model), tools)
  } catch (error) {
    if (
      config.fallbackModel &&
      config.fallbackModel !== config.model &&
      error instanceof AiServiceError &&
      error.code === 'model_error' &&
      !signal.aborted
    ) {
      yield* requestModel(config, messages, signal, requestModelId(config, config.fallbackModel), tools)
      return
    }
    throw error
  }
}
