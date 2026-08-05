import type {
  AiChatPayload,
  AiHistoryMessage,
  AiHistoryRepository,
  AiLlmSettings,
  AiPromptMessage,
  AiQuestionCategory,
  AiSourceRef,
  AiSettings,
  AiToolCall,
  AiToolTrace,
  AiWebSourceRef
} from '../../../src/global'
import {
  AiServiceError,
  streamChat,
  type StreamChatOptions,
  type StreamPart,
  type StreamToolCall
} from './llm-caller'
import { resolveEngine } from './ai-config'
import { NmemBridgeError, type NmemMemory } from './nmem-bridge'
import { webSearch, type WebSearchResult } from './web-search-service'
import { semanticScholarSearch } from './semantic-scholar-service'
import { sciverseMetaSearch } from './sciverse-service'
import { detectProvider } from '../../../src/aiProvider'
import { resolveWebSearchHttpBackend } from '../../../src/webSearch'
import {
  executeBuiltinTool,
  isBuiltinTool,
  listBuiltinToolDefs,
  toolsSystemPrompt,
  type OpenAiToolDef
} from './tool-registry'
import type { McpHost } from './mcp-host'

interface AiEventSender {
  send: (channel: string, payload: Record<string, unknown>) => void
}

interface AiServiceDependencies {
  getSettings: () => AiSettings
  history: AiHistoryRepository
  stream?: (
    config: AiLlmSettings,
    messages: AiPromptMessage[],
    signal: AbortSignal,
    toolsOrOptions?: unknown[] | StreamChatOptions
  ) => AsyncGenerator<string | StreamPart>
  retrieve?: (
    query: string,
    limit: number,
    signal: AbortSignal,
    options: { bookId?: string; chapterIndex?: number; category?: AiQuestionCategory }
  ) => Promise<NmemMemory[]>
  onRetrievalError?: (error: unknown) => void
  /** 联网/学术搜索调用日志 */
  onWebSearch?: (info: {
    query: string
    provider: string
    resultCount: number
    durationMs: number
    at: string
  }) => void
  /** 可选 MCP 宿主；不传则仅用内置工具 */
  mcpHost?: McpHost
  onToolCall?: (info: {
    name: string
    ok: boolean
    durationMs: number
    at: string
  }) => void
}

function matchesPatterns(patterns: string[], text: string): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(text.trim())
    } catch {
      return false
    }
  })
}

function normalizedQuotes(payload: AiChatPayload): string[] {
  return [...new Set((payload.quotes || []).map((quote) => quote.trim()).filter(Boolean))].slice(0, 5)
}

export function classifyQuestion(
  settings: AiSettings,
  payload: AiChatPayload
): AiQuestionCategory {
  if (normalizedQuotes(payload).length > 0) return 'selection'
  const lastUserText = [...payload.messages]
    .reverse()
    .find((message) => message.role === 'user')?.content || ''
  if (matchesPatterns(settings.chat.greetingPatterns, lastUserText)) return 'greeting'
  if (matchesPatterns(settings.chat.bookWidePatterns, lastUserText)) return 'book_wide'
  if (matchesPatterns(settings.chat.chapterPatterns, lastUserText)) return 'chapter'
  if (payload.autoContext?.trim()) return 'current_sentence'
  return 'general'
}

import {
  buildSourceRefs,
  parseSourceMetadata,
  toWebSourceRefs,
  type SourceMetadata
} from './source-utils'

export {
  buildSourceRefs,
  parseSourceMetadata,
  toWebSourceRefs,
  type SourceMetadata
}

function sourcePrompt(
  sources: AiSourceRef[],
  maxContextChars: number,
  evidencePrompt: string
): AiPromptMessage[] {
  if (sources.length === 0) return []
  let remaining = Math.max(0, maxContextChars)
  const sections: string[] = []
  for (const source of sources) {
    if (remaining === 0) break
    const content = source.content.trim().slice(0, remaining)
    if (!content) continue
    remaining -= content.length
    sections.push(`来源 [${source.index}]（${source.chapterTitle}）：\n${content}`)
  }
  if (sections.length === 0) return []
  return [
    ...(evidencePrompt.trim()
      ? [{ role: 'system' as const, content: evidencePrompt }]
      : []),
    {
      role: 'user',
      content: `<book-evidence>\n${sections.join('\n\n')}\n</book-evidence>`
    }
  ]
}

