import { ipcMain } from 'electron'
import type { AiChatPayload, AiLlmSettings, BookData, ChapterOutlineGenerateRequest, ChapterOutlineRecord } from '../../src/global'
import type { LogService } from '../services/log-service'
import type { SettingsService } from '../services/settings-service'
import { getDataDir, getIngestScheduler } from './fileHandlers'
import { mergeAiSettings, resolveEngine } from '../services/ai/ai-config'
import { JsonAiHistoryRepository } from '../services/ai/ai-history'
import { AiService } from '../services/ai/ai-service'
import { NmemBridge } from '../services/ai/nmem-bridge'
import { OutlineGenerator } from '../services/ai/outline-generator'
import { ChapterOutlineRepository } from '../services/ai/outline-repository'
import { normalizeBookData } from '../../src/utils/bookData'
import { hashSentences } from '../../src/utils/contentHash'
import { listModels } from '../services/ai/llm-caller'
import { resolveCanonicalOutlineInput } from '../services/ai/outline-input'
import {
  generateChapterOutlineRecord,
  runOutlineBatch,
  cancelOutlineBatch,
  isOutlineBatchRunning
} from '../services/ai/outline-batch'
import { LibraryStorage } from '../services/library-storage'

export function registerAiHandlers(settingsService: SettingsService, logService: LogService): void {
  const history = new JsonAiHistoryRepository(getDataDir)
  const nmem = new NmemBridge(() => mergeAiSettings(settingsService.get().ai).nmem)
  const service = new AiService({
    getSettings: () => mergeAiSettings(settingsService.get().ai),
    history,
    retrieve: (query, limit, signal) => nmem.search(query, limit, signal),
    onRetrievalError: (error) => {
      logService.warn('AI', `知识库检索降级为普通对话: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ipcMain.handle('ai:chat', (event, requestId: string, payload: AiChatPayload) => {
    if (!requestId || !payload?.bookId || !Array.isArray(payload.messages)) {
      return { success: false, error: 'AI 请求参数不完整' }
    }
    void service.chat(requestId, payload, event.sender)
    return { success: true }
  })

  ipcMain.handle('ai:cancel', (_event, requestId: string) => ({
    success: service.cancel(requestId)
  }))

  ipcMain.handle('ai:history:get', (_event, bookId: string) => history.load(bookId))

  // === 多会话管理 ===
  ipcMain.handle('ai:conv:list', (_event, bookId: string) => history.listConversations(bookId))
  ipcMain.handle('ai:conv:load', (_event, bookId: string, convId: string) => history.loadConversation(bookId, convId))
  ipcMain.handle('ai:conv:create', (_event, bookId: string, title?: string) => history.createConversation(bookId, title))
  ipcMain.handle('ai:conv:save', (_event, bookId: string, convId: string, messages: unknown[]) => {
    history.saveConversation(bookId, convId, messages as never[])
    return { success: true }
  })
  ipcMain.handle('ai:conv:delete', (_event, bookId: string, convId: string) => {
    history.deleteConversation(bookId, convId)
    return { success: true }
  })
  ipcMain.handle('ai:conv:rename', (_event, bookId: string, convId: string, title: string) => {
    const ok = history.renameConversation(bookId, convId, title)
    return ok ? { success: true } : { success: false, error: '重命名失败' }
  })
  ipcMain.handle('ai:conv:set-active', (_event, bookId: string, convId: string) => {
    const ok = history.setActiveConversation(bookId, convId)
    return { success: ok }
  })

  ipcMain.handle('ai:nmem:status', async (_event, force = false) => {
    try {
      return await nmem.checkHealth({ force })
    } catch (error) {
      return {
        status: 'offline' as const,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /** 单本书是否已同步到知识库（本地 ingest-status，不打网络） */
  ipcMain.handle('ai:nmem:book-status', async (_event, bookId: string) => {
    const scheduler = getIngestScheduler()
    if (!scheduler || !bookId) {
      return { status: 'none' as const }
    }
    try {
      return await scheduler.getBookIngestStatus(bookId)
    } catch (error) {
      return {
        status: 'none' as const,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const fetchModels = async (config: AiLlmSettings) => {
    try {
      const models = await listModels(config)
      return { success: true, models }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  ipcMain.handle('ai:models:list', (_event, config: AiLlmSettings) => fetchModels(config))
  ipcMain.handle('ai:model:test', (_event, config: AiLlmSettings) => fetchModels(config))

  ipcMain.handle('ai:nmem:ingest', async (_event, value: BookData) => {
    const book = normalizeBookData(value)
    if (!book) return { success: false, error: '书籍数据无效' }
    // 统一走共享 IngestScheduler：享有 per-book in-flight 锁 + contentHash 去重 + 状态写入，
    // 不再裸调 IngestService.ingestBook（那会绕过状态文件导致重复堆源）
    const scheduler = getIngestScheduler()
    if (!scheduler) {
      return { success: false, error: '知识库调度器未就绪，请稍后重试' }
    }
    try {
      const ok = await scheduler.tryIngest(book)
      logService.info(
        'AI',
        `知识库整本导入: 《${book.title}》${ok ? '完成' : '失败（将在连接后自动重试）'}`
      )
      return { success: ok, ingested: ok ? 1 : 0, skipped: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `知识库导入失败: ${message}`)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('ai:history:clear', (_event, bookId?: string) => {
    try {
      history.clear(bookId)
      logService.info('AI', bookId ? `清空书籍对话历史: ${bookId}` : '清空全部 AI 对话历史')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `清空对话历史失败: ${message}`)
      return { success: false, error: message }
    }
  })

  // === AI 大纲生成 ===
  const outlineGen = new OutlineGenerator({
    getSettings: () => resolveEngine(mergeAiSettings(settingsService.get().ai), 'outline'),
    getOutlineSystemPrompt: () => mergeAiSettings(settingsService.get().ai).chat.outlineSystemPrompt,
    getDataDir,
    onProgress: (chapterIndex, total) => {
      logService.info('AI', `大纲生成进度: ${chapterIndex + 1}/${total}`)
    },
    log: (level, message) => {
      if (level === 'error') logService.error('AI', message)
      else logService.info('AI', message)
    }
  })

  const getOutlineRepository = () => new ChapterOutlineRepository(getDataDir())
  const normalizeOutlineRequest = (value: unknown): Pick<ChapterOutlineGenerateRequest, 'bookId' | 'chapterIndex' | 'chapterKey'> | null => {
    if (!value || typeof value !== 'object') return null
    const request = value as Partial<ChapterOutlineGenerateRequest>
    if (
      typeof request.bookId !== 'string' ||
      typeof request.chapterKey !== 'string' ||
      typeof request.chapterIndex !== 'number' ||
      !Number.isInteger(request.chapterIndex) ||
      request.chapterIndex < 0
    ) return null
    return request as Pick<ChapterOutlineGenerateRequest, 'bookId' | 'chapterIndex' | 'chapterKey'>
  }

  ipcMain.handle('ai:outline:get', (_event, rawRequest: unknown) => {
    const request = normalizeOutlineRequest(rawRequest)
    if (!request) return { success: false, error: '大纲请求参数无效' }
    const resolved = resolveCanonicalOutlineInput(getDataDir(), request)
    if (!resolved.input) return { success: false, error: resolved.error }
    const contentHash = hashSentences(resolved.input.sentences)
    return { success: true, record: getOutlineRepository().load(request.bookId, request.chapterKey, contentHash) || undefined }
  })

  ipcMain.handle('ai:outline:update', (_event, record: ChapterOutlineRecord) => {
    if (!record || typeof record.bookId !== 'string' || typeof record.chapterKey !== 'string') {
      return { success: false, error: '大纲记录无效' }
    }
    try {
      const resolved = resolveCanonicalOutlineInput(getDataDir(), {
        bookId: record.bookId,
        chapterIndex: record.chapterIndex,
        chapterKey: record.chapterKey
      })
      if (!resolved.input) return { success: false, error: resolved.error }
      if (hashSentences(resolved.input.sentences) !== record.contentHash) {
        return { success: false, error: 'outline content is stale' }
      }
      getOutlineRepository().save(record)
      return { success: true, record }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('ai:outline:generate', async (_event, rawRequest: unknown) => {
    const request = normalizeOutlineRequest(rawRequest)
    if (!request) return { success: false, error: '大纲请求参数无效' }
    const force =
      Boolean(rawRequest && typeof rawRequest === 'object' && (rawRequest as { force?: unknown }).force)
    const resolved = resolveCanonicalOutlineInput(getDataDir(), request)
    if (!resolved.input) return { success: false, error: resolved.error }
    const input = resolved.input
    try {
      const result = await generateChapterOutlineRecord(getDataDir, outlineGen, input, force)
      if (result.status === 'failed') {
        logService.error('AI', `大纲生成失败: ${result.error ?? 'unknown'}`)
        return { success: false, error: result.error }
      }
      if (result.record) {
        logService.info('AI', `大纲生成完成: ${input.bookId} 第${input.chapterIndex + 1}章，${result.record.sections.length}节`)
      }
      return { success: true, record: result.record }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `大纲生成失败: ${message}`)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('ai:outline:regenerate-all', (event, rawPayload?: unknown) => {
    if (isOutlineBatchRunning()) {
      return { accepted: false, reason: 'already-running' }
    }
    const force = Boolean(rawPayload && typeof rawPayload === 'object' && (rawPayload as { force?: unknown }).force)
    const storage = new LibraryStorage(getDataDir)
    const bookTotal = storage.loadAll().filter((b) => Array.isArray(b.chapters) && b.chapters.length > 0).length

    void runOutlineBatch({
      getDataDir,
      generator: outlineGen,
      force,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:outline:batch-progress', progress)
        }
      }
    })

    return { accepted: true, bookTotal }
  })

  ipcMain.handle('ai:outline:cancel-batch', () => {
    if (isOutlineBatchRunning()) {
      cancelOutlineBatch()
      return { cancelled: true }
    }
    return { cancelled: false }
  })

  ipcMain.handle('ai:outline:legacy-generate', async (_event, book: BookData, chapterIndex: number) => {
    const normalized = normalizeBookData(book)
    if (!normalized) return { success: false, error: '书籍数据无效' }
    try {
      const chapters = normalized.chapters.length
        ? normalized.chapters
        : [{ title: normalized.title || '正文', startIndex: 0, sentenceCount: normalized.sentences.length }]
      const idx = typeof chapterIndex === 'number' ? chapterIndex : 0
      const outline = await outlineGen.generateChapter(normalized.id, normalized.sentences, chapters, idx)
      logService.info('AI', `大纲生成完成: ${normalized.title} 第${idx + 1}章，${outline.sections.length} 节`)
      return { success: true, outline }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `大纲生成失败: ${message}`)
      return { success: false, error: message }
    }
  })
}
