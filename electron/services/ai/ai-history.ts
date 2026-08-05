import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiConversation, AiHistoryMessage, AiHistoryRepository, AiSourceRef } from '../../../src/global'

const MAX_MESSAGES_PER_CONVERSATION = 200
const MAX_CONVERSATIONS_PER_BOOK = 20

/** 每本书：活跃会话 + 会话列表 */
type BookHistoryState = {
  activeId: string | null
  conversations: AiConversation[]
}

type HistoryFileV3 = Record<string, BookHistoryState>
/** 旧 V2：每本书一个会话数组 */
type HistoryFileV2 = Record<string, AiConversation[]>
/** 旧 V1：每本书一个扁平消息数组 */
type HistoryFileV1 = Record<string, AiHistoryMessage[]>

const HISTORY_RETRIEVAL_STATUSES = new Set(['done', 'offline', 'error', 'skipped'])

function newMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isSourceRef(value: unknown): value is AiSourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Partial<AiSourceRef>
  return (
    Number.isInteger(source.index) &&
    (source.index as number) >= 1 &&
    typeof source.memoryId === 'string' &&
    typeof source.content === 'string' &&
    typeof source.source === 'string' &&
    typeof source.score === 'number' &&
    Number.isFinite(source.score) &&
    typeof source.bookId === 'string' &&
    Number.isInteger(source.chapterIndex) &&
    // -1 = 全书源；>=0 = 具体章节
    (source.chapterIndex as number) >= -1 &&
    typeof source.chapterTitle === 'string'
  )
}

function isWebSourceRef(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return (
    Number.isInteger(source.index) &&
    (source.index as number) >= 1 &&
    typeof source.title === 'string' &&
    typeof source.url === 'string' &&
    typeof source.snippet === 'string' &&
    typeof source.provider === 'string' &&
    typeof source.sourceType === 'string' &&
    typeof source.fetchedAt === 'string'
  )
}

function isHistoryMessage(value: unknown): value is AiHistoryMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AiHistoryMessage>
  return (
    (candidate.role === 'system' || candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    (candidate.id === undefined || typeof candidate.id === 'string') &&
    (candidate.sources === undefined ||
      (Array.isArray(candidate.sources) && candidate.sources.every(isSourceRef))) &&
    (candidate.webSources === undefined ||
      (Array.isArray(candidate.webSources) && candidate.webSources.every(isWebSourceRef))) &&
    (candidate.webSearchUsed === undefined || typeof candidate.webSearchUsed === 'boolean') &&
    (candidate.toolTraces === undefined ||
      (Array.isArray(candidate.toolTraces) &&
        candidate.toolTraces.every(
          (t) =>
            t &&
            typeof t === 'object' &&
            typeof (t as { name?: unknown }).name === 'string' &&
            typeof (t as { ok?: unknown }).ok === 'boolean'
        ))) &&
    (candidate.thinkingMode === undefined || typeof candidate.thinkingMode === 'boolean') &&
    (candidate.reasoning === undefined || typeof candidate.reasoning === 'string') &&
    (candidate.retrievalStatus === undefined ||
      HISTORY_RETRIEVAL_STATUSES.has(candidate.retrievalStatus)) &&
    (candidate.retrievalError === undefined || typeof candidate.retrievalError === 'string')
  )
}

function isConversation(value: unknown): value is AiConversation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const c = value as Partial<AiConversation>
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.createdAt === 'string' &&
    Array.isArray(c.messages) &&
    c.messages.every(isHistoryMessage)
  )
}

function isBookHistoryState(value: unknown): value is BookHistoryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<BookHistoryState>
  return (
    (state.activeId === null || typeof state.activeId === 'string') &&
    Array.isArray(state.conversations) &&
    state.conversations.every(isConversation)
  )
}

function ensureMessageIds(messages: AiHistoryMessage[]): AiHistoryMessage[] {
  return messages.map((message) =>
    message.id ? message : { ...message, id: newMessageId() }
  )
}

function normalizeMessages(messages: AiHistoryMessage[]): AiHistoryMessage[] {
  return ensureMessageIds(messages.filter(isHistoryMessage)).slice(-MAX_MESSAGES_PER_CONVERSATION)
}

function autoTitle(messages: AiHistoryMessage[], currentTitle: string): string {
  if (currentTitle && currentTitle !== '新对话') return currentTitle
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  return firstUser?.content.trim().slice(0, 30) || currentTitle || '新对话'
}

function emptyBookState(): BookHistoryState {
  return { activeId: null, conversations: [] }
}

function fromConversationList(conversations: AiConversation[]): BookHistoryState {
  const list = conversations.slice(0, MAX_CONVERSATIONS_PER_BOOK)
  return {
    activeId: list[0]?.id ?? null,
    conversations: list
  }
}