/**
 * 智谱独立搜索配置（与对话模型解耦）：
 * 1）优先 webSearch.zhipuApiKey（外部信息源专用）
 * 2）否则回退引擎列表里第一个智谱引擎
 */
function findZhipuConfig(settings: AiSettings): { apiKey: string; baseUrl?: string } | null {
  const dedicated = settings.webSearch?.zhipuApiKey?.trim()
  if (dedicated) {
    return {
      apiKey: dedicated,
      baseUrl: settings.webSearch?.zhipuBaseUrl?.trim() || 'https://open.bigmodel.cn/api/paas/v4'
    }
  }
  const engine = settings.engines?.find(
    (e) => (e.provider || detectProvider(e.baseUrl)) === 'zhipu' && e.apiKey
  )
  if (engine) return { apiKey: engine.apiKey, baseUrl: engine.baseUrl }
  return null
}

function findOllamaConfig(
  settings: AiSettings
): { apiKey: string; baseUrl?: string } | null {
  const key = settings.webSearch?.ollamaApiKey?.trim()
  if (!key) return null
  return {
    apiKey: key,
    baseUrl: settings.webSearch?.ollamaBaseUrl?.trim() || 'https://ollama.com'
  }
}

function webResultsPrompt(results: WebSearchResult[]): AiPromptMessage[] {
  if (results.length === 0) return []
  const sections = results.map(
    (r, i) =>
      `[W${i + 1}] ${r.title}（${r.sourceType || '网页'}）\n${r.snippet}\n链接: ${r.url || '无'}`
  )
  return [
    {
      role: 'user',
      content: `<web-results>\n${sections.join('\n\n')}\n</web-results>`
    }
  ]
}

function readingContextPrompt(content: string, contextPrompt: string): AiPromptMessage[] {
  if (!content.trim()) return []
  return [
    ...(contextPrompt.trim()
      ? [{ role: 'system' as const, content: contextPrompt }]
      : []),
    {
      role: 'user',
      content: '<reader-context>\n' + content.trim() + '\n</reader-context>'
    }
  ]
}

function selectionPrompt(payload: AiChatPayload, policyPrompt: string): AiPromptMessage[] {
  const quotes = normalizedQuotes(payload)
  if (quotes.length === 0) return []
  return [
    ...(policyPrompt.trim()
      ? [{ role: 'system' as const, content: policyPrompt }]
      : []),
    {
      role: 'user',
      content: `<selected-quotes>\n${quotes
        .map((quote, index) => `引用 ${index + 1}：\n${quote}`)
        .join('\n\n')}\n</selected-quotes>`
    }
  ]
}

export function buildRetrievalQuery(payload: AiChatPayload): string {
  const lastUserText = [...payload.messages]
    .reverse()
    .find((message) => message.role === 'user')?.content || ''
  const parts: string[] = []
  // 书名有助于全书级问题命中正确源
  if (payload.bookTitle?.trim()) parts.push(payload.bookTitle.trim())
  if (lastUserText.trim()) parts.push(lastUserText.trim())
  const quotes = normalizedQuotes(payload)
  if (quotes.length > 0) parts.push(quotes.join(' '))
  if (payload.autoContext?.trim()) {
    // 从 autoContext 中提取当前句和章节标题
    const lines = payload.autoContext.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (
        trimmed.startsWith('当前句：') ||
        trimmed.startsWith('章节：') ||
        trimmed.startsWith('书籍：')
      ) {
        parts.push(trimmed.replace(/^(当前句：|章节：|书籍：)/, ''))
      }
    }
  }
  // 去重并限制总长，避免检索 query 过长
  const unique = [...new Set(parts.map((p) => p.trim()).filter(Boolean))]
  return unique.join(' ').slice(0, 800)
}

