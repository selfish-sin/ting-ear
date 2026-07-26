import { create } from 'zustand'
import type {
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
  quotes: string[]
  quoteRevision: number
  pendingChatFocusRequestId: number | null
  conversations: ConvSummary[]
  activeConvId: string | null
  /** 已注入过全文的会话键 bookId:convId */
  fullTextInjectedKeys: Record<string, true>
  addQuote: (text: string) => void
  removeQuote: (index: number) => void
  clearQuotes: () => void
  requestChatFocus: () => void
  consumeChatFocusRequest: (requestId: number) => void
  initialize: (bookId: string, bookTitle: string) => Promise<void>
  refreshNmemStatus: (force?: boolean) => Promise<void>
  sendMessage: (text: string) => Promise<boolean>
  cancelStream: () => Promise<void>
  clearHistory: () => Promise<void>
  loadConversations: () => Promise<void>
  newConversation: () => Promise<void>
  switchConversation: (convId: string) => Promise<void>
  deleteConversation: (convId: string) => Promise<void>
  dispose: () => void
}

let listenerCleanups: Array<() => void> = []
let nextSequence = 0
let initializationGeneration = 0
let nextChatFocusRequestId = 0

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${id}`
}

function textOf(message: AiChatMessage): string {
  return message.parts.map((part) => part.text).join('')
}

function toChatMessage(message: AiHistoryMessage): AiChatMessage | null {
  if (message.role === 'system') return null
  return {
    id: newId(message.role),
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

function convInjectKey(bookId: string, convId: string | null): string {
  return `${bookId}:${convId || '__default__'}`
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
        if (event.requestId !== get().currentRequestId || event.seq !== nextSequence) return
        nextSequence += 1
        set((state) => ({
          messages: updateAssistant(state.messages, event.requestId, (message) => ({
            ...message,
            parts: [{ type: 'text', text: `${textOf(message)}${event.text}` }]
          }))
        }))
      }),
      window.api.onAiChatDone((event: AiChatDoneEvent) => {
        if (event.requestId !== get().currentRequestId) return
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
      }),
      window.api.onAiChatError((event: AiChatErrorEvent) => {
        if (event.requestId !== get().currentRequestId) return
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

  return {
    bookId: null,
    bookTitle: '',
    messages: [],
    isStreaming: false,
    currentRequestId: null,
    currentSources: [],
    nmemStatus: 'checking',
    nmemError: null,
    quotes: [],
    quoteRevision: 0,
    pendingChatFocusRequestId: null,
    conversations: [],
    activeConvId: null,
    fullTextInjectedKeys: {},

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

    initialize: async (bookId, bookTitle) => {
      const generation = ++initializationGeneration
      bindListeners()
      const [historyResult, nmem] = await Promise.all([
        (window.api?.aiHistoryGet(bookId) || Promise.resolve([]))
          .then((history) => ({ history, error: null as unknown }))
          .catch((error: unknown) => ({ history: [] as AiHistoryMessage[], error })),
        window.api
          .aiNmemStatus()
          .catch((error) => ({
            status: 'offline' as const,
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          }))
      ])
      if (generation !== initializationGeneration) return
      set((state) => {
        const sameBook = state.bookId === bookId
        return {
          bookId,
          bookTitle,
          messages: historyResult.error
            ? [historyLoadFailure(historyResult.error)]
            : historyResult.history
                .map(toChatMessage)
                .filter((message): message is AiChatMessage => !!message),
          isStreaming: false,
          currentRequestId: null,
          currentSources: [],
          quotes: sameBook ? state.quotes : [],
          quoteRevision: sameBook ? state.quoteRevision : state.quoteRevision + 1,
          nmemStatus: nmem.status,
          nmemError: nmem.status === 'offline' ? nmem.error || '知识库未连接' : null,
          // 换书清空注入记录；同书保留各会话标记
          fullTextInjectedKeys: sameBook ? state.fullTextInjectedKeys : {}
        }
      })
    },

    sendMessage: async (rawText) => {
      const text = rawText.trim()
      const state = get()
      if (!text || !state.bookId || state.isStreaming) return false
      const quotes = [...state.quotes]
      const quoteRevision = state.quoteRevision
      const readingContext = snapshotReadingContext()

      // 会话级「当前章」注入：本章字数 ≤ fullTextMaxChars 且本会话尚未注入（不是全书）
      const bookStore = useBookStore.getState()
      const aiSettings = useSettingsStore.getState().settings.ai
      const maxChars = aiSettings?.chat?.fullTextMaxChars ?? 50000
      const chapters = bookStore.chapters
      const chapterMeta =
        chapters.length > 0
          ? chapters[
              Math.max(
                0,
                Math.min(readingContext.currentChapterIndex, chapters.length - 1)
              )
            ]
          : {
              startIndex: 0,
              sentenceCount: bookStore.sentences.length
            }
      const fullText = buildChapterFullText(bookStore.sentences, chapterMeta)
      // 注入标记按「会话 + 章」区分，换章后可再注入新章（仍每会话每章一次）
      const injectKey = `${convInjectKey(state.bookId, state.activeConvId)}:ch${readingContext.currentChapterIndex}`
      const hasHistory = state.messages.some(
        (m) => m.role === 'user' && m.status === 'complete' && textOf(m)
      )
      // 同会话内已注入过任意章后，追问不再重复注入（即使用户换章）
      // —— 用户要求「一次会话记录只加一次」
      const sessionKey = convInjectKey(state.bookId, state.activeConvId)
      const alreadyInjected =
        Boolean(state.fullTextInjectedKeys[sessionKey]) ||
        Boolean(state.fullTextInjectedKeys[injectKey]) ||
        hasHistory
      const injectFullText = shouldInjectFullText(fullText, maxChars, alreadyInjected)

      const requestId = newId('request')
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
        requestId,
        sources: [],
        retrievalStatus: 'searching'
      }
      const promptMessages: AiHistoryMessage[] = [
        ...state.messages
          .filter((message) => message.status !== 'error' && textOf(message))
          .map((message) => ({
            role: message.role,
            content: textOf(message),
            sources: message.sources,
            retrievalStatus:
              message.retrievalStatus === 'searching' ? 'skipped' : message.retrievalStatus,
            retrievalError: message.retrievalError
          })),
        { role: 'user', content: text }
      ]

      nextSequence = 0
      set({
        messages: [...state.messages, userMessage, assistantMessage],
        isStreaming: true,
        currentRequestId: requestId,
        // 乐观标记：本会话已注入（会话级 + 章级），避免连发两次
        fullTextInjectedKeys: injectFullText
          ? {
              ...state.fullTextInjectedKeys,
              [sessionKey]: true,
              [injectKey]: true
            }
          : state.fullTextInjectedKeys
      })

      try {
        const result = await window.api.aiChat(requestId, {
          bookId: state.bookId,
          bookTitle: state.bookTitle,
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
        set((current) => {
          // 失败时回滚注入标记，允许下次重试
          const keys = { ...current.fullTextInjectedKeys }
          if (injectFullText) {
            delete keys[injectKey]
            delete keys[sessionKey]
          }
          return {
            messages: updateAssistant(current.messages, requestId, (item) => ({
              ...item,
              status: 'error',
              error: message
            })),
            isStreaming: false,
            currentRequestId: null,
            fullTextInjectedKeys: keys
          }
        })
        return false
      }
    },

    cancelStream: async () => {
      const requestId = get().currentRequestId
      if (requestId) await window.api?.aiCancel(requestId)
    },

    clearHistory: async () => {
      const bookId = get().bookId
      if (!bookId) return
      const result = await window.api?.aiHistoryClear(bookId)
      if (result?.success) set({ messages: [], conversations: [], activeConvId: null })
    },

    loadConversations: async () => {
      const bookId = get().bookId
      if (!bookId) return
      const list = await window.api?.aiConvList(bookId)
      if (list) set({ conversations: list })
    },

    newConversation: async () => {
      const bookId = get().bookId
      if (!bookId) return
      const conv = await window.api?.aiConvCreate(bookId)
      if (conv) {
        set((state) => ({
          activeConvId: conv.id,
          messages: [],
          currentSources: [],
          conversations: [{ id: conv.id, title: conv.title, createdAt: conv.createdAt, messageCount: 0 }, ...state.conversations]
        }))
      }
    },

    switchConversation: async (convId) => {
      const bookId = get().bookId
      if (!bookId) return
      const history = await window.api?.aiConvLoad(bookId, convId)
      if (history) {
        set({
          activeConvId: convId,
          messages: history
            .map((m) => ({
              id: `hist-${Math.random().toString(36).slice(2)}`,
              role: m.role as 'user' | 'assistant',
              parts: [{ type: 'text' as const, text: m.content }],
              createdAt: '',
              status: 'complete' as const,
              sources: m.sources
            }))
            .filter((m) => m.role === 'user' || m.role === 'assistant'),
          currentSources: [],
          isStreaming: false
        })
      }
    },

    deleteConversation: async (convId) => {
      const bookId = get().bookId
      if (!bookId) return
      await window.api?.aiConvDelete(bookId, convId)
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== convId)
        const activeConvId = state.activeConvId === convId ? (conversations[0]?.id ?? null) : state.activeConvId
        return { conversations, activeConvId }
      })
    },

    dispose: () => {
      initializationGeneration += 1
      const requestId = get().currentRequestId
      if (requestId) void window.api?.aiCancel(requestId)
      disposeListeners()
    }
  }
})
