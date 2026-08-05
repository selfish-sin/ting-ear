import { ipcMain } from 'electron'
import type { AiChatPayload, AiLlmSettings, AiQuestionCategory, BookData, ChapterOutlineGenerateRequest, ChapterOutlineRecord } from '../../src/global'
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
import { ingestBookLocal } from '../services/ai/local-ingest'
import { hasVectors, deleteVectors, searchBookVectors, VectorCompatError } from '../services/ai/vector-store'
import { callEmbedding } from '../services/ai/embedding-caller'
import { McpHost } from '../services/ai/mcp-host'
import type { AiMcpServerConfig } from '../../src/global'

export function registerAiHandlers(settingsService: SettingsService, logService: LogService): void {
  const history = new JsonAiHistoryRepository(getDataDir)
  const nmem = new NmemBridge(() => mergeAiSettings(settingsService.get().ai).nmem)
  const mcpHost = new McpHost(
    () => mergeAiSettings(settingsService.get().ai).mcp?.servers || []
  )

  /** 双源检索：nmem + 本地向量并行，RRF 倒数排名融合 + 前100字去重 */
  const combinedRetrieve = async (
    query: string,
    limit: number,
    signal: AbortSignal,
    options: { bookId?: string; chapterIndex?: number; category?: AiQuestionCategory } = {}
  ) => {
    const aiSettings = mergeAiSettings(settingsService.get().ai)
    const { bookId, chapterIndex, category } = options
    const nmemPromise = aiSettings.nmem.enabled
      ? nmem.search(query, limit, signal).catch(() => [])
      : Promise.resolve([])

    let vecPromise: Promise<Array<{ id: string; content: string; source: string; score: number }>> =
      Promise.resolve([])
    if (bookId) {
      vecPromise = (async () => {
        if (!hasVectors(getDataDir, bookId)) return []
        const embedding = mergeAiSettings(settingsService.get().ai).embedding
        if (!embedding.baseUrl || !embedding.model) return []
        const { vectors } = await callEmbedding([query], embedding, signal)
        if (!vectors.length) return []
        // chapter 类问题：只在该章 chunk 上算 cosine，避免 topK 槽位被别章占满
        const chapterFilter = category === 'chapter' && chapterIndex !== undefined ? chapterIndex : undefined
        const results = await searchBookVectors(getDataDir, bookId, vectors[0], limit, 12000, {
          chapterFilter,
          expectedModel: embedding.model
        }).catch((error) => {
          if (error instanceof VectorCompatError) {
            logService.warn('AI', `本地向量检索跳过：${error.message}`)
          }
          return []
        })
        return results.map((r, i) => ({
          id: `vec-${i}`,
          content: r.text,
          // 关键修复：旧格式「本地向量·第X章」不匹配 parseSourceMetadata，
          // 导致本地结果被 buildSourceRefs 全量丢弃。改回标准 [bookId=..][ch=..] 章名。
          source: `[bookId=${bookId}][ch=${r.chapter}] ${r.chapterTitle}`,
          score: r.score
        }))
      })().catch(() => [])
    }

    const [nmemResults, vecResults] = await Promise.all([nmemPromise, vecPromise])

    // RRF（Reciprocal Rank Fusion）：两源分数尺度不可比（nmem Rust 侧 vs 本地 cosine 0..1），
    // 不再比绝对分数，只比各自排名，融合后对尺度差异天然鲁棒。
    // 同一内容若被两源都命中，分数叠加（共识加权）。
    const RRF_K = 60
    const fused = new Map<string, { id: string; content: string; source: string; score: number }>()
    const addRanks = (items: Array<{ id: string; content: string; source: string; score: number }>) => {
      const sorted = [...items].sort((a, b) => b.score - a.score)
      sorted.forEach((item, rank) => {
        const key = item.content.slice(0, 100)
        const contribution = 1 / (RRF_K + rank + 1)
        const existing = fused.get(key)
        if (existing) existing.score += contribution
        else fused.set(key, { ...item, score: contribution })
      })
    }
    addRanks(nmemResults)
    addRanks(vecResults)

    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  }

  const service = new AiService({
    getSettings: () => mergeAiSettings(settingsService.get().ai),
    history,
    retrieve: (query, limit, signal, bookId) => combinedRetrieve(query, limit, signal, bookId),
    mcpHost,
    onRetrievalError: (error) => {
      logService.warn('AI', `知识库检索降级为普通对话: ${error instanceof Error ? error.message : String(error)}`)
    },
    onWebSearch: (info) => {
      logService.info(
        'AI',
        `联网搜索: provider=${info.provider} 结果=${info.resultCount} 耗时=${info.durationMs}ms`,
        { query: info.query.slice(0, 200), at: info.at, provider: info.provider, resultCount: info.resultCount }
      )
    },
    onToolCall: (info) => {
      logService.info(
        'AI',
        `工具调用: ${info.name} ${info.ok ? 'ok' : 'fail'} ${info.durationMs}ms`
      )
    }
  })

  const localIngestRunning = new Map<string, AbortController>()

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
  /** 打开书/面板：恢复上次会话，没有才创建 */
  ipcMain.handle('ai:conv:ensure', (_event, bookId: string) => history.ensureActiveConversation(bookId))

  // === MCP 宿主 ===
  ipcMain.handle('ai:mcp:list-tools', async () => {
    const settings = mergeAiSettings(settingsService.get().ai)
    if (!settings.mcp?.enabled) {
      return { success: true, tools: [], message: 'MCP 总开关已关闭' }
    }
    const enabledServers = (settings.mcp?.servers || []).filter((s) => s.enabled)
    if (enabledServers.length === 0) {
      return {
        success: true,
        tools: [],
        message: '未启用任何 MCP 服务：请在下方打开至少一个服务的「启用」开关'
      }
    }
    try {
      const tools = await mcpHost.refreshTools()
      const errors = mcpHost.getLastRefreshErrors()
      if (errors.length) {
        logService.warn('AI', `MCP 工具刷新部分失败: ${errors.join('；')}`)
      }
      let message: string | undefined
      if (tools.length === 0 && errors.length > 0) {
        message = errors.join('；')
      } else if (tools.length === 0) {
        message = '已启用服务但未列出工具（检查 command/URL 后点「测试连通」）'
      } else if (errors.length > 0) {
        message = `已加载 ${tools.length} 个工具；部分失败：${errors.join('；')}`
      }
      return {
        success: true,
        tools: tools.map((t) => ({
          exposedName: t.exposedName,
          name: t.name,
          serverId: t.serverId,
          serverName: t.serverName,
          description: t.description || ''
        })),
        message,
        errors
      }
    } catch (error) {
      return {
        success: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('ai:mcp:probe', async (_event, server: AiMcpServerConfig) => {
    try {
      const result = await mcpHost.probe(server)
      return { success: result.ok, ...result }
    } catch (error) {
      return {
        success: false,
        ok: false,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
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

  ipcMain.handle('ai:nmem:ingest', async (event, value: BookData) => {
    const book = normalizeBookData(value)
    if (!book) return { success: false, error: '书籍数据无效' }

    // 本地向量化已解耦：只由 AI 助手的专用 KnowledgeBaseButton（ai:vec:ingest）发起。
    // 此处不再自动连带 ingestBookLocal——否则未点向量化按钮也会出现向量化进度
    // （KnowledgeBaseButton 会因 progress 事件假显 building），无法辨识是否真正向量化过。

    // nmem 同步（主路径）
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
        if (result.cache === 'hit' || result.status === 'skipped') {
          logService.info(
            'AI',
            `大纲缓存命中: ${input.bookId} 第${input.chapterIndex + 1}章，${result.record.sections.length}节 schema=${result.record.schemaVersion ?? 1}`
          )
        } else {
          logService.info(
            'AI',
            `大纲生成完成: ${input.bookId} 第${input.chapterIndex + 1}章，${result.record.sections.length}节 cache=${result.cache ?? 'write'}`
          )
        }
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

  // === 本地向量知识库 ===

  ipcMain.handle('ai:vec:status', (_event, bookId: string) => {
    return { exists: hasVectors(getDataDir, bookId), running: localIngestRunning.has(bookId) }
  })

  ipcMain.handle('ai:vec:ingest', async (event, value: BookData) => {
    const book = normalizeBookData(value)
    if (!book) return { success: false, error: '书籍数据无效' }
    if (localIngestRunning.has(book.id)) return { success: false, error: '该书正在建立知识库' }

    const embedding = mergeAiSettings(settingsService.get().ai).embedding
    if (!embedding.baseUrl || !embedding.model) {
      return { success: false, error: '未配置嵌入模型，请前往设置 → 嵌入模型' }
    }

    localIngestRunning.set(book.id, new AbortController())
    const ac = localIngestRunning.get(book.id)!
    try {
      await ingestBookLocal(book, embedding, getDataDir, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:vec:progress', progress)
        }
      }, ac.signal)
      logService.info('AI', `本地知识库建立完成: 《${book.title}》`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `本地知识库建立失败: ${message}`)
      return { success: false, error: message }
    } finally {
      localIngestRunning.delete(book.id)
    }
  })

  ipcMain.handle('ai:vec:delete', async (_event, bookId: string) => {
    await deleteVectors(getDataDir, bookId)
    return { success: true }
  })

  ipcMain.handle('ai:vec:cancel', (event, bookId: string) => {
    const ac = localIngestRunning.get(bookId)
    if (!ac) return { success: false, error: '该书没有正在进行的本地索引' }
    ac.abort()
    localIngestRunning.delete(bookId)
    if (!event.sender.isDestroyed()) {
      event.sender.send('ai:vec:progress', {
        bookId, phase: 'error', current: 0, total: 0, totalChunks: 0, error: '已取消'
      })
    }
    logService.info('AI', `本地知识库索引已取消: ${bookId}`)
    return { success: true }
  })

  /** 本地向量检索（供 AI 对话内部调用，也可前端直接测试） */
  ipcMain.handle('ai:vec:search', async (_event, bookId: string, query: string, topK = 6, maxChars = 12000) => {
    if (!hasVectors(getDataDir, bookId)) return { results: [] }

    const embedding = mergeAiSettings(settingsService.get().ai).embedding
    if (!embedding.baseUrl || !embedding.model) return { results: [] }

    try {
      const { vectors } = await callEmbedding([query], embedding)
      if (!vectors.length) return { results: [] }
      const results = await searchBookVectors(getDataDir, bookId, vectors[0], topK, maxChars, {
        expectedModel: embedding.model
      })
      return { results }
    } catch (error) {
      if (error instanceof VectorCompatError) logService.warn('AI', error.message)
      return { results: [] }
    }
  })
}