function fullTextPrompt(content: string, policyPrompt: string): AiPromptMessage[] {
  if (!content.trim()) return []
  return [
    ...(policyPrompt.trim()
      ? [{ role: 'system' as const, content: policyPrompt }]
      : []),
    {
      role: 'user',
      content: `<chapter-full-text>\n${content.trim()}\n</chapter-full-text>`
    }
  ]
}

/**
 * prompt 总字符预算守卫。各层各自有上限，但全文注入 + 证据 + web + 历史可同时存在，
 * 叠加可能超出模型上下文窗口被静默截断。超预算时按优先级丢弃最胖且最可替代的层：
 * 1) chapter-full-text → 2) web-results → 3) reader-context。
 * systemPrompt / 证据 / 选中引用 / 历史始终保留。
 */
const MAX_PROMPT_CHARS = 60000
const FULL_TEXT_TAG = '<chapter-full-text>'
const WEB_RESULTS_TAG = '<web-results>'
const READER_CONTEXT_TAG = '<reader-context>'

function totalChars(messages: AiPromptMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0)
}

function dropLayer(messages: AiPromptMessage[], tag: string): AiPromptMessage[] {
  return messages.filter((m) => !m.content.includes(tag))
}

export function buildPromptMessages(
  settings: AiSettings,
  payload: AiChatPayload,
  sources: AiSourceRef[] = [],
  webResults: WebSearchResult[] = []
): AiPromptMessage[] {
  const recentMessages = payload.messages
    .slice(-settings.chat.maxHistoryMessages)
    .map(({ role, content }) => ({ role, content }))
  const category = classifyQuestion(settings, payload)
  const includeContext = Boolean(payload.autoContext?.trim()) && category !== 'greeting'
  // 本章注入：与检索并存（当前章字数在上限内时每轮可注入，保证追问有正文）
  const includeFullText =
    Boolean(payload.injectFullText) &&
    Boolean(payload.fullText?.trim()) &&
    category !== 'greeting'
  const webSearchPrompt =
    settings.webSearch?.prompt?.trim() ||
    '你已启用联网搜索。回答时请区分书籍内容与网络搜索结果，网络信息需注明来源。优先以书籍内容为准，网络搜索仅作补充。'

  const messages: AiPromptMessage[] = [
    ...(settings.chat.systemPrompt
      ? [{ role: 'system' as const, content: settings.chat.systemPrompt }]
      : []),
    ...(settings.webSearch?.enabled || settings.webSearch?.academicEnabled
      ? [{ role: 'system' as const, content: webSearchPrompt }]
      : []),
    ...(includeContext
      ? readingContextPrompt(payload.autoContext || '', settings.chat.readerContextPrompt)
      : []),
    ...(includeFullText
      ? fullTextPrompt(payload.fullText || '', settings.chat.fullTextInjectPrompt || '')
      : []),
    // 始终附带检索证据（启用检索且有结果时），即使已注入全文
    ...sourcePrompt(sources, settings.retrieval.maxContextChars, settings.chat.evidencePrompt),
    ...webResultsPrompt(webResults),
    ...selectionPrompt(payload, settings.chat.selectionPrompt),
    ...recentMessages
  ]

  // 总预算守卫：超限时按优先级丢弃（全文 → web → 读者上下文）
  let guarded = messages
  for (const tag of [FULL_TEXT_TAG, WEB_RESULTS_TAG, READER_CONTEXT_TAG]) {
    if (totalChars(guarded) <= MAX_PROMPT_CHARS) break
    const next = dropLayer(guarded, tag)
    if (next.length === guarded.length) continue
    guarded = next
  }
  return guarded
}

export class AiService {
  private readonly controllers = new Map<string, AbortController>()
  private readonly stream: NonNullable<AiServiceDependencies['stream']>

