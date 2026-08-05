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

/** OpenAI 兼容 function tool call（完整聚合后） */
export interface StreamToolCall {
  id: string
  name: string
  arguments: string
}

/** 流式片段：正文 / 思考链 / 工具调用 */
export interface StreamPart {
  /** 最终回答增量 */
  text?: string
  /** 模型原生 reasoning / thinking 增量 */
  reasoning?: string
  /** 流结束时若模型请求工具，一次吐出完整 tool_calls */
  toolCalls?: StreamToolCall[]
  finishReason?: string
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * 解析 SSE data 行。
 * 兼容：
 * - OpenAI content
 * - DeepSeek R1 / reasoner：delta.reasoning_content
 * - 部分兼容服务：delta.reasoning / delta.thinking
 */
export function streamPartFromData(data: string): StreamPart | null {
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
      delta?: {
        content?: unknown
        reasoning_content?: unknown
        reasoning?: unknown
        thinking?: unknown
      }
      message?: {
        content?: unknown
        reasoning_content?: unknown
        reasoning?: unknown
      }
      text?: unknown
    }>
  }).choices?.[0]

  const delta = choice?.delta
  const message = choice?.message

  const text =
    pickString(delta?.content, message?.content) ??
    (typeof choice?.text === 'string' && choice.text.length > 0 ? choice.text : undefined)

  const reasoning = pickString(
    delta?.reasoning_content,
    delta?.reasoning,
    delta?.thinking,
    message?.reasoning_content,
    message?.reasoning
  )

  if (!text && !reasoning) return null
  return {
    ...(text ? { text } : {}),
    ...(reasoning ? { reasoning } : {})
  }
}

/** @deprecated 兼容旧测试/调用，仅取 content 正文 */
function contentFromData(data: string): string | null {
  const part = streamPartFromData(data)
  return part?.text ?? null
}

export interface StreamChatOptions {
  tools?: unknown[]
  /** 限制输出长度；大纲等结构化任务建议显式设置，避免默认过短被截断 */
  maxTokens?: number
  /** tool_choice：auto | none | required | 指定函数 */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

interface AccumToolCall {
  id: string
  name: string
  arguments: string
}

/** 从 SSE JSON 片段提取 finish_reason 与 tool_calls delta */
export function extractStreamMeta(data: string): {
  finishReason?: string
  toolCallDeltas?: Array<{
    index: number
    id?: string
    name?: string
    arguments?: string
  }>
} {
  if (!data || data === '[DONE]' || data.startsWith(':')) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return {}
  }
  const choice = (parsed as {
    choices?: Array<{
      finish_reason?: unknown
      delta?: {
        tool_calls?: Array<{
          index?: number
          id?: string
          type?: string
          function?: { name?: string; arguments?: string }
        }>
      }
      message?: {
        tool_calls?: Array<{
          id?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }>
  }).choices?.[0]
  if (!choice) return {}

  const finishReason =
    typeof choice.finish_reason === 'string' && choice.finish_reason
      ? choice.finish_reason
      : undefined

  const toolCallDeltas: Array<{
    index: number
    id?: string
    name?: string
    arguments?: string
  }> = []

  const deltas = choice.delta?.tool_calls
  if (Array.isArray(deltas)) {
    for (const tc of deltas) {
      toolCallDeltas.push({
        index: typeof tc.index === 'number' ? tc.index : toolCallDeltas.length,
        id: typeof tc.id === 'string' ? tc.id : undefined,
        name: typeof tc.function?.name === 'string' ? tc.function.name : undefined,
        arguments:
          typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined
      })
    }
  } else if (Array.isArray(choice.message?.tool_calls)) {
    choice.message.tool_calls.forEach((tc, index) => {
      toolCallDeltas.push({
        index,
        id: typeof tc.id === 'string' ? tc.id : `call_${index}`,
        name: typeof tc.function?.name === 'string' ? tc.function.name : undefined,
        arguments:
          typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined
      })
    })
  }

  return {
    finishReason,
    toolCallDeltas: toolCallDeltas.length ? toolCallDeltas : undefined
  }
}

function mergeToolCallDelta(
  acc: Map<number, AccumToolCall>,
  deltas: Array<{ index: number; id?: string; name?: string; arguments?: string }>
): void {
  for (const d of deltas) {
    const prev = acc.get(d.index) || { id: '', name: '', arguments: '' }
    if (d.id) prev.id = d.id
    if (d.name) prev.name += d.name
    if (d.arguments) prev.arguments += d.arguments
    acc.set(d.index, prev)
  }
}

function finalizeToolCalls(acc: Map<number, AccumToolCall>): StreamToolCall[] {
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      id: v.id || `call_${i}`,
      name: v.name,
      arguments: v.arguments || '{}'
    }))
    .filter((t) => t.name)
}