/** 检测并迁移旧格式到 V3 */
function migrateToV3(data: Record<string, unknown>): HistoryFileV3 {
  const result: HistoryFileV3 = {}
  for (const [bookId, value] of Object.entries(data)) {
    if (isBookHistoryState(value)) {
      const conversations = value.conversations.slice(0, MAX_CONVERSATIONS_PER_BOOK).map((conv) => ({
        ...conv,
        messages: ensureMessageIds(conv.messages)
      }))
      const activeId =
        value.activeId && conversations.some((c) => c.id === value.activeId)
          ? value.activeId
          : conversations[0]?.id ?? null
      result[bookId] = { activeId, conversations }
      continue
    }

    if (!Array.isArray(value)) throw new Error('invalid book history entry')
    if (value.length === 0) {
      result[bookId] = emptyBookState()
      continue
    }

    if (value.every(isConversation)) {
      result[bookId] = fromConversationList(
        (value as AiConversation[]).map((conv) => ({
          ...conv,
          messages: ensureMessageIds(conv.messages)
        }))
      )
      continue
    }

    if (!value.every(isHistoryMessage)) throw new Error('invalid history message')

    const messages = normalizeMessages(value as HistoryFileV1[string])
    const firstUser = messages.find((message) => message.role === 'user')
    const conv: AiConversation = {
      id: 'migrated',
      title: firstUser?.content.slice(0, 30) || '历史对话',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages
    }
    result[bookId] = { activeId: conv.id, conversations: [conv] }
  }
  return result
}

export class JsonAiHistoryRepository implements AiHistoryRepository {
  /** 内存缓存：避免每次 save 都全量 readFileSync 卡主进程 */
  private cache: HistoryFileV3 | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private readonly persistDelayMs = 50

  constructor(private readonly dataDir: string | (() => string)) {}

  private get filePath(): string {
    const dataDir = typeof this.dataDir === 'function' ? this.dataDir() : this.dataDir
    return join(dataDir, 'ai-history.json')
  }

