import { ipcMain } from 'electron'
import type { AiChatPayload, AiLlmSettings, BookData, ChapterOutlineGenerateRequest, ChapterOutlineRecord } from '../../src/global'
import type { LogService } from '../services/log-service'
import type { SettingsService } from '../services/settings-service'
import { getDataDir } from './fileHandlers'
import { mergeAiSettings, resolveEngine } from '../services/ai/ai-config'
import { JsonAiHistoryRepository } from '../services/ai/ai-history'
import { AiService } from '../services/ai/ai-service'
import { NmemBridge } from '../services/ai/nmem-bridge'
import { IngestService } from '../services/ai/ingest-service'
import { OutlineGenerator } from '../services/ai/outline-generator'
import { calculateMinimumSections, isShortChapter } from '../services/ai/outline-generator'
import { ChapterOutlineRepository } from '../services/ai/outline-repository'
import { outlineGenerationQueue } from '../services/ai/outline-queue'
import { normalizeBookData } from '../../src/utils/bookData'
import { hashSentences } from '../../src/utils/contentHash'
import { listModels } from '../services/ai/llm-caller'
import { resolveCanonicalOutlineInput } from '../services/ai/outline-input'

export function registerAiHandlers(settingsService: SettingsService, logService: LogService): void {
  const history = new JsonAiHistoryRepository(getDataDir)
  const nmem = new NmemBridge(() => mergeAiSettings(settingsService.get().ai).nmem)
  const ingest = new IngestService(nmem)
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
    try {
      // 整本一次上传（不再按章拆分，避免 MDM 重复堆源）
      const result = await ingest.ingestBook(book)
      logService.info(
        'AI',
        `知识库整本导入完成: ${book.title}，提交 ${result.ingested}，跳过 ${result.skipped}`
      )
      return { success: true, ...result }
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
    cache: false,
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
    const contentHash = hashSentences(input.sentences)
    const previous = getOutlineRepository().load(input.bookId, input.chapterKey, contentHash)
    // 用户点「重新生成」时 force=true，必须真正重跑；否则可直接返回缓存
    if (
      !force &&
      (previous?.status === 'generated' || previous?.status === 'short_chapter')
    ) {
      return { success: true, record: previous }
    }
    try {
      const engineConfig = resolveEngine(mergeAiSettings(settingsService.get().ai), 'outline')
      logService.info('AI', `大纲引擎: ${engineConfig.baseUrl} | 模型: ${engineConfig.model}`)
      const outline = await outlineGenerationQueue.enqueue(() => outlineGen.generateChapter(
        input.bookId,
        input.sentences,
        [{ title: input.chapterTitle, startIndex: 0, sentenceCount: input.sentences.length }],
        0
      ))
      if (outline.error) {
        logService.error('AI', `大纲生成失败: ${outline.error}`)
        return { success: false, error: outline.error }
      }
      const record: ChapterOutlineRecord = {
        bookId: input.bookId,
        chapterKey: input.chapterKey,
        chapterIndex: input.chapterIndex,
        contentHash,
        status: isShortChapter(input.sentences.length) ? 'short_chapter' : 'generated',
        minimumSections: calculateMinimumSections(input.sentences.length),
        sections: outline.sections.map((section, index) => ({
          id: `${request.chapterKey}-${contentHash}-${index}`,
          originalTitle: section.title,
          point: section.point,
          startOffset: section.startOffset
        })),
        generatedAt: new Date().toISOString()
      }
      getOutlineRepository().save(record)
      logService.info('AI', `大纲生成完成: ${request.bookId} 第${request.chapterIndex + 1}章，${record.sections.length}节`)
      return { success: true, record }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `大纲生成失败: ${message}`)
      return { success: false, error: message }
    }
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