  constructor(private readonly dependencies: AiServiceDependencies) {
    this.stream = dependencies.stream || streamChat
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async chat(requestId: string, payload: AiChatPayload, sender: AiEventSender): Promise<void> {
    this.cancel(requestId)
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    const settings = this.dependencies.getSettings()
    const recentMessages = payload.messages.slice(-settings.chat.maxHistoryMessages)
    const category = classifyQuestion(settings, payload)

    try {
      const chatEngine = resolveEngine(settings, 'chat')
      if (!chatEngine.baseUrl?.trim() || !chatEngine.model?.trim()) {
        sender.send('ai:chat:error', {
          requestId,
          code: 'model_error',
          message:
            'AI 引擎未配置完整：请打开「设置 → AI」，为对话引擎填写服务地址和模型名称（例如 DeepSeek：https://api.deepseek.com/v1 + deepseek-chat）'
        })
        return
      }

      const tools = category === 'greeting' ? [] : await this.collectTools(settings, controller.signal)
      const agentMode = settings.agent?.mode || 'auto'
      const useAgent =
        category !== 'greeting' &&
        tools.length > 0 &&
        (agentMode === 'tools' || agentMode === 'auto')

      if (useAgent) {
        await this.chatWithAgent({
          requestId,
          payload,
          sender,
          controller,
          settings,
          chatEngine,
          recentMessages,
          tools
        })
      } else {
        await this.chatWithPrefetch({
          requestId,
          payload,
          sender,
          controller,
          settings,
          chatEngine,
          recentMessages,
          category
        })
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof AiServiceError && error.code === 'cancelled')) {
        sender.send('ai:chat:done', { requestId, cancelled: true })
        return
      }
      sender.send('ai:chat:error', {
        requestId,
        code: error instanceof AiServiceError ? error.code : 'model_error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      if (this.controllers.get(requestId) === controller) this.controllers.delete(requestId)
    }
  }

  /** 收集内置 + MCP 工具定义 */
  private async collectTools(
    settings: AiSettings,
    signal: AbortSignal
  ): Promise<OpenAiToolDef[]> {
    const tools: OpenAiToolDef[] = [...listBuiltinToolDefs(settings)]
    if (settings.mcp?.enabled && this.dependencies.mcpHost) {
      try {
        const listed = await this.dependencies.mcpHost.refreshTools(signal)
        tools.push(...this.dependencies.mcpHost.toOpenAiTools(listed))
        const errors = this.dependencies.mcpHost.getLastRefreshErrors?.() || []
        if (errors.length > 0) {
          // 失败不阻断内置工具，但写入检索错误回调便于日志可见
          this.dependencies.onRetrievalError?.(
            new Error(`MCP 部分失败: ${errors.join('；')}`)
          )
        }
      } catch (error) {
        // MCP 失败不阻断内置工具
        this.dependencies.onRetrievalError?.(
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
    return tools
  }

  /** Agent：模型 tool_call → 执行 → 再答 */
  private async chatWithAgent(args: {
    requestId: string
    payload: AiChatPayload
    sender: AiEventSender
    controller: AbortController
    settings: AiSettings
    chatEngine: AiLlmSettings
    recentMessages: AiHistoryMessage[]
    tools: OpenAiToolDef[]
  }): Promise<void> {
    const {
      requestId,
      payload,
      sender,
      controller,
      settings,
      chatEngine,
      recentMessages,
      tools
    } = args

    let sources: AiSourceRef[] = []
    let webSources: AiWebSourceRef[] = []
    let webSearchUsed = false
    let toolTraces: AiToolTrace[] = []
    let retrievalStatus: AiHistoryMessage['retrievalStatus'] = 'skipped'
    let answer = ''
    let reasoning = ''
    let seq = 0

    const toolNames = tools.map((t) => t.function.name)
    const baseMessages = buildPromptMessages(settings, payload, [], [])
    const toolHint = toolsSystemPrompt(toolNames)
    const working: AiPromptMessage[] = toolHint
      ? [toolHint, ...baseMessages]
      : [...baseMessages]

    // 诚实：尚未调用任何工具前不要标「联网已用」
    sender.send('ai:chat:sources', {
      requestId,
      status: 'searching',
      sources: [],
      webSources: [],
      webSearchUsed: false,
      toolTraces: []
    })

    const maxRounds = Math.min(8, Math.max(1, settings.agent?.maxToolRounds ?? 4))

    for (let round = 0; round < maxRounds; round++) {
      if (controller.signal.aborted) break

      let roundText = ''
      let roundReasoning = ''
      let pendingToolCalls: StreamToolCall[] | null = null

      // 最后一轮不再给 tools，强制出最终回答
      const isLastRound = round >= maxRounds - 1
      const roundTools = isLastRound ? undefined : tools
      // 可能仍有 tool_calls 时先缓冲；最后一轮可边收边推
      const liveStream = isLastRound

      for await (const raw of this.stream(chatEngine, working, controller.signal, {
        tools: roundTools,
        toolChoice: roundTools && roundTools.length > 0 ? 'auto' : undefined
      })) {
        if (controller.signal.aborted) break
        const part: StreamPart =
          typeof raw === 'string' ? { text: raw } : raw && typeof raw === 'object' ? raw : {}
        if (part.toolCalls && part.toolCalls.length > 0) {
          pendingToolCalls = part.toolCalls
          continue
        }
        if (part.reasoning) {
          roundReasoning += part.reasoning
          if (liveStream) {
            reasoning += part.reasoning
            sender.send('ai:chat:chunk', { requestId, seq, reasoning: part.reasoning })
            seq += 1
          }
        }
        if (part.text) {
          roundText += part.text
          if (liveStream) {
            answer += part.text
            sender.send('ai:chat:chunk', { requestId, seq, text: part.text })
            seq += 1
          }
        }
      }

      if (controller.signal.aborted) break

      if (!pendingToolCalls || pendingToolCalls.length === 0) {
        if (!liveStream) {
          if (roundReasoning) {
            reasoning += roundReasoning
            sender.send('ai:chat:chunk', { requestId, seq, reasoning: roundReasoning })
            seq += 1
          }
          if (roundText) {
            answer = roundText
            sender.send('ai:chat:chunk', { requestId, seq, text: roundText })
            seq += 1
          }
        }
        break
      }

      // 有 tool_calls：回填 assistant + 执行（本轮 text 不展示给用户）
      if (!liveStream && roundReasoning) {
        reasoning += roundReasoning
        sender.send('ai:chat:chunk', { requestId, seq, reasoning: roundReasoning })
        seq += 1
      }
      const openaiToolCalls: AiToolCall[] = pendingToolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' }
      }))
      working.push({
        role: 'assistant',
        content: roundText || '',
        tool_calls: openaiToolCalls
      })

      for (const tc of pendingToolCalls) {
        if (controller.signal.aborted) break
        const started = Date.now()
        let resultContent = ''
        let toolOk = true
        try {
          if (isBuiltinTool(tc.name)) {
            const result = await executeBuiltinTool(tc.name, tc.arguments || '{}', {
              settings,
              signal: controller.signal,
              bookId: payload.bookId,
              bookTitle: payload.bookTitle,
              currentChapterIndex: payload.currentChapterIndex,
              retrieve: this.dependencies.retrieve
            })
            resultContent = result.content
            if (result.sources?.length) {
              sources = mergeSources(sources, result.sources)
              retrievalStatus = 'done'
            }
            if (result.webSources?.length) {
              webSources = mergeWebSources(webSources, result.webSources)
              webSearchUsed = true
            }
            if (result.webSearchUsed) webSearchUsed = true
            toolOk = !/"error"\s*:/.test(resultContent)
            this.dependencies.onToolCall?.({
              name: tc.name,
              ok: toolOk,
              durationMs: Date.now() - started,
              at: new Date().toISOString()
            })
          } else if (tc.name.startsWith('mcp_') && this.dependencies.mcpHost) {
            const result = await this.dependencies.mcpHost.callTool(
              tc.name,
              tc.arguments || '{}',
              controller.signal
            )
            resultContent = result.content
            toolOk = !/"error"\s*:/.test(resultContent)
            this.dependencies.onToolCall?.({
              name: tc.name,
              ok: toolOk,
              durationMs: Date.now() - started,
              at: new Date().toISOString()
            })
          } else {
            resultContent = JSON.stringify({ error: `未知工具: ${tc.name}` })
            toolOk = false
            this.dependencies.onToolCall?.({
              name: tc.name,
              ok: false,
              durationMs: Date.now() - started,
              at: new Date().toISOString()
            })
          }
        } catch (error) {
          resultContent = JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          })
          toolOk = false
          this.dependencies.onToolCall?.({
            name: tc.name,
            ok: false,
            durationMs: Date.now() - started,
            at: new Date().toISOString()
          })
        }

        toolTraces = [
          ...toolTraces,
          {
            name: tc.name,
            ok: toolOk,
            durationMs: Date.now() - started,
            summary: summarizeToolResult(resultContent)
          }
        ]

        working.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: resultContent
        })
      }

