import type {
  AiChatPayload,
  AiHistoryMessage,
  AiHistoryRepository,
  AiLlmSettings,
  AiPromptMessage,
  AiQuestionCategory,
  AiSourceRef,
  AiSettings
} from '../../../src/global'
import { AiServiceError, streamChat } from './llm-caller'
import { resolveEngine } from './ai-config'
import { buildWebSearchTools } from '../../../src/aiProvider'
import { NmemBridgeError, type NmemMemory } from './nmem-bridge'

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
    tools?: unknown[]
  ) => AsyncGenerator<string>
  retrieve?: (query: string, limit: number, signal: AbortSignal) => Promise<NmemMemory[]>
  onRetrievalError?: (error: unknown) => void
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

export interface SourceMetadata {
  bookId: string
  chapterIndex: number
  chapterTitle: string
}

export function parseSourceMetadata(source: string): SourceMetadata | null {
  const text = source.trim()
  // 旧版按章：`[bookId=id][ch=2] 第三章`
  const chapterMatch = /^\[bookId=([^\]]+)]\[ch=(\d+)]\s*(.*)$/.exec(text)
  if (chapterMatch) {
    return {
      bookId: chapterMatch[1],
      chapterIndex: Number(chapterMatch[2]),
      chapterTitle: chapterMatch[3].trim() || `第 ${Number(chapterMatch[2]) + 1} 章`
    }
  }
  // 新版整本：`[bookId=id] 书名`（chapterIndex = -1 表示全书源）
  const bookMatch = /^\[bookId=([^\]]+)]\s*(.*)$/.exec(text)
  if (bookMatch) {
    return {
      bookId: bookMatch[1],
      chapterIndex: -1,
      chapterTitle: bookMatch[2].trim() || '全书'
    }
  }
  return null
}

export function buildSourceRefs(
  memories: NmemMemory[],
  options: {
    bookId: string
    currentChapterIndex: number
    category?: AiQuestionCategory
  }
): AiSourceRef[] {
  const filtered = memories.filter((memory) => {
    const metadata = parseSourceMetadata(memory.source)
    if (!metadata || metadata.bookId !== options.bookId) return false
    if (options.category === 'chapter') {
      // 整本源（-1）可答章级问题；MDM 侧已按块检索相关片段
      return (
        metadata.chapterIndex === -1 ||
        metadata.chapterIndex === options.currentChapterIndex
      )
    }
    return true
  })
  return filtered.map((memory, sourceIndex) => {
    const metadata = parseSourceMetadata(memory.source)!
    return {
      index: sourceIndex + 1,
      memoryId: memory.id,
      content: memory.content,
      source: memory.source,
      score: memory.score,
      ...metadata
    }
  })
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
  if (lastUserText.trim()) parts.push(lastUserText.trim())
  const quotes = normalizedQuotes(payload)
  if (quotes.length > 0) parts.push(quotes.join(' '))
  if (payload.autoContext?.trim()) {
    // 从 autoContext 中提取当前句和章节标题
    const lines = payload.autoContext.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('当前句：') || trimmed.startsWith('章节：')) {
        parts.push(trimmed.replace(/^(当前句：|章节：)/, ''))
      }
    }
  }
  return [...new Set(parts)].join(' ')
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

export function buildPromptMessages(
  settings: AiSettings,
  payload: AiChatPayload,
  sources: AiSourceRef[] = []
): AiPromptMessage[] {
  const recentMessages = payload.messages
    .slice(-settings.chat.maxHistoryMessages)
    .map(({ role, content }) => ({ role, content }))
  const category = classifyQuestion(settings, payload)
  const includeContext = Boolean(payload.autoContext?.trim()) && category !== 'greeting'
  // 本章注入：与检索并存（当前章 ≤5 万字且本会话首次）
  const includeFullText =
    Boolean(payload.injectFullText) &&
    Boolean(payload.fullText?.trim()) &&
    category !== 'greeting'
  const webSearchPrompt =
    settings.webSearch?.prompt?.trim() ||
    '你已启用联网搜索。回答时请区分书籍内容与网络搜索结果，网络信息需注明来源。优先以书籍内容为准，网络搜索仅作补充。'

  return [
    ...(settings.chat.systemPrompt
      ? [{ role: 'system' as const, content: settings.chat.systemPrompt }]
      : []),
    ...(settings.webSearch?.enabled
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
    ...selectionPrompt(payload, settings.chat.selectionPrompt),
    ...recentMessages
  ]
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
    let sources: AiSourceRef[] = []
    let retrievalStatus: AiHistoryMessage['retrievalStatus'] = 'skipped'
    let answer = ''
    let seq = 0

    try {
      if (
        settings.retrieval.enabled &&
        this.dependencies.retrieve &&
        category !== 'greeting'
      ) {
        sender.send('ai:chat:sources', { requestId, status: 'searching', sources: [] })
        try {
          const query = buildRetrievalQuery(payload)
          const memories = await this.dependencies.retrieve(
            query,
            settings.retrieval.topK,
            controller.signal
          )
          sources = buildSourceRefs(memories, {
            bookId: payload.bookId,
            currentChapterIndex: Math.max(0, payload.currentChapterIndex ?? 0),
            category
          })
          retrievalStatus = 'done'
          sender.send('ai:chat:sources', { requestId, status: 'done', sources })
        } catch (error) {
          if (controller.signal.aborted || (error instanceof NmemBridgeError && error.code === 'cancelled')) {
            sender.send('ai:chat:sources', { requestId, status: 'skipped', sources: [] })
            sender.send('ai:chat:done', { requestId, cancelled: true })
            return
          }
          this.dependencies.onRetrievalError?.(error)
          const offline = error instanceof NmemBridgeError &&
            (error.code === 'nmem_offline' || error.code === 'timeout')
          retrievalStatus = offline ? 'offline' : 'error'
          sender.send('ai:chat:sources', {
            requestId,
            status: offline ? 'offline' : 'error',
            sources: [],
            error: error instanceof Error ? error.message : String(error)
          })
        }
      } else {
        sender.send('ai:chat:sources', { requestId, status: 'skipped', sources: [] })
      }

      const requestMessages = buildPromptMessages(settings, payload, sources)
      const chatEngine = resolveEngine(settings, 'chat')
      const tools = settings.webSearch?.enabled ? buildWebSearchTools(chatEngine) : undefined
      for await (const text of this.stream(chatEngine, requestMessages, controller.signal, tools)) {
        if (controller.signal.aborted) break
        answer += text
        sender.send('ai:chat:chunk', { requestId, seq, text })
        seq += 1
      }

      if (controller.signal.aborted) {
        sender.send('ai:chat:done', { requestId, cancelled: true })
        return
      }

      const completedMessages: AiHistoryMessage[] = [
        ...recentMessages,
        {
          role: 'assistant',
          content: answer,
          sources,
          retrievalStatus
        }
      ]
      await this.dependencies.history.save(payload.bookId, completedMessages)
      sender.send('ai:chat:done', { requestId, cancelled: false })
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
}
