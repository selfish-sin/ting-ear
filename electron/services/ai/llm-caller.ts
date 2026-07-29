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

/**
 * 清洗用户粘贴的 baseUrl：
 * - 去 BOM / 零宽字符 / 首尾空白
 * - 去掉误粘贴的成对引号（"..." 或 '...'）—— 这是 Invalid URL 的常见根因
 * - 去掉地址内部空白
 */
export function sanitizeBaseUrlInput(baseUrl: string | undefined | null): string {
  let raw = String(baseUrl ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
  // 反复剥外层引号（中英文）
  for (let i = 0; i < 3; i++) {
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('“') && raw.endsWith('”')) ||
      (raw.startsWith('‘') && raw.endsWith('’'))
    ) {
      raw = raw.slice(1, -1).trim()
      continue
    }
    break
  }
  // URL 内不应有空白
  raw = raw.replace(/\s+/g, '')
  return raw
}

/** 规范化并校验 OpenAI 兼容 baseUrl，避免 Node fetch 抛出含糊的 Invalid URL */
export function normalizeBaseUrl(baseUrl: string | undefined | null): string {
  const raw = sanitizeBaseUrlInput(baseUrl)
  if (!raw) {
    throw new AiServiceError(
      'model_error',
      '未配置模型 API 地址。请打开设置 → AI，填写引擎的「服务地址」（如 https://api.deepseek.com/v1）'
    )
  }
  // 允许用户省略协议时补 https
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new AiServiceError(
      'model_error',
      `模型 API 地址无效：${raw}。请去掉多余引号，使用完整 URL，例如 https://api.deepseek.com/v1`
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiServiceError('model_error', `模型 API 仅支持 http/https，当前为 ${parsed.protocol}`)
  }
  if (!parsed.hostname) {
    throw new AiServiceError('model_error', `模型 API 地址缺少主机名：${raw}`)
  }
  return withProtocol.replace(/\/+$/, '')
}

function endpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`
}

function modelsEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`
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

/**
 * 清洗代理环境变量。Windows 上常被写成带引号的：
 *   HTTPS_PROXY="http://127.0.0.1:7897"
 * 引号会进 process.env，axios 解析时报 Invalid URL。
 */
export function sanitizeProxyUrl(value: string | undefined | null): string | null {
  if (value == null) return null
  let raw = String(value)
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
  if (!raw) return null
  for (let i = 0; i < 3; i++) {
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('“') && raw.endsWith('”')) ||
      (raw.startsWith('‘') && raw.endsWith('’'))
    ) {
      raw = raw.slice(1, -1).trim()
      continue
    }
    break
  }
  raw = raw.replace(/\s+/g, '')
  if (!raw) return null
  // socks 等非 http(s) 代理留给其它实现；axios 默认代理只稳妥支持 http/https
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `http://${raw}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname) return null
    return withProtocol
  } catch {
    return null
  }
}

type AxiosProxyConfig = {
  protocol: string
  host: string
  port: number
  auth?: { username: string; password: string }
}

/** 从环境变量解析可用代理；去掉引号后非法则返回 null（走直连 fetch） */
export function resolveAxiosProxyConfig(): AxiosProxyConfig | null {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy
  ]
  for (const candidate of candidates) {
    const cleaned = sanitizeProxyUrl(candidate)
    if (!cleaned) continue
    try {
      const parsed = new URL(cleaned)
      const port =
        parsed.port && Number(parsed.port) > 0
          ? Number(parsed.port)
          : parsed.protocol === 'https:'
            ? 443
            : 80
      const config: AxiosProxyConfig = {
        protocol: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port
      }
      if (parsed.username) {
        config.auth = {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password || '')
        }
      }
      return config
    } catch {
      continue
    }
  }
  return null
}

/**
 * Electron 的 Node fetch 不读系统代理环境变量。
 * 仅在解析出合法代理时走 axios；带引号的非法代理不再强行走 axios。
 */
function useElectronProxyTransport(): boolean {
  return Boolean(process.versions.electron && resolveAxiosProxyConfig())
}

function axiosError(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
  requestUrl?: string
): AiServiceError {
  if (error instanceof AiServiceError) return error
  if (signal.aborted) return new AiServiceError('cancelled', '请求已取消')
  if (timedOut || (axios.isAxiosError(error) && error.code === 'ECONNABORTED')) {
    return new AiServiceError('timeout', '模型请求超时')
  }
  if (axios.isAxiosError(error) && error.response) {
    const details = typeof error.response.data === 'string' ? error.response.data.slice(0, 300) : ''
    return httpError(error.response.status, details)
  }
  const detail = error instanceof Error ? error.message : String(error)
  const proxy = resolveAxiosProxyConfig()
  const rawProxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    ''
  const proxyHint = /invalid url/i.test(detail)
    ? proxy
      ? `；当前代理 ${proxy.protocol}://${proxy.host}:${proxy.port}`
      : rawProxy
        ? `；本机代理环境变量非法（原始值：${rawProxy}），请去掉引号，例如 http://127.0.0.1:7897`
        : ''
    : ''
  const urlHint = requestUrl ? `（请求：${requestUrl}）` : ''
  return new AiServiceError(
    'network_error',
    `无法连接模型服务：${detail}${urlHint}${proxyHint}`
  )
}