      // 推送来源更新
      sender.send('ai:chat:sources', {
        requestId,
        status: retrievalStatus === 'skipped' && sources.length === 0 ? 'searching' : 'done',
        sources,
        webSources,
        webSearchUsed,
        toolTraces
      })
    }

    if (sources.length > 0) retrievalStatus = 'done'
    else if (webSearchUsed || toolTraces.length > 0) retrievalStatus = 'skipped'

    sender.send('ai:chat:sources', {
      requestId,
      status: 'done',
      sources,
      webSources,
      webSearchUsed,
      toolTraces
    })

    const assistantMessage: AiHistoryMessage = {
      id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: answer,
      reasoning: reasoning || undefined,
      sources,
      webSources,
      webSearchUsed,
      toolTraces: toolTraces.length ? toolTraces : undefined,
      retrievalStatus
    }
    const completedMessages: AiHistoryMessage[] = [...recentMessages, assistantMessage]

    if (controller.signal.aborted) {
      await this.dependencies.history.save(
        payload.bookId,
        answer.trim() || reasoning.trim() ? completedMessages : recentMessages,
        payload.conversationId
      )
      sender.send('ai:chat:done', { requestId, cancelled: true })
      return
    }

    await this.dependencies.history.save(
      payload.bookId,
      completedMessages,
      payload.conversationId
    )
    sender.send('ai:chat:done', { requestId, cancelled: false })
  }

  /** 旧路径：宿主预检索后注入 prompt */
  private async chatWithPrefetch(args: {
    requestId: string
    payload: AiChatPayload
    sender: AiEventSender
    controller: AbortController
    settings: AiSettings
    chatEngine: AiLlmSettings
    recentMessages: AiHistoryMessage[]
    category: AiQuestionCategory
  }): Promise<void> {
    const {
      requestId,
      payload,
      sender,
      controller,
      settings,
      chatEngine,
      recentMessages,
      category
    } = args

    let sources: AiSourceRef[] = []
    let webResults: WebSearchResult[] = []
    let webSources: AiWebSourceRef[] = []
    let retrievalStatus: AiHistoryMessage['retrievalStatus'] = 'skipped'
    const webSearchUsed = Boolean(settings.webSearch?.enabled && category !== 'greeting')
    const academicEnabled = Boolean(
      settings.webSearch?.academicEnabled && category !== 'greeting'
    )
    const sciverseEnabled = Boolean(
      settings.webSearch?.sciverseEnabled &&
        settings.webSearch?.sciverseApiKey?.trim() &&
        category !== 'greeting'
    )
    const externalSearchUsed = webSearchUsed || academicEnabled || sciverseEnabled
    let answer = ''
    let reasoning = ''
    let seq = 0

    const runWebSearch = async (): Promise<WebSearchResult[]> => {
      if (!webSearchUsed && !academicEnabled && !sciverseEnabled) return []
      const query = buildRetrievalQuery(payload)
      const started = Date.now()
      const preferred = webSearchUsed ? resolveWebSearchHttpBackend(settings) : 'none'
      const maxResults = Math.min(10, Math.max(1, settings.webSearch?.maxResults ?? 5))
      try {
        const [web, academic, sciverse] = await Promise.all([
          webSearchUsed
            ? webSearch(query, {
                maxResults,
                signal: controller.signal,
                preferred,
                ollama: findOllamaConfig(settings),
                zhipu: findZhipuConfig(settings)
              }).catch(() => [] as WebSearchResult[])
            : Promise.resolve([] as WebSearchResult[]),
          academicEnabled
            ? semanticScholarSearch(query, {
                maxResults: Math.min(5, maxResults),
                signal: controller.signal,
                apiKey: settings.webSearch?.semanticScholarApiKey
              }).catch(() => [] as WebSearchResult[])
            : Promise.resolve([] as WebSearchResult[]),
          sciverseEnabled
            ? sciverseMetaSearch(query, {
                maxResults: Math.min(5, maxResults),
                signal: controller.signal,
                apiKey: settings.webSearch!.sciverseApiKey!,
                baseUrl: settings.webSearch?.sciverseBaseUrl
              }).catch(() => [] as WebSearchResult[])
            : Promise.resolve([] as WebSearchResult[])
        ])
        const results = [...sciverse, ...academic, ...web].slice(0, maxResults + 8)
        const durationMs = Date.now() - started
        const parts: string[] = []
        if (sciverse.length) parts.push('sciverse')
        if (academic.length) parts.push('semantic-scholar')
        if (web.length) parts.push(web[0]?.provider || preferred)
        const provider =
          parts.length > 0
            ? parts.join('+')
            : preferred === 'none'
              ? 'none'
              : preferred === 'auto'
                ? 'auto'
                : preferred
        this.dependencies.onWebSearch?.({
          query,
          provider,
          resultCount: results.length,
          durationMs,
          at: new Date().toISOString()
        })
        return results
      } catch {
        this.dependencies.onWebSearch?.({
          query,
          provider: 'error',
          resultCount: 0,
          durationMs: Date.now() - started,
          at: new Date().toISOString()
        })
        return []
      }
    }

    if (settings.retrieval.enabled && this.dependencies.retrieve && category !== 'greeting') {
      sender.send('ai:chat:sources', {
        requestId,
        status: 'searching',
        sources: [],
        webSources: [],
        webSearchUsed: externalSearchUsed
      })

      const webPromise = runWebSearch()

      try {
        const query = buildRetrievalQuery(payload)
        const memories = await this.dependencies.retrieve(
          query,
          settings.retrieval.topK,
          controller.signal,
          {
            bookId: payload.bookId,
            chapterIndex: payload.currentChapterIndex,
            category
          }
        )
        sources = buildSourceRefs(memories, {
          bookId: payload.bookId,
          currentChapterIndex: Math.max(0, payload.currentChapterIndex ?? 0),
          category
        })
        retrievalStatus = 'done'
        sender.send('ai:chat:sources', {
          requestId,
          status: 'done',
          sources,
          webSources: [],
          webSearchUsed: externalSearchUsed
        })
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof NmemBridgeError && error.code === 'cancelled')
        ) {
          sender.send('ai:chat:sources', {
            requestId,
            status: 'skipped',
            sources: [],
            webSources: [],
            webSearchUsed: externalSearchUsed
          })
          sender.send('ai:chat:done', { requestId, cancelled: true })
          return
        }
        this.dependencies.onRetrievalError?.(error)
        const offline =
          error instanceof NmemBridgeError &&
          (error.code === 'nmem_offline' || error.code === 'timeout')
        retrievalStatus = offline ? 'offline' : 'error'
        sender.send('ai:chat:sources', {
          requestId,
          status: offline ? 'offline' : 'error',
          sources: [],
          webSources: [],
          webSearchUsed: externalSearchUsed,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      webResults = await webPromise
      webSources = toWebSourceRefs(webResults)
      if (webSources.length > 0) {
        sender.send('ai:chat:sources', {
          requestId,
          status:
            retrievalStatus === 'error' || retrievalStatus === 'offline'
              ? retrievalStatus
              : 'done',
          sources,
          webSources,
          webSearchUsed: externalSearchUsed
        })
      }
    } else {
      sender.send('ai:chat:sources', {
        requestId,
        status: 'skipped',
        sources: [],
        webSources: [],
        webSearchUsed: externalSearchUsed
      })
      webResults = await runWebSearch()
      webSources = toWebSourceRefs(webResults)
      if (webSources.length > 0) {
        sender.send('ai:chat:sources', {
          requestId,
          status: 'skipped',
          sources: [],
          webSources,
          webSearchUsed: externalSearchUsed
        })
      }
    }

    const requestMessages = buildPromptMessages(settings, payload, sources, webResults)
    for await (const raw of this.stream(chatEngine, requestMessages, controller.signal)) {
      if (controller.signal.aborted) break
      const part: StreamPart =
        typeof raw === 'string' ? { text: raw } : raw && typeof raw === 'object' ? raw : {}
      if (part.reasoning) {
        reasoning += part.reasoning
        sender.send('ai:chat:chunk', { requestId, seq, reasoning: part.reasoning })
        seq += 1
      }
      if (part.text) {
        answer += part.text
        sender.send('ai:chat:chunk', { requestId, seq, text: part.text })
        seq += 1
      }
    }

    const assistantMessage: AiHistoryMessage = {
      id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: answer,
      reasoning: reasoning || undefined,
      sources,
      webSources,
      webSearchUsed: externalSearchUsed,
      retrievalStatus
    }
    const completedMessages: AiHistoryMessage[] = [...recentMessages, assistantMessage]

    if (controller.signal.aborted) {
      await this.dependencies.history.save(
        payload.bookId,
        answer.trim() || reasoning.trim() ? completedMessages : recentMessages,
        payload.conversationId
      )
      sender.send('ai:chat:done', { requestId, cancelled: true })
      return
    }

    await this.dependencies.history.save(
      payload.bookId,
      completedMessages,
      payload.conversationId
    )
    sender.send('ai:chat:done', { requestId, cancelled: false })
  }
}

