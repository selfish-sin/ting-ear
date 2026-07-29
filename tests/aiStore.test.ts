import assert from 'node:assert/strict'
import type {
  AiChatChunkEvent,
  AiChatDoneEvent,
  AiChatErrorEvent,
  AiChatPayload,
  AiChatSourcesEvent,
  Api
} from '../src/global'

const persistedSource = {
  index: 1,
  memoryId: 'persisted-memory',
  content: '历史书内证据',
  source: '[bookId=book-1][ch=0] 第一章',
  score: 0.88,
  bookId: 'book-1',
  chapterIndex: 0,
  chapterTitle: '第一章'
}

console.log('\nAI store')

let chunkListener: ((event: AiChatChunkEvent) => void) | null = null
let doneListener: ((event: AiChatDoneEvent) => void) | null = null
let errorListener: ((event: AiChatErrorEvent) => void) | null = null
let sourcesListener: ((event: AiChatSourcesEvent) => void) | null = null
let sentRequest: { requestId: string; payload: unknown } | null = null
let canceledRequestId = ''
let chatShouldSucceed = true
let pendingChatResponse: Promise<{ success: boolean; error?: string }> | null = null
let historyLoadError: Error | null = null

const fakeApi: Partial<Api> = {
  aiHistoryGet: async () => {
    if (historyLoadError) throw historyLoadError
    return [
      { id: 'u-hist', role: 'user', content: '历史问题' },
      {
        id: 'a-hist',
        role: 'assistant',
        content: '历史回答 [1]',
        sources: [persistedSource],
        retrievalStatus: 'done'
      }
    ] as never
  },
  aiConvList: async () => {
    if (historyLoadError) throw historyLoadError
    return {
      activeId: 'conv-1',
      conversations: [
        { id: 'conv-1', title: '历史对话', createdAt: '2020-01-01T00:00:00.000Z', messageCount: 2 }
      ]
    }
  },
  aiConvLoad: async () => {
    if (historyLoadError) throw historyLoadError
    return [
      { id: 'u-hist', role: 'user', content: '历史问题' },
      {
        id: 'a-hist',
        role: 'assistant',
        content: '历史回答 [1]',
        sources: [persistedSource],
        retrievalStatus: 'done'
      }
    ] as never
  },
  aiConvCreate: async () => ({
    id: 'conv-new',
    title: '新对话',
    createdAt: new Date().toISOString(),
    messages: []
  }),
  aiConvSave: async () => ({ success: true }),
  aiConvDelete: async () => ({ success: true }),
  aiConvRename: async () => ({ success: true }),
  aiConvSetActive: async () => ({ success: true }),
  aiChat: async (requestId, payload) => {
    sentRequest = { requestId, payload }
    if (pendingChatResponse) {
      const response = await pendingChatResponse
      pendingChatResponse = null
      return response
    }
    return chatShouldSucceed
      ? { success: true }
      : { success: false, error: 'AI 请求未启动' }
  },
  aiCancel: async (requestId) => {
    canceledRequestId = requestId
    return { success: true }
  },
  aiHistoryClear: async () => ({ success: true }),
  aiNmemStatus: async () => ({ status: 'online', checkedAt: new Date().toISOString() }),
  aiNmemBookStatus: async () => ({ status: 'searchable' as const }),
  onAiChatChunk: (callback) => {
    chunkListener = callback
    return () => {
      chunkListener = null
    }
  },
  onAiChatSources: (callback) => {
    sourcesListener = callback
    return () => {
      sourcesListener = null
    }
  },
  onAiChatDone: (callback) => {
    doneListener = callback
    return () => {
      doneListener = null
    }
  },
  onAiChatError: (callback) => {
    errorListener = callback
    return () => {
      errorListener = null
    }
  }
}

Object.defineProperty(globalThis, 'window', {
  value: { api: fakeApi },
  configurable: true,
  writable: true
})