  private loadFromDisk(): HistoryFileV3 {
    if (!existsSync(this.filePath)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid history root')
      }
      return migrateToV3(parsed)
    } catch (error) {
      throw new Error('AI 对话历史文件损坏', { cause: error })
    }
  }

  private readAll(): HistoryFileV3 {
    if (!this.cache) this.cache = this.loadFromDisk()
    return this.cache
  }

  /** 同步落盘（测试 / 退出时用） */
  flushSync(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.cache) return
    const tempPath = `${this.filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(this.cache, null, 2), 'utf8')
    renameSync(tempPath, this.filePath)
  }

  private writeAll(history: HistoryFileV3): void {
    this.cache = history
    // 短防抖：合并连写，且延后到下一 tick，减轻对话结束瞬间的主进程卡顿
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        this.flushSync()
      } catch (error) {
        console.error('[AiHistory] persist failed:', error)
      }
    }, this.persistDelayMs)
  }

  private getBook(history: HistoryFileV3, bookId: string): BookHistoryState {
    return history[bookId] || emptyBookState()
  }

  private resolveTargetId(book: BookHistoryState, conversationId?: string): string | null {
    if (conversationId) {
      if (book.conversations.some((c) => c.id === conversationId)) return conversationId
      return null
    }
    if (book.activeId && book.conversations.some((c) => c.id === book.activeId)) {
      return book.activeId
    }
    return book.conversations[0]?.id ?? null
  }

  // === AiHistoryRepository 接口 ===

  load(bookId: string): AiHistoryMessage[] {
    const book = this.getBook(this.readAll(), bookId)
    const targetId = this.resolveTargetId(book)
    if (!targetId) return []
    const conv = book.conversations.find((c) => c.id === targetId)
    return conv?.messages || []
  }

  save(bookId: string, messages: AiHistoryMessage[], conversationId?: string): void {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    let targetId = this.resolveTargetId(book, conversationId)

    if (!targetId) {
      if (conversationId) {
        // 指定了会话但不存在：创建该 id
        const now = new Date().toISOString()
        const conv: AiConversation = {
          id: conversationId,
          title: autoTitle(messages, '新对话'),
          createdAt: now,
          updatedAt: now,
          messages: normalizeMessages(messages)
        }
        book.conversations.unshift(conv)
        book.activeId = conversationId
        book.conversations = book.conversations.slice(0, MAX_CONVERSATIONS_PER_BOOK)
        history[bookId] = book
        this.writeAll(history)
        return
      }
      const now = new Date().toISOString()
      const conv: AiConversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: autoTitle(messages, '新对话'),
        createdAt: now,
        updatedAt: now,
        messages: normalizeMessages(messages)
      }
      book.conversations.unshift(conv)
      book.activeId = conv.id
      history[bookId] = book
      this.writeAll(history)
      return
    }

    const conv = book.conversations.find((c) => c.id === targetId)
    if (!conv) return
    conv.messages = normalizeMessages(messages)
    conv.title = autoTitle(messages, conv.title)
    conv.updatedAt = new Date().toISOString()
    book.activeId = targetId
    // 最近写入的会话顶到前面，便于列表展示
    book.conversations = [
      conv,
      ...book.conversations.filter((c) => c.id !== targetId)
    ].slice(0, MAX_CONVERSATIONS_PER_BOOK)
    history[bookId] = book
    this.writeAll(history)
  }

  clear(bookId?: string): void {
    if (!bookId) {
      this.writeAll({})
      return
    }
    const history = this.readAll()
    delete history[bookId]
    this.writeAll(history)
  }

  // === 多会话管理 ===

  listConversations(bookId: string): {
    activeId: string | null
    conversations: Array<{ id: string; title: string; createdAt: string; messageCount: number }>
  } {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    const pruned = pruneEmptyNewConversations(book.conversations)
    if (pruned.length !== book.conversations.length) {
      book.conversations = pruned
      if (book.activeId && !pruned.some((c) => c.id === book.activeId)) {
        book.activeId = pruned[0]?.id ?? null
      }
      history[bookId] = book
      this.writeAll(history)
    }
    const activeId = this.resolveTargetId(book)
    return {
      activeId,
      conversations: book.conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        messageCount: c.messages.length
      }))
    }
  }

  loadConversation(bookId: string, conversationId: string): AiHistoryMessage[] {
    const book = this.getBook(this.readAll(), bookId)
    const conv = book.conversations.find((c) => c.id === conversationId)
    return conv?.messages || []
  }

  createConversation(bookId: string, title?: string): AiConversation {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    // 新建时丢掉其它空「新对话」，只保留有内容的会话 + 这一条新会话
    book.conversations = book.conversations.filter((c) => !isEmptyNewConversation(c))
    const now = new Date().toISOString()
    const conv: AiConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title || '新对话',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    book.conversations.unshift(conv)
    book.activeId = conv.id
    book.conversations = book.conversations.slice(0, MAX_CONVERSATIONS_PER_BOOK)
    history[bookId] = book
    this.writeAll(history)
    return conv
  }

  saveConversation(bookId: string, conversationId: string, messages: AiHistoryMessage[]): void {
    this.save(bookId, messages, conversationId)
  }

  deleteConversation(bookId: string, conversationId: string): void {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    book.conversations = book.conversations.filter((c) => c.id !== conversationId)
    if (book.activeId === conversationId) {
      book.activeId = book.conversations[0]?.id ?? null
    }
    if (book.conversations.length === 0) {
      delete history[bookId]
    } else {
      history[bookId] = book
    }
    this.writeAll(history)
  }

  renameConversation(bookId: string, conversationId: string, title: string): boolean {
    const trimmed = title.trim().slice(0, 60)
    if (!trimmed) return false
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    const conv = book.conversations.find((c) => c.id === conversationId)
    if (!conv) return false
    conv.title = trimmed
    conv.updatedAt = new Date().toISOString()
    history[bookId] = book
    this.writeAll(history)
    return true
  }

  setActiveConversation(bookId: string, conversationId: string): boolean {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    if (!book.conversations.some((c) => c.id === conversationId)) return false
    book.activeId = conversationId
    history[bookId] = book
    this.writeAll(history)
    return true
  }

  /**
   * 确保该书至少有一个活跃会话。
   * - 有历史：返回 active（或最近一条），绝不重复创建空会话
   * - 无会话：创建一条
   * - 顺带清理多个空「新对话」残留
   */
  ensureActiveConversation(bookId: string): AiConversation {
    const history = this.readAll()
    const book = this.getBook(history, bookId)
    const before = book.conversations.length
    book.conversations = pruneEmptyNewConversations(book.conversations)

    const activeId = this.resolveTargetId(book)
    if (activeId) {
      const existing = book.conversations.find((c) => c.id === activeId)
      if (existing) {
        book.activeId = existing.id
        if (book.conversations.length !== before || history[bookId]?.activeId !== existing.id) {
          history[bookId] = book
          this.writeAll(history)
        }
        return existing
      }
    }
    if (book.conversations[0]) {
      book.activeId = book.conversations[0].id
      history[bookId] = book
      this.writeAll(history)
      return book.conversations[0]
    }
    return this.createConversation(bookId)
  }
}

function isEmptyNewConversation(conv: AiConversation): boolean {
  return (
    !conv.messages?.length &&
    (!conv.title || conv.title === '新对话' || conv.title.trim() === '新对话')
  )
}

/** 多个空「新对话」只留最新一条，有消息的会话全部保留 */
function pruneEmptyNewConversations(conversations: AiConversation[]): AiConversation[] {
  let keptEmpty = false
  const result: AiConversation[] = []
  for (const conv of conversations) {
    if (isEmptyNewConversation(conv)) {
      if (keptEmpty) continue
      keptEmpty = true
    }
    result.push(conv)
  }
  return result
}
