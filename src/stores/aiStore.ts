import { create } from 'zustand'
import type {
  AiBookIngestStatus,
  AiChatChunkEvent,
  AiChatDoneEvent,
  AiChatErrorEvent,
  AiChatMessage,
  AiChatSourcesEvent,
  AiHistoryMessage,
  AiSourceRef,
} from '../global'
import { buildChapterFullText, shouldInjectFullText } from '../aiSettings'
import { findChapterIndex } from '../utils/bookData'
import { useBookStore } from './bookStore'
import { usePlayerStore } from './playerStore'
import { useSettingsStore } from './settingsStore'

interface ConvSummary {
  id: string
  title: string
  createdAt: string
  messageCount: number
}

interface AiState {
  bookId: string | null
  bookTitle: string
  messages: AiChatMessage[]
  isStreaming: boolean
  currentRequestId: string | null
  currentSources: AiSourceRef[]
  nmemStatus: 'checking' | 'online' | 'offline'
  nmemError: string | null
  /** 本书知识库同步状态 */
  bookIngestStatus: AiBookIngestStatus['status'] | 'checking'
  bookIngestError: string | null
  quotes: string[]
  quoteRevision: number
  pendingChatFocusRequestId: number | null
  conversations: ConvSummary[]
  activeConvId: string | null
  addQuote: (text: string) => void
  removeQuote: (index: number) => void
  clearQuotes: () => void
  requestChatFocus: () => void
  consumeChatFocusRequest: (requestId: number) => void
  initialize: (bookId: string, bookTitle: string) => Promise<void>
  refreshNmemStatus: (force?: boolean) => Promise<void>
  refreshBookIngestStatus: () => Promise<void>
  syncCurrentBookToNmem: () => Promise<boolean>
  sendMessage: (text: string) => Promise<boolean>
  cancelStream: () => Promise<void>
  clearHistory: () => Promise<void>
  loadConversations: () => Promise<void>
  newConversation: () => Promise<void>
  switchConversation: (convId: string) => Promise<void>
  deleteConversation: (convId: string) => Promise<void>
  renameConversation: (convId: string, title: string) => Promise<boolean>
  /** 复制消息正文到剪贴板 */
  copyMessage: (messageId: string) => Promise<boolean>
  /** 删除单条消息（用户消息会连带删除其后紧跟的助手回复） */
  deleteMessage: (messageId: string) => Promise<void>
  /** 编辑用户消息并截断后续，重新生成 */
  editAndResend: (messageId: string, newText: string) => Promise<boolean>
  /** 重新生成某条助手回复 */
  regenerate: (assistantMessageId: string) => Promise<boolean>
  /** 错误消息重试 */
  retryError: (assistantMessageId: string) => Promise<boolean>
  dispose: () => void
}

