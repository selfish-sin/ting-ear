import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiConversation, AiHistoryMessage, AiHistoryRepository, AiSourceRef } from '../../../src/global'

const MAX_MESSAGES_PER_CONVERSATION = 200
const MAX_CONVERSATIONS_PER_BOOK = 20

type HistoryFileV2 = Record<string, AiConversation[]>
/** 旧格式：每本书一个扁平消息数组 */
type HistoryFileV1 = Record<string, AiHistoryMessage[]>

const HISTORY_RETRIEVAL_STATUSES = new Set(['done', 'offline', 'error', 'skipped'])

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
    (source.chapterIndex as number) >= 0 &&
    typeof source.chapterTitle === 'string'
  )
}

function isHistoryMessage(value: unknown): value is AiHistoryMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AiHistoryMessage>
  return (
    (candidate.role === 'system' || candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    (candidate.sources === undefined ||
      (Array.isArray(candidate.sources) && candidate.sources.every(isSourceRef))) &&
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

/** 检测并迁移旧格式 */
function migrateV1toV2(data: Record<string, unknown>): HistoryFileV2 {
  const result: HistoryFileV2 = {}
  for (const [bookId, value] of Object.entries(data)) {
    if (!Array.isArray(value)) throw new Error('invalid book history entry')
    if (value.length === 0) {
      result[bookId] = []
      continue
    }
    if (value.every(isConversation)) {
      result[bookId] = (value as AiConversation[]).slice(0, MAX_CONVERSATIONS_PER_BOOK)
      continue
    }
    if (!value.every(isHistoryMessage)) throw new Error('invalid history message')

    const messages = (value as HistoryFileV1[string]).slice(-MAX_MESSAGES_PER_CONVERSATION)
    const firstUser = messages.find((message) => message.role === 'user')
    result[bookId] = [{
      id: 'migrated',
      title: firstUser?.content.slice(0, 30) || '历史对话',
      createdAt: new Date().toISOString(),
      messages
    }]
  }
  return result
}

export class JsonAiHistoryRepository implements AiHistoryRepository {
  constructor(private readonly dataDir: string | (() => string)) {}

  private get filePath(): string {
    const dataDir = typeof this.dataDir === 'function' ? this.dataDir() : this.dataDir
    return join(dataDir, 'ai-history.json')
  }

  private readAll(): HistoryFileV2 {
    if (!existsSync(this.filePath)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid history root')
      }
      return migrateV1toV2(parsed)
    } catch (error) {
      throw new Error('AI 对话历史文件损坏', { cause: error })
    }
  }

  private writeAll(history: HistoryFileV2): void {
    const tempPath = `${this.filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(history, null, 2), 'utf8')
    renameSync(tempPath, this.filePath)
  }

  // === AiHistoryRepository 接口（向后兼容：操作活跃会话） ===

  load(bookId: string): AiHistoryMessage[] {
    const conversations = this.readAll()[bookId]
    if (!conversations || conversations.length === 0) return []
    return conversations[0].messages
  }

  save(bookId: string, messages: AiHistoryMessage[]): void {
    const history = this.readAll()
    const conversations = history[bookId] || []
    if (conversations.length === 0) {
      const firstUser = messages.find((m) => m.role === 'user')
      conversations.push({
        id: `conv-${Date.now()}`,
        title: firstUser?.content.slice(0, 30) || '新对话',
        createdAt: new Date().toISOString(),
        messages: []
      })
    }
    conversations[0].messages = messages.filter(isHistoryMessage).slice(-MAX_MESSAGES_PER_CONVERSATION)
    // 自动更新标题
    if (conversations[0].title === '新对话') {
      const firstUser = messages.find((m) => m.role === 'user')
      if (firstUser) conversations[0].title = firstUser.content.slice(0, 30)
    }
    history[bookId] = conversations
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

  listConversations(bookId: string): Array<{ id: string; title: string; createdAt: string; messageCount: number }> {
    const conversations = this.readAll()[bookId] || []
    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messageCount: c.messages.length
    }))
  }

  loadConversation(bookId: string, conversationId: string): AiHistoryMessage[] {
    const conversations = this.readAll()[bookId] || []
    const conv = conversations.find((c) => c.id === conversationId)
    return conv?.messages || []
  }

  createConversation(bookId: string, title?: string): AiConversation {
    const history = this.readAll()
    const conversations = history[bookId] || []
    const conv: AiConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title || '新对话',
      createdAt: new Date().toISOString(),
      messages: []
    }
    conversations.unshift(conv)
    history[bookId] = conversations.slice(0, MAX_CONVERSATIONS_PER_BOOK)
    this.writeAll(history)
    return conv
  }

  saveConversation(bookId: string, conversationId: string, messages: AiHistoryMessage[]): void {
    const history = this.readAll()
    const conversations = history[bookId] || []
    const conv = conversations.find((c) => c.id === conversationId)
    if (!conv) return
    conv.messages = messages.filter(isHistoryMessage).slice(-MAX_MESSAGES_PER_CONVERSATION)
    if (conv.title === '新对话') {
      const firstUser = messages.find((m) => m.role === 'user')
      if (firstUser) conv.title = firstUser.content.slice(0, 30)
    }
    this.writeAll(history)
  }

  deleteConversation(bookId: string, conversationId: string): void {
    const history = this.readAll()
    const conversations = history[bookId] || []
    history[bookId] = conversations.filter((c) => c.id !== conversationId)
    this.writeAll(history)
  }
}