async function run(): Promise<void> {
  const { useAiStore } = await import('../src/stores/aiStore')
  const { usePlayerStore } = await import('../src/stores/playerStore')
  const { useBookStore } = await import('../src/stores/bookStore')

  await useAiStore.getState().initialize('book-1', '测试书')
  assert.deepEqual(
    useAiStore.getState().messages.map((message) => message.parts[0].text),
    ['历史问题', '历史回答 [1]']
  )
  assert.equal(useAiStore.getState().messages[1].sources?.[0].memoryId, 'persisted-memory')
  assert.equal(useAiStore.getState().messages[1].retrievalStatus, 'done')
  assert.equal(useAiStore.getState().activeConvId, 'conv-1')
  console.log('  ok loads persisted history for the current book')

  historyLoadError = new Error('磁盘不可读')
  await useAiStore.getState().initialize('book-history-error', '历史异常书籍')
  assert.equal(useAiStore.getState().messages.length, 1)
  assert.equal(useAiStore.getState().messages[0].status, 'error')
  assert.match(useAiStore.getState().messages[0].error || '', /对话历史加载失败.*磁盘不可读/)
  historyLoadError = null
  await useAiStore.getState().initialize('book-1', '测试书')
  console.log('  ok exposes history loading failures instead of silently showing empty history')

  const quoteState = useAiStore.getState() as typeof useAiStore extends {
    getState: () => infer State
  }
    ? State & {
        quotes: string[]
        addQuote: (text: string) => void
        removeQuote: (index: number) => void
        clearQuotes: () => void
      }
    : never
  assert.equal(typeof quoteState.addQuote, 'function', 'Slice E exposes quote actions')
  quoteState.clearQuotes()
  quoteState.addQuote('  第一条引用  ')
  quoteState.addQuote('第一条引用')
  quoteState.addQuote('第二条引用')
  quoteState.addQuote('第三条引用')
  quoteState.addQuote('第四条引用')
  quoteState.addQuote('第五条引用')
  quoteState.addQuote('第六条引用')
  assert.deepEqual(useAiStore.getState().quotes, [
    '第一条引用',
    '第二条引用',
    '第三条引用',
    '第四条引用',
    '第五条引用'
  ])
  useAiStore.getState().removeQuote(1)
  assert.deepEqual(useAiStore.getState().quotes, [
    '第一条引用',
    '第三条引用',
    '第四条引用',
    '第五条引用'
  ])
  console.log('  ok bounds, trims, deduplicates, and removes quotes')

  const currentBook = {
    id: 'book-1',
    title: '测试书',
    sentences: ['第一章开头', '当前正在阅读的句子', '后续句子'],
    chapters: [
      { title: '第一章', startIndex: 0, sentenceCount: 1 },
      { title: '第二章', startIndex: 1, sentenceCount: 2 }
    ]
  }
  useBookStore.setState({
    currentBook: currentBook as never,
    sentences: currentBook.sentences,
    chapters: currentBook.chapters
  })
  usePlayerStore.getState().setCurrentSentenceIndex(1)
  // Deliberately stale: the current sentence belongs to chapter 2.
  usePlayerStore.getState().setCurrentChapterIndex(0)
  assert.equal(await useAiStore.getState().sendMessage('新问题'), true)
  const requestId = useAiStore.getState().currentRequestId
  assert.ok(requestId)
  assert.equal(sentRequest?.requestId, requestId)
  assert.equal(useAiStore.getState().isStreaming, true)
  assert.equal(useAiStore.getState().nmemStatus, 'online')
  const sentPayload = sentRequest?.payload as AiChatPayload
  assert.equal(sentPayload.conversationId, 'conv-1')
  assert.equal(sentPayload.currentChapterIndex, 1)
  assert.equal(sentPayload.injectFullText, true)
  assert.deepEqual(sentPayload.quotes, [
    '第一条引用',
    '第三条引用',
    '第四条引用',
    '第五条引用'
  ])
  assert.match(sentPayload.autoContext || '', /测试书/)
  assert.match(sentPayload.autoContext || '', /第二章/)
  assert.match(sentPayload.autoContext || '', /当前正在阅读的句子/)
  assert.deepEqual(useAiStore.getState().quotes, [])
  console.log('  ok snapshots quotes and current reading context, then clears quotes after accepted send')

  sourcesListener?.({
    requestId,
    status: 'done',
    sources: [
      {
        index: 1,
        memoryId: 'memory-1',
        content: '书内证据',
        source: '[bookId=book-1][ch=1] 第二章',
        score: 0.9,
        bookId: 'book-1',
        chapterIndex: 1,
        chapterTitle: '第二章'
      }
    ]
  })
  assert.equal(useAiStore.getState().messages.at(-1)?.sources?.length, 1)
  assert.equal(useAiStore.getState().messages.at(-1)?.retrievalStatus, 'done')

  chunkListener?.({ requestId, seq: 0, text: '流式' })
  chunkListener?.({ requestId, seq: 1, text: '回答' })
  assert.equal(useAiStore.getState().messages.at(-1)?.parts[0].text, '流式回答')
  doneListener?.({ requestId, cancelled: false })
  assert.equal(useAiStore.getState().isStreaming, false)
  assert.equal(useAiStore.getState().messages.at(-1)?.status, 'complete')
  console.log('  ok appends ordered chunks to the pending assistant message')

  // 乱序 chunk 应缓冲重组，而不是静默丢弃
  assert.equal(await useAiStore.getState().sendMessage('乱序测试'), true)
  const reorderId = useAiStore.getState().currentRequestId
  assert.ok(reorderId)
  chunkListener?.({ requestId: reorderId, seq: 1, text: 'B' })
  chunkListener?.({ requestId: reorderId, seq: 0, text: 'A' })
  chunkListener?.({ requestId: reorderId, seq: 2, text: 'C' })
  assert.equal(useAiStore.getState().messages.at(-1)?.parts[0].text, 'ABC')
  doneListener?.({ requestId: reorderId, cancelled: false })
  console.log('  ok reorders out-of-sequence chunks instead of dropping them')

  useAiStore.getState().addQuote('失败后保留的引用')
  chatShouldSucceed = false
  assert.equal(await useAiStore.getState().sendMessage('这次启动失败'), false)
  assert.deepEqual(useAiStore.getState().quotes, ['失败后保留的引用'])
  useAiStore.getState().clearQuotes()
  chatShouldSucceed = true
  console.log('  ok retains quotes when the request is not accepted')

  let resolvePendingChat!: (result: { success: boolean }) => void
  pendingChatResponse = new Promise((resolve) => {
    resolvePendingChat = resolve
  })
  useAiStore.getState().addQuote('重新附加的相同引用')
  const pendingSend = useAiStore.getState().sendMessage('等待请求接受')
  useAiStore.getState().removeQuote(0)
  useAiStore.getState().addQuote('重新附加的相同引用')
  resolvePendingChat({ success: true })
  assert.equal(await pendingSend, true)
  assert.deepEqual(useAiStore.getState().quotes, ['重新附加的相同引用'])
  const reattachRequestId = useAiStore.getState().currentRequestId
  assert.ok(reattachRequestId)
  doneListener?.({ requestId: reattachRequestId, cancelled: false })
  useAiStore.getState().clearQuotes()
  console.log('  ok preserves an identical quote reattached while IPC acceptance is pending')

  await useAiStore.getState().sendMessage('停止这个回答')
  const secondRequestId = useAiStore.getState().currentRequestId
  assert.ok(secondRequestId)
  await useAiStore.getState().cancelStream()
  assert.equal(canceledRequestId, secondRequestId)
  console.log('  ok cancels the active request')

  sourcesListener?.({
    requestId: secondRequestId,
    status: 'offline',
    sources: [],
    error: '知识库未连接'
  })
  assert.equal(useAiStore.getState().nmemStatus, 'offline')

  sourcesListener?.({
    requestId: secondRequestId,
    status: 'done',
    sources: [persistedSource]
  })
  assert.equal(useAiStore.getState().nmemStatus, 'online')
  assert.equal(useAiStore.getState().nmemError, null)
  console.log('  ok exposes retrieval sources and offline status')

  errorListener?.({ requestId: secondRequestId, code: 'model_error', message: '模型不可用' })
  assert.equal(useAiStore.getState().messages.at(-1)?.status, 'error')
  assert.equal(useAiStore.getState().messages.at(-1)?.error, '模型不可用')
  console.log('  ok exposes stream errors on the assistant message')

  const focusState = useAiStore.getState() as ReturnType<typeof useAiStore.getState> & {
    pendingChatFocusRequestId: number | null
    requestChatFocus: () => void
    consumeChatFocusRequest: (requestId: number) => void
  }
  assert.equal(typeof focusState.requestChatFocus, 'function', 'Slice E exposes a durable focus request')
  focusState.requestChatFocus()
  const focusRequestId = useAiStore.getState().pendingChatFocusRequestId
  assert.equal(typeof focusRequestId, 'number')
  useAiStore.getState().consumeChatFocusRequest((focusRequestId as number) + 1)
  assert.equal(useAiStore.getState().pendingChatFocusRequestId, focusRequestId)
  useAiStore.getState().consumeChatFocusRequest(focusRequestId as number)
  assert.equal(useAiStore.getState().pendingChatFocusRequestId, null)
  console.log('  ok keeps a chat focus request pending until the matching panel consumes it')

  useAiStore.getState().dispose()
  console.log('AI store result: 12 passed')
}

void run()