/** axios 请求公共选项：显式传清洗后的 proxy，避免读取带引号的 env */
function axiosProxyOption(): { proxy: AxiosProxyConfig | false } {
  const proxy = resolveAxiosProxyConfig()
  // 显式 false 禁止 axios 再读脏的 process.env.*_PROXY
  return { proxy: proxy || false }
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
        timeout: Math.max(1, config.timeoutMs),
        ...axiosProxyOption()
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
      if (error instanceof AiServiceError) throw error
      throw axiosError(error, new AbortController().signal, false, modelsEndpoint(config.baseUrl))
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.timeoutMs))
  const modelsUrl = modelsEndpoint(config.baseUrl)
  try {
    let response: Response
    try {
      response = await fetch(modelsUrl, {
        method: 'GET',
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        signal: controller.signal
      })
    } catch (error) {
      if (error instanceof AiServiceError) throw error
      if (controller.signal.aborted) throw new AiServiceError('timeout', '获取模型列表超时')
      throw new AiServiceError(
        'network_error',
        `无法连接模型服务：${error instanceof Error ? error.message : String(error)}（请求：${modelsUrl}）`
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
  // SSE 注释行 / keep-alive，忽略
  if (data.startsWith(':')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    // 部分供应商会夹杂非 JSON 心跳，跳过而不是整段失败
    return null
  }

  const error = (parsed as { error?: unknown }).error
  if (error) {
    const message =
      typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '模型服务返回错误')
        : String(error)
    throw new AiServiceError('model_error', `模型服务返回错误：${message}`)
  }

  const choice = (parsed as {
    choices?: Array<{
      delta?: { content?: unknown }
      message?: { content?: unknown }
      text?: unknown
    }>
  }).choices?.[0]
  const fromDelta = choice?.delta?.content
  if (typeof fromDelta === 'string') return fromDelta
  const fromMessage = choice?.message?.content
  if (typeof fromMessage === 'string') return fromMessage
  if (typeof choice?.text === 'string') return choice.text
  return null
}

export interface StreamChatOptions {
  tools?: unknown[]
  /** 限制输出长度；大纲等结构化任务建议显式设置，避免默认过短被截断 */
  maxTokens?: number
}

async function* requestModel(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  model: string,
  options?: StreamChatOptions
): AsyncGenerator<string> {
  if (useElectronProxyTransport()) {
    yield* requestModelViaAxios(config, messages, signal, model, options)
    return
  }
  const tools = options?.tools
  const maxTokens = options?.maxTokens

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  // 首 token 允许更久（大 prompt / 慢模型）；收到内容后改为空闲超时
  const idleMs = Math.max(1, config.timeoutMs)
  const firstTokenMs = Math.max(idleMs * 2, idleMs)
  let timeout = setTimeout(() => controller.abort(), firstTokenMs)
  const resetIdle = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(), idleMs)
  }

  const requestUrl = endpoint(config.baseUrl)
  try {
    let response: Response
    try {
      response = await fetch(requestUrl, {
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
          ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
          ...(tools && tools.length > 0 ? { tools } : {})
        }),
        signal: controller.signal
      })
    } catch (error) {
      if (error instanceof AiServiceError) throw error
      if (signal.aborted) throw new AiServiceError('cancelled', '请求已取消')
      if (controller.signal.aborted) throw new AiServiceError('timeout', '模型请求超时')
      throw new AiServiceError(
        'network_error',
        `无法连接模型服务：${error instanceof Error ? error.message : String(error)}（请求：${requestUrl}）`
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
  options?: StreamChatOptions
): AsyncGenerator<string> {
  const tools = options?.tools
  const maxTokens = options?.maxTokens
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  const idleMs = Math.max(1, config.timeoutMs)
  const firstTokenMs = Math.max(idleMs * 2, idleMs)
  let timedOut = false
  let timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, firstTokenMs)
  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleMs)
  }

  const requestUrl = endpoint(config.baseUrl)
  try {
    const response = await axios.post(requestUrl, {
      model,
      messages,
      temperature: config.temperature,
      stream: true,
      ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
      ...(tools && tools.length > 0 ? { tools } : {})
    }, {
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      responseType: 'stream',
      // 流式总时长由空闲定时器控制，避免 axios 总超时在慢速持续输出时误杀
      timeout: 0,
      signal: controller.signal,
      // 显式清洗后的代理，避免 env 里带引号导致 Invalid URL
      ...axiosProxyOption()
    })

    if (response.status < 200 || response.status >= 300) {
      const details = await readAxiosBody(response.data)
      throw httpError(response.status, details)
    }

    let buffer = ''
    let streamEnded = false
    let receivedContent = false
    for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
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
          // 仅在真正收到正文时重置空闲超时（首 token 前仍用 firstTokenMs）
          resetTimeout()
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
    throw axiosError(error, signal, timedOut, requestUrl)
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

export async function* streamChat(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  toolsOrOptions?: unknown[] | StreamChatOptions
): AsyncGenerator<string> {
  // 兼容旧调用：第 4 参可以是 tools 数组，也可以是 options
  const options: StreamChatOptions | undefined = Array.isArray(toolsOrOptions)
    ? { tools: toolsOrOptions }
    : toolsOrOptions
  try {
    yield* requestModel(config, messages, signal, requestModelId(config, config.model), options)
  } catch (error) {
    if (
      config.fallbackModel &&
      config.fallbackModel !== config.model &&
      error instanceof AiServiceError &&
      error.code === 'model_error' &&
      !signal.aborted
    ) {
      yield* requestModel(config, messages, signal, requestModelId(config, config.fallbackModel), options)
      return
    }
    throw error
  }
}