async function* requestModel(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  model: string,
  options?: StreamChatOptions
): AsyncGenerator<StreamPart> {
  if (useElectronProxyTransport()) {
    yield* requestModelViaAxios(config, messages, signal, model, options)
    return
  }
  const tools = options?.tools
  const maxTokens = options?.maxTokens
  const toolChoice = options?.toolChoice

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
  const toolAcc = new Map<number, AccumToolCall>()
  let finishReason: string | undefined
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
          messages: serializeMessages(messages),
          temperature: config.temperature,
          stream: true,
          ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(tools && tools.length > 0 && toolChoice ? { tool_choice: toolChoice } : {})
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
    let receivedReasoning = false

    const handleDataLine = function* (data: string): Generator<StreamPart> {
      const meta = extractStreamMeta(data)
      if (meta.finishReason) finishReason = meta.finishReason
      if (meta.toolCallDeltas) {
        mergeToolCallDelta(toolAcc, meta.toolCallDeltas)
        resetIdle()
      }
      const part = streamPartFromData(data)
      if (part) {
        resetIdle()
        if (part.text?.trim()) receivedContent = true
        if (part.reasoning?.trim()) receivedReasoning = true
        yield part
      }
    }

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
        yield* handleDataLine(data)
      }
    }

    if (!streamEnded && buffer.startsWith('data:')) {
      yield* handleDataLine(buffer.slice(5).trim())
    }

    const toolCalls = finalizeToolCalls(toolAcc)
    if (toolCalls.length > 0) {
      yield {
        toolCalls,
        finishReason: finishReason || 'tool_calls'
      }
      return
    }

    // 纯思考模型若只有 reasoning 无 content，也算有效；有 tool_calls 已在上面返回
    if (!receivedContent && !receivedReasoning) {
      throw new AiServiceError('invalid_response', '模型响应未包含有效正文')
    }
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

/** 序列化消息：支持 tool / tool_calls 字段 */
function serializeMessages(messages: AiPromptMessage[]): unknown[] {
  return messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? ''
    }
    if (m.tool_call_id) base.tool_call_id = m.tool_call_id
    if (m.name) base.name = m.name
    if (m.tool_calls && m.tool_calls.length > 0) {
      base.tool_calls = m.tool_calls
      // 部分供应商要求 content 为 null 当存在 tool_calls
      if (!m.content) base.content = null
    }
    return base
  })
}

async function* requestModelViaAxios(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  model: string,
  options?: StreamChatOptions
): AsyncGenerator<StreamPart> {
  const tools = options?.tools
  const maxTokens = options?.maxTokens
  const toolChoice = options?.toolChoice
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
  const toolAcc = new Map<number, AccumToolCall>()
  let finishReason: string | undefined
  try {
    const response = await axios.post(
      requestUrl,
      {
        model,
        messages: serializeMessages(messages),
        temperature: config.temperature,
        stream: true,
        ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(tools && tools.length > 0 && toolChoice ? { tool_choice: toolChoice } : {})
      },
      {
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
      }
    )

    if (response.status < 200 || response.status >= 300) {
      const details = await readAxiosBody(response.data)
      throw httpError(response.status, details)
    }

    let buffer = ''
    let streamEnded = false
    let receivedContent = false
    let receivedReasoning = false
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
        const meta = extractStreamMeta(data)
        if (meta.finishReason) finishReason = meta.finishReason
        if (meta.toolCallDeltas) {
          mergeToolCallDelta(toolAcc, meta.toolCallDeltas)
          resetTimeout()
        }
        const part = streamPartFromData(data)
        if (part) {
          // 仅在真正收到正文/思考时重置空闲超时（首 token 前仍用 firstTokenMs）
          resetTimeout()
          if (part.text?.trim()) receivedContent = true
          if (part.reasoning?.trim()) receivedReasoning = true
          yield part
        }
      }
      if (streamEnded) break
    }

    if (!streamEnded && buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim()
      const meta = extractStreamMeta(data)
      if (meta.finishReason) finishReason = meta.finishReason
      if (meta.toolCallDeltas) mergeToolCallDelta(toolAcc, meta.toolCallDeltas)
      const part = streamPartFromData(data)
      if (part) {
        if (part.text?.trim()) receivedContent = true
        if (part.reasoning?.trim()) receivedReasoning = true
        yield part
      }
    }

    const toolCalls = finalizeToolCalls(toolAcc)
    if (toolCalls.length > 0) {
      yield {
        toolCalls,
        finishReason: finishReason || 'tool_calls'
      }
      return
    }

    if (!receivedContent && !receivedReasoning) {
      throw new AiServiceError('invalid_response', '模型响应未包含有效正文')
    }
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
): AsyncGenerator<StreamPart> {
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

/** 仅拼接正文（大纲等不需要思考链） */
export async function collectStreamText(
  config: AiLlmSettings,
  messages: AiPromptMessage[],
  signal: AbortSignal,
  toolsOrOptions?: unknown[] | StreamChatOptions
): Promise<string> {
  let result = ''
  for await (const part of streamChat(config, messages, signal, toolsOrOptions)) {
    if (part.text) result += part.text
  }
  return result
}