/** 把工具 JSON 结果压成一行 UI 摘要 */
function summarizeToolResult(content: string): string {
  const raw = (content || '').trim()
  if (!raw) return '空结果'
  try {
    const parsed = JSON.parse(raw) as {
      error?: unknown
      count?: unknown
      hint?: unknown
      results?: unknown
    }
    if (typeof parsed.error === 'string' && parsed.error) {
      return `失败: ${parsed.error.slice(0, 120)}`
    }
    if (typeof parsed.count === 'number') {
      if (parsed.count > 0) return `命中 ${parsed.count} 条`
      if (typeof parsed.hint === 'string' && parsed.hint) return parsed.hint.slice(0, 120)
      return '0 条'
    }
    if (Array.isArray(parsed.results)) return `命中 ${parsed.results.length} 条`
  } catch {
    /* plain text */
  }
  return raw.replace(/\s+/g, ' ').slice(0, 120)
}

function mergeSources(existing: AiSourceRef[], incoming: AiSourceRef[]): AiSourceRef[] {
  const seen = new Set(existing.map((s) => s.content.slice(0, 80)))
  const merged = [...existing]
  for (const s of incoming) {
    const key = s.content.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...s, index: merged.length + 1 })
  }
  return merged
}

function mergeWebSources(
  existing: AiWebSourceRef[],
  incoming: AiWebSourceRef[]
): AiWebSourceRef[] {
  const seen = new Set(existing.map((s) => s.url || s.title))
  const merged = [...existing]
  for (const s of incoming) {
    const key = s.url || s.title
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...s, index: merged.length + 1 })
  }
  return merged
}