let listenerCleanups: Array<() => void> = []
/** 期望的下一个 seq；乱序 chunk 先缓冲 */
let nextSequence = 0
const seqBuffer = new Map<number, string>()
let initializationGeneration = 0
let nextChatFocusRequestId = 0

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${id}`
}

function textOf(message: AiChatMessage): string {
  return message.parts.map((part) => part.text).join('')
}

function toHistoryMessages(messages: AiChatMessage[]): AiHistoryMessage[] {
  return messages
    .filter((message) => message.status !== 'error' && textOf(message))
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: textOf(message),
      sources: message.sources,
      retrievalStatus:
        message.retrievalStatus === 'searching' ? 'skipped' : message.retrievalStatus,
      retrievalError: message.retrievalError
    }))
}

function toChatMessage(message: AiHistoryMessage): AiChatMessage | null {
  if (message.role === 'system') return null
  return {
    id: message.id || newId(message.role),
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
    createdAt: new Date().toISOString(),
    status: 'complete',
    sources: message.sources,
    retrievalStatus: message.retrievalStatus,
    retrievalError: message.retrievalError
  }
}

function historyLoadFailure(error: unknown): AiChatMessage {
  const detail = error instanceof Error ? error.message : String(error)
  return {
    id: newId('assistant'),
    role: 'assistant',
    parts: [{ type: 'text', text: '' }],
    createdAt: new Date().toISOString(),
    status: 'error',
    error: `对话历史加载失败，请重新打开本书重试：${detail}`
  }
}

function disposeListeners(): void {
  for (const cleanup of listenerCleanups) cleanup()
  listenerCleanups = []
}

function updateAssistant(
  messages: AiChatMessage[],
  requestId: string,
  update: (message: AiChatMessage) => AiChatMessage
): AiChatMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.requestId === requestId ? update(message) : message
  )
}

function appendChunkText(messages: AiChatMessage[], requestId: string, text: string): AiChatMessage[] {
  const msgs = messages
  const last = msgs[msgs.length - 1]
  if (!last || last.requestId !== requestId) {
    return updateAssistant(msgs, requestId, (m) => ({
      ...m,
      parts: [{ type: 'text', text: `${textOf(m)}${text}` }]
    }))
  }
  const updated = [...msgs]
  updated[msgs.length - 1] = {
    ...last,
    parts: [{ type: 'text', text: `${textOf(last)}${text}` }]
  }
  return updated
}

function snapshotReadingContext(): {
  autoContext?: string
  currentChapterIndex: number
} {
  const player = usePlayerStore.getState()
  const { currentBook: book, sentences, chapters } = useBookStore.getState()
  const currentChapterIndex = chapters.length
    ? findChapterIndex(chapters, player.currentSentenceIndex)
    : 0
  if (!book) return { currentChapterIndex }

  const chapter = chapters[currentChapterIndex]
  const sentence = sentences[player.currentSentenceIndex]?.trim()
  const context = [
    `书籍：${book.title}`,
    chapter?.title ? `章节：${chapter.title}` : '',
    sentence ? `当前句：${sentence}` : ''
  ].filter(Boolean)
  return {
    autoContext: context.join('\n'),
    currentChapterIndex
  }
}

function resetSeqState(): void {
  nextSequence = 0
  seqBuffer.clear()
}

async function persistMessages(bookId: string, convId: string | null, messages: AiChatMessage[]): Promise<void> {
  if (!bookId || !convId || !window.api) return
  await window.api.aiConvSave(bookId, convId, toHistoryMessages(messages))
}

export const useAiStore = create<AiState>((set, get) => {
  const bindListeners = () => {
    disposeListeners()
    if (!window.api) return

    listenerCleanups = [
      window.api.onAiChatSources((event: AiChatSourcesEvent) => {
        if (event.requestId !== get().currentRequestId) return
        set((state) => ({
          messages: updateAssistant(state.messages, event.requestId, (message) => ({
            ...message,
            sources: event.sources,
            retrievalStatus: event.status,
            retrievalError: event.error
          })),
          currentSources: event.sources,
          nmemStatus:
            event.status === 'offline'
              ? 'offline'
              : event.status === 'done'
                ? 'online'
                : state.nmemStatus,
          nmemError:
            event.status === 'offline'
              ? event.error || '知识库未连接'
              : event.status === 'done'
                ? null
                : state.nmemError
        }))
      }),
      window.api.onAiChatChunk((event: AiChatChunkEvent) => {
        if (event.requestId !== get().currentRequestId) return
        // 乱序缓冲：按 seq 重组，避免 IPC 乱序导致后续全部静默丢弃
        if (event.seq < nextSequence) return
        seqBuffer.set(event.seq, event.text)
        set((state) => {
          let messages = state.messages
          while (seqBuffer.has(nextSequence)) {
            const text = seqBuffer.get(nextSequence)!
            seqBuffer.delete(nextSequence)
            nextSequence += 1
            messages = appendChunkText(messages, event.requestId, text)
          }
          return { messages }
        })
      }),
      window.api.onAiChatDone((event: AiChatDoneEvent) => {
        if (event.requestId !== get().currentRequestId) return
        // 冲刷缓冲区内剩余乱序 chunk（按 seq 升序）
        if (seqBuffer.size > 0) {
          const ordered = [...seqBuffer.entries()].sort((a, b) => a[0] - b[0])
          seqBuffer.clear()
          set((state) => {
            let messages = state.messages
            for (const [, text] of ordered) {
              messages = appendChunkText(messages, event.requestId, text)
            }
            return { messages }
          })
        }
        resetSeqState()
        set((state) => ({
          messages: updateAssistant(state.messages, event.requestId, (message) => ({
            ...message,
            parts: [
              {
                type: 'text',
                text: textOf(message) || (event.cancelled ? '已停止生成' : '')
              }
            ],
            status: 'complete',
            retrievalStatus:
              message.retrievalStatus === 'searching' ? 'skipped' : message.retrievalStatus
          })),
          isStreaming: false,
          currentRequestId: null
        }))
        // 后端已落盘；前端再同步会话列表标题/条数
        void get().loadConversations()
      }),
      window.api.onAiChatError((event: AiChatErrorEvent) => {
        if (event.requestId !== get().currentRequestId) return
        resetSeqState()
        set((state) => ({
          messages: updateAssistant(state.messages, event.requestId, (message) => ({
            ...message,
            status: 'error',
            error: event.message
          })),
          isStreaming: false,
          currentRequestId: null
        }))
      })
    ]
  }

  /** 内部：用已有消息列表发起生成（不追加 user 消息） */
  const startGeneration = async (
    promptMessages: AiHistoryMessage[],
    assistantPlaceholder: AiChatMessage
  ): Promise<boolean> => {
    const state = get()
    if (!state.bookId || !state.activeConvId || state.isStreaming) return false

    const quotes = [...state.quotes]
    const quoteRevision = state.quoteRevision
    const readingContext = snapshotReadingContext()
    const bookStore = useBookStore.getState()
    const aiSettings = useSettingsStore.getState().settings.ai
    const maxChars = aiSettings?.chat?.fullTextMaxChars ?? 50000
    const chapters = bookStore.chapters
    const chapterMeta =
      chapters.length > 0
        ? chapters[
            Math.max(0, Math.min(readingContext.currentChapterIndex, chapters.length - 1))
          ]
        : {
            startIndex: 0,
            sentenceCount: bookStore.sentences.length
          }
    const fullText = buildChapterFullText(bookStore.sentences, chapterMeta)
    // 每轮在字数允许时注入本章，保证追问有正文上下文
    const injectFullText = shouldInjectFullText(fullText, maxChars, false)
    const requestId = assistantPlaceholder.requestId || newId('request')
    const assistantMessage: AiChatMessage = {
      ...assistantPlaceholder,
      requestId,
      status: 'streaming',
      parts: [{ type: 'text', text: '' }],
      sources: [],
      retrievalStatus: 'searching',
      error: undefined
    }

    resetSeqState()
    set({
      messages: [...get().messages, assistantMessage],
      isStreaming: true,
      currentRequestId: requestId
    })

    try {
      const result = await window.api.aiChat(requestId, {
        bookId: state.bookId,
        bookTitle: state.bookTitle,
        conversationId: state.activeConvId,
        messages: promptMessages,
        quotes,
        injectFullText,
        fullText: injectFullText ? fullText : undefined,
        ...readingContext
      })
      if (result.success) {
        set((current) =>
          current.quoteRevision === quoteRevision
            ? { quotes: [], quoteRevision: current.quoteRevision + 1 }
            : current
        )
        return true
      }
      throw new Error(result.error || 'AI 请求未启动')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((current) => ({
        messages: updateAssistant(current.messages, requestId, (item) => ({
          ...item,
          status: 'error',
          error: message
        })),
        isStreaming: false,
        currentRequestId: null
      }))
      return false
    }
  }

  return {
    bookId: null,
    bookTitle: '',
    messages: [],
    isStreaming: false,
    currentRequestId: null,
    currentSources: [],
    nmemStatus: 'checking',
    nmemError: null,
    bookIngestStatus: 'checking',
    bookIngestError: null,
    quotes: [],
    quoteRevision: 0,
    pendingChatFocusRequestId: null,
    conversations: [],
    activeConvId: null,

    addQuote: (rawText) => {
      const text = rawText.trim()
      if (!text) return
      set((state) => {
        if (state.quotes.length >= 5 || state.quotes.includes(text)) return state
        return {
          quotes: [...state.quotes, text],
          quoteRevision: state.quoteRevision + 1
        }
      })
    },

    removeQuote: (index) => {
      set((state) => {
        if (index < 0 || index >= state.quotes.length) return state
        return {
          quotes: state.quotes.filter((_quote, quoteIndex) => quoteIndex !== index),
          quoteRevision: state.quoteRevision + 1
        }
      })
    },

    clearQuotes: () =>
      set((state) =>
        state.quotes.length === 0
          ? state
          : { quotes: [], quoteRevision: state.quoteRevision + 1 }
      ),

    requestChatFocus: () => {
      nextChatFocusRequestId += 1
      set({ pendingChatFocusRequestId: nextChatFocusRequestId })
    },

    consumeChatFocusRequest: (requestId) => {
      set((state) =>
        state.pendingChatFocusRequestId === requestId
          ? { pendingChatFocusRequestId: null }
          : state
      )
    },

    refreshNmemStatus: async (force = false) => {
      set({ nmemStatus: 'checking' })
      try {
        const result = await window.api.aiNmemStatus(force)
        set({
          nmemStatus: result.status,
          nmemError: result.status === 'offline' ? result.error || '知识库未连接' : null
        })
      } catch (error) {
        set({
          nmemStatus: 'offline',
          nmemError: error instanceof Error ? error.message : String(error)
        })
      }
    },

    refreshBookIngestStatus: async () => {
      const bookId = get().bookId
      if (!bookId || !window.api?.aiNmemBookStatus) {
        set({ bookIngestStatus: 'none', bookIngestError: null })
        return
      }
      set({ bookIngestStatus: 'checking' })
      try {
        const result = await window.api.aiNmemBookStatus(bookId)
        set({
          bookIngestStatus: result.status,
          bookIngestError: result.error || null
        })
      } catch (error) {
        set({
          bookIngestStatus: 'none',
          bookIngestError: error instanceof Error ? error.message : String(error)
        })
      }
    },

    syncCurrentBookToNmem: async () => {
      const book = useBookStore.getState().currentBook
      if (!book || !window.api?.aiNmemIngest) return false
      set({ bookIngestStatus: 'submitting', bookIngestError: null })
      try {
        const full =
          book.sentences.length > 0
            ? book
            : (await useBookStore.getState().loadFullBook(book.id)) || book
        const result = await window.api.aiNmemIngest(full)
        if (result.success) {
          await get().refreshBookIngestStatus()
          return true
        }
        set({
          bookIngestStatus: 'failed',
          bookIngestError: result.error || '同步失败'
        })
        return false
      } catch (error) {
        set({
          bookIngestStatus: 'failed',
          bookIngestError: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    },

    initialize: async (bookId, bookTitle) => {
      const generation = ++initializationGeneration
      bindListeners()
      if (get().isStreaming) {
        await get().cancelStream()
      }

      try {
        const [convResult, nmem, ingest] = await Promise.all([
          (async () => {
            try {
              const listed = await window.api?.aiConvList(bookId)
              if (!listed) {
                return { activeId: null as string | null, conversations: [] as ConvSummary[], messages: [] as AiChatMessage[], error: null as unknown }
              }
              let activeId = listed.activeId
              let conversations = listed.conversations
              if (conversations.length === 0) {
                const created = await window.api?.aiConvCreate(bookId)
                if (created) {
                  activeId = created.id
                  conversations = [
                    {
                      id: created.id,
                      title: created.title,
                      createdAt: created.createdAt,
                      messageCount: 0
                    }
                  ]
                }
              }
              if (!activeId && conversations[0]) activeId = conversations[0].id
              let messages: AiChatMessage[] = []
              if (activeId) {
                const history = await window.api?.aiConvLoad(bookId, activeId)
                messages = (history || [])
                  .map(toChatMessage)
                  .filter((m): m is AiChatMessage => !!m)
                void window.api?.aiConvSetActive(bookId, activeId)
              }
              return { activeId, conversations, messages, error: null as unknown }
            } catch (error) {
              return {
                activeId: null as string | null,
                conversations: [] as ConvSummary[],
                messages: [] as AiChatMessage[],
                error
              }
            }
          })(),
          window.api
            .aiNmemStatus()
            .catch((error) => ({
              status: 'offline' as const,
              checkedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error)
            })),
          window.api
            ?.aiNmemBookStatus?.(bookId)
            .catch(() => ({ status: 'none' as const }))
            ?? Promise.resolve({ status: 'none' as const })
        ])

        if (generation !== initializationGeneration) return

        const sameBook = get().bookId === bookId
        set({
          bookId,
          bookTitle,
          messages: convResult.error
            ? [historyLoadFailure(convResult.error)]
            : convResult.messages,
          isStreaming: false,
          currentRequestId: null,
          currentSources: [],
          quotes: sameBook ? get().quotes : [],
          quoteRevision: sameBook ? get().quoteRevision : get().quoteRevision + 1,
          nmemStatus: nmem.status,
          nmemError: nmem.status === 'offline' ? nmem.error || '知识库未连接' : null,
          bookIngestStatus: ingest.status,
          bookIngestError: 'error' in ingest ? ingest.error || null : null,
          conversations: convResult.conversations,
          activeConvId: convResult.activeId
        })
      } catch (error) {
        if (generation !== initializationGeneration) return
        set({
          bookId,
          bookTitle,
          messages: [historyLoadFailure(error)],
          isStreaming: false,
          currentRequestId: null,
          conversations: [],
          activeConvId: null,
          bookIngestStatus: 'none',
          bookIngestError: null
        })
      }
    },

    sendMessage: async (rawText) => {
      const text = rawText.trim()
      const state = get()
      if (!text || !state.bookId || state.isStreaming) return false

      // 确保有活跃会话
      let activeConvId = state.activeConvId
      if (!activeConvId) {
        const conv = await window.api?.aiConvCreate(state.bookId)
        if (!conv) return false
        activeConvId = conv.id
        set((s) => ({
          activeConvId: conv.id,
          conversations: [
            {
              id: conv.id,
              title: conv.title,
              createdAt: conv.createdAt,
              messageCount: 0
            },
            ...s.conversations
          ]
        }))
      }

      const userMessage: AiChatMessage = {
        id: newId('user'),
        role: 'user',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
        status: 'complete'
      }
      const assistantMessage: AiChatMessage = {
        id: newId('assistant'),
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt: new Date().toISOString(),
        status: 'streaming',
        requestId: newId('request'),
        sources: [],
        retrievalStatus: 'searching'
      }

      const promptMessages: AiHistoryMessage[] = [
        ...toHistoryMessages(state.messages),
        { id: userMessage.id, role: 'user', content: text }
      ]

      set((s) => ({
        messages: [...s.messages, userMessage],
        activeConvId
      }))

      return startGeneration(promptMessages, assistantMessage)
    },

    cancelStream: async () => {
      const requestId = get().currentRequestId
      if (requestId) await window.api?.aiCancel(requestId)
    },

    clearHistory: async () => {
      const bookId = get().bookId
      if (!bookId) return
      if (get().isStreaming) await get().cancelStream()
      const result = await window.api?.aiHistoryClear(bookId)
      if (result?.success) {
        const conv = await window.api?.aiConvCreate(bookId)
        set({
          messages: [],
          conversations: conv
            ? [
                {
                  id: conv.id,
                  title: conv.title,
                  createdAt: conv.createdAt,
                  messageCount: 0
                }
              ]
            : [],
          activeConvId: conv?.id ?? null,
          currentSources: []
        })
      }
    },

    loadConversations: async () => {
      const bookId = get().bookId
      if (!bookId) return
      const list = await window.api?.aiConvList(bookId)
      if (list) {
        set({
          conversations: list.conversations,
          activeConvId: list.activeId ?? get().activeConvId
        })
      }
    },

    newConversation: async () => {
      const bookId = get().bookId
      if (!bookId) return
      if (get().isStreaming) await get().cancelStream()
      const conv = await window.api?.aiConvCreate(bookId)
      if (conv) {
        set((state) => ({
          activeConvId: conv.id,
          messages: [],
          currentSources: [],
          conversations: [
            {
              id: conv.id,
              title: conv.title,
              createdAt: conv.createdAt,
              messageCount: 0
            },
            ...state.conversations
          ]
        }))
      }
    },

    switchConversation: async (convId) => {
      const bookId = get().bookId
      if (!bookId) return
      if (get().isStreaming) await get().cancelStream()
      const history = await window.api?.aiConvLoad(bookId, convId)
      if (history === undefined) return
      await window.api?.aiConvSetActive(bookId, convId)
      set({
        activeConvId: convId,
        messages: history
          .map(toChatMessage)
          .filter((m): m is AiChatMessage => !!m),
        currentSources: [],
        isStreaming: false,
        currentRequestId: null
      })
    },

    deleteConversation: async (convId) => {
      const bookId = get().bookId
      if (!bookId) return
      const state = get()
      if (state.isStreaming && state.activeConvId === convId) {
        await get().cancelStream()
      }
      await window.api?.aiConvDelete(bookId, convId)
      const listed = await window.api?.aiConvList(bookId)
      let conversations = listed?.conversations || state.conversations.filter((c) => c.id !== convId)
      let activeConvId = listed?.activeId ?? null

      if (conversations.length === 0) {
        const created = await window.api?.aiConvCreate(bookId)
        if (created) {
          activeConvId = created.id
          conversations = [
            {
              id: created.id,
              title: created.title,
              createdAt: created.createdAt,
              messageCount: 0
            }
          ]
        }
      }

      if (!activeConvId && conversations[0]) activeConvId = conversations[0].id

      let messages: AiChatMessage[] = []
      if (activeConvId) {
        const history = await window.api?.aiConvLoad(bookId, activeConvId)
        messages = (history || [])
          .map(toChatMessage)
          .filter((m): m is AiChatMessage => !!m)
        void window.api?.aiConvSetActive(bookId, activeConvId)
      }

      set({
        conversations,
        activeConvId,
        messages,
        currentSources: [],
        isStreaming: false,
        currentRequestId: null
      })
    },

    renameConversation: async (convId, title) => {
      const bookId = get().bookId
      if (!bookId) return false
      const result = await window.api?.aiConvRename(bookId, convId, title)
      if (!result?.success) return false
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === convId ? { ...c, title: title.trim().slice(0, 60) } : c
        )
      }))
      return true
    },

    copyMessage: async (messageId) => {
      const message = get().messages.find((m) => m.id === messageId)
      if (!message) return false
      const text = textOf(message)
      if (!text) return false
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },

    deleteMessage: async (messageId) => {
      const state = get()
      if (state.isStreaming || !state.bookId || !state.activeConvId) return
      const index = state.messages.findIndex((m) => m.id === messageId)
      if (index < 0) return
      const target = state.messages[index]
      let next = [...state.messages]
      if (target.role === 'user') {
        // 删除用户消息及其后紧跟的助手回复
        const removeCount =
          next[index + 1]?.role === 'assistant' ? 2 : 1
        next.splice(index, removeCount)
      } else {
        next.splice(index, 1)
      }
      set({ messages: next, currentSources: [] })
      await persistMessages(state.bookId, state.activeConvId, next)
      void get().loadConversations()
    },

    editAndResend: async (messageId, newText) => {
      const text = newText.trim()
      const state = get()
      if (!text || state.isStreaming || !state.bookId || !state.activeConvId) return false
      const index = state.messages.findIndex((m) => m.id === messageId && m.role === 'user')
      if (index < 0) return false

      const edited: AiChatMessage = {
        ...state.messages[index],
        parts: [{ type: 'text', text }],
        status: 'complete'
      }
      // 截断该用户消息之后的所有内容
      const kept = [...state.messages.slice(0, index), edited]
      set({ messages: kept })

      const promptMessages: AiHistoryMessage[] = toHistoryMessages(kept)
      const assistantMessage: AiChatMessage = {
        id: newId('assistant'),
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt: new Date().toISOString(),
        status: 'streaming',
        requestId: newId('request'),
        sources: [],
        retrievalStatus: 'searching'
      }
      return startGeneration(promptMessages, assistantMessage)
    },

    regenerate: async (assistantMessageId) => {
      const state = get()
      if (state.isStreaming || !state.bookId || !state.activeConvId) return false
      const index = state.messages.findIndex(
        (m) => m.id === assistantMessageId && m.role === 'assistant'
      )
      if (index < 0) return false
      // 找到紧前的用户消息
      let userIndex = index - 1
      while (userIndex >= 0 && state.messages[userIndex].role !== 'user') userIndex -= 1
      if (userIndex < 0) return false

      const kept = state.messages.slice(0, index)
      set({ messages: kept })

      const promptMessages = toHistoryMessages(kept)
      const assistantMessage: AiChatMessage = {
        id: newId('assistant'),
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt: new Date().toISOString(),
        status: 'streaming',
        requestId: newId('request'),
        sources: [],
        retrievalStatus: 'searching'
      }
      return startGeneration(promptMessages, assistantMessage)
    },

    retryError: async (assistantMessageId) => {
      // 错误重试与重新生成相同：去掉错误助手消息再请求
      return get().regenerate(assistantMessageId)
    },

    dispose: () => {
      initializationGeneration += 1
      const requestId = get().currentRequestId
      if (requestId) void window.api?.aiCancel(requestId)
      resetSeqState()
      disposeListeners()
    }
  }
})
