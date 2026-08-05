import type { AiNmemSettings, AiNmemStatus } from '../../../src/global'

export type NmemErrorCode =
  | 'nmem_offline'
  | 'timeout'
  | 'invalid_response'
  | 'ingest_failed'
  | 'cancelled'

export class NmemBridgeError extends Error {
  constructor(
    public readonly code: NmemErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'NmemBridgeError'
  }
}

export interface NmemMemory {
  id: string
  content: string
  source: string
  score: number
}

export interface NmemIngestInput {
  content: string
  name: string
  sourceType: string
}

export interface NmemIngestResult {
  sourceId: string
  isDuplicate: boolean
}

export type NmemSourceStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface NmemSourceInfo {
  id: string
  name: string
  status: NmemSourceStatus
  error?: string
  /** nmem 源版本号（同一逻辑文件重传后会升到 v2/v3…） */
  version?: number
}

/** 列表分页：nmem 默认只返回 50 条，必须用 offset/limit 翻页拉全量 */
const LIST_SOURCES_PAGE_SIZE = 100
/** 安全上限：防止异常 total 导致死循环（100 * 500 = 5 万条） */
const LIST_SOURCES_MAX_PAGES = 500

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function sourceName(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const candidate = value as {
      name?: unknown
      source?: unknown
      original_name?: unknown
      id?: unknown
    }
    // nmem 实际字段是 original_name；兼容 name / source
    if (typeof candidate.original_name === 'string' && candidate.original_name) {
      return candidate.original_name
    }
    if (typeof candidate.name === 'string' && candidate.name) return candidate.name
    if (typeof candidate.source === 'string' && candidate.source) return candidate.source
    // 部分响应只给 id，交给后续 resolve
    if (typeof candidate.id === 'string' || typeof candidate.id === 'number') {
      return `library:${String(candidate.id)}`
    }
  }
  return ''
}

/**
 * 从 nmem 检索返回的 source 字段提取 sourceId。
 * 新版 nmem 常见：`library:src_64460b18`；也兼容裸 `src_xxx`。
 */
export function extractNmemSourceId(source: string): string | null {
  const text = source.trim()
  if (!text) return null
  const library = /^library:(src_[a-zA-Z0-9_-]+)$/i.exec(text)
  if (library) return library[1]
  if (/^src_[a-zA-Z0-9_-]+$/i.test(text)) return text
  // 对象序列化残留等：…src_xxx…
  const embedded = /\b(src_[a-zA-Z0-9_-]+)\b/i.exec(text)
  if (embedded && !text.includes('[bookId=')) return embedded[1]
  return null
}

/** 去掉 nmem original_name 常见的 `.md` 等扩展名，便于 parseSourceMetadata */
export function normalizeNmemSourceLabel(name: string): string {
  return name.trim().replace(/\.(md|txt|epub|pdf|html?)$/i, '').trim()
}

/**
 * 把 nmem 原始 source JSON 归一成内部 NmemSourceInfo。
 * - 名称：original_name 优先（听伴写入的 `书名 [bookId=…]`）
 * - 状态：兼容 status 与 lifecycle_state（indexed → ready）
 * - version：nmem 的 v1/v2/v3 版本号
 */
export function parseNmemSourceInfo(value: unknown): NmemSourceInfo | null {
  if (!value || typeof value !== 'object') return null
  const item = value as {
    id?: unknown
    name?: unknown
    original_name?: unknown
    status?: unknown
    lifecycle_state?: unknown
    error?: unknown
    error_message?: unknown
    version?: unknown
  }
  if (typeof item.id !== 'string' && typeof item.id !== 'number') return null

  const name =
    (typeof item.original_name === 'string' && item.original_name) ||
    (typeof item.name === 'string' && item.name) ||
    ''

  const status = mapSourceStatus(item.status, item.lifecycle_state)
  const error =
    (typeof item.error === 'string' && item.error) ||
    (typeof item.error_message === 'string' && item.error_message) ||
    undefined
  const version =
    typeof item.version === 'number' && Number.isFinite(item.version)
      ? item.version
      : typeof item.version === 'string' && /^\d+$/.test(item.version)
        ? Number(item.version)
        : undefined

  return {
    id: String(item.id),
    name,
    status,
    ...(error ? { error } : {}),
    ...(version !== undefined ? { version } : {})
  }
}

function mapSourceStatus(status: unknown, lifecycleState: unknown): NmemSourceStatus {
  const raw =
    (typeof status === 'string' && status) ||
    (typeof lifecycleState === 'string' && lifecycleState) ||
    ''
  const s = raw.toLowerCase()
  if (s === 'ready' || s === 'indexed' || s === 'searchable') return 'ready'
  if (s === 'processing' || s === 'indexing' || s === 'pending_index') return 'processing'
  if (s === 'failed' || s === 'error') return 'failed'
  if (s === 'pending') return 'pending'
  // 未知值：有 lifecycle 字样时偏保守当 processing，否则 pending
  if (s.includes('index') || s.includes('process')) return 'processing'
  return 'pending'
}

export class NmemBridge {
  private cachedStatus: AiNmemStatus | null = null
  private cachedBaseUrl = ''

  constructor(private readonly getSettings: () => AiNmemSettings) {}

  private markOnline(baseUrl: string): AiNmemStatus {
    this.cachedBaseUrl = baseUrl
    const status: AiNmemStatus = { status: 'online', checkedAt: new Date().toISOString() }
    this.cachedStatus = status
    return status
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal,
    failureCode: NmemErrorCode = 'nmem_offline'
  ): Promise<Response> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (externalSignal?.aborted) controller.abort()
    else externalSignal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))

    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (!response.ok) {
        const details = (await response.text()).slice(0, 300)
        throw new NmemBridgeError(
          failureCode,
          `知识库请求失败（HTTP ${response.status}）：${details}`
        )
      }
      return response
    } catch (error) {
      if (error instanceof NmemBridgeError) throw error
      if (externalSignal?.aborted) throw new NmemBridgeError('cancelled', '知识库请求已取消', error)
      if (controller.signal.aborted) throw new NmemBridgeError('timeout', '知识库请求超时', error)
      throw new NmemBridgeError('nmem_offline', '无法连接知识库服务', error)
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', onAbort)
    }
  }

  async checkHealth(options: { force?: boolean } = {}): Promise<AiNmemStatus> {
    const settings = this.getSettings()
    const now = Date.now()
    if (settings.baseUrl !== this.cachedBaseUrl) {
      this.cachedStatus = null
      this.cachedBaseUrl = settings.baseUrl
    }
    if (
      !options.force &&
      this.cachedStatus &&
      now - Date.parse(this.cachedStatus.checkedAt) < settings.statusCacheMs
    ) {
      return this.cachedStatus
    }

    try {
      await this.request(
        endpoint(settings.baseUrl, '/health'),
        { method: 'GET' },
        settings.healthTimeoutMs
      )
      return this.markOnline(settings.baseUrl)
    } catch (error) {
      this.cachedStatus = {
        status: 'offline',
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }
      throw error
    }
  }

  /** sourceId → original_name（含 [bookId=…]）；空串表示已查过但无名称 */
  private sourceLabelCache = new Map<string, string>()

  async search(query: string, limit: number, signal?: AbortSignal): Promise<NmemMemory[]> {
    const settings = this.getSettings()
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const response = await this.request(
      endpoint(settings.baseUrl, `/memories/search?${params.toString()}`),
      { method: 'GET' },
      settings.searchTimeoutMs,
      signal
    )
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new NmemBridgeError('invalid_response', '知识库返回了无法解析的检索结果', error)
    }
    const memories = (payload as { memories?: unknown })?.memories
    if (!Array.isArray(memories)) {
      throw new NmemBridgeError('invalid_response', '知识库检索结果缺少 memories 数组')
    }
    const result = memories.flatMap((value): NmemMemory[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as { id?: unknown; content?: unknown; source?: unknown; score?: unknown }
      if ((typeof item.id !== 'string' && typeof item.id !== 'number') || typeof item.content !== 'string') {
        return []
      }
      return [{
        id: String(item.id),
        content: item.content,
        source: sourceName(item.source),
        score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0
      }]
    })
    this.markOnline(settings.baseUrl)
    // 新版 nmem 常返回 source=`library:src_xxx`，不含 [bookId=]，会导致 buildSourceRefs 全量丢弃。
    // 用 /sources/{id} 解析为 original_name（书名 [bookId=…]）。
    return this.resolveMemorySourceLabels(result, signal)
  }

  /**
   * 把 `library:src_xxx` 等解析成可被 parseSourceMetadata 识别的标签。
   * 已含 [bookId=] 的直接规范化扩展名后返回。
   */
  async resolveMemorySourceLabels(
    memories: NmemMemory[],
    signal?: AbortSignal
  ): Promise<NmemMemory[]> {
    if (memories.length === 0) return memories

    const needIds = new Set<string>()
    for (const memory of memories) {
      if (memory.source.includes('[bookId=')) continue
      const sourceId = extractNmemSourceId(memory.source)
      if (sourceId && !this.sourceLabelCache.has(sourceId)) needIds.add(sourceId)
    }

    if (needIds.size > 0) {
      await Promise.all(
        [...needIds].map(async (sourceId) => {
          try {
            const info = await this.getSource(sourceId, signal)
            const label = info?.name?.trim() || ''
            this.sourceLabelCache.set(sourceId, label)
          } catch {
            // 单源失败不拖垮整批；记空串避免同一请求内反复打
            this.sourceLabelCache.set(sourceId, '')
          }
        })
      )
    }

    return memories.map((memory) => {
      if (memory.source.includes('[bookId=')) {
        return { ...memory, source: normalizeNmemSourceLabel(memory.source) }
      }
      const sourceId = extractNmemSourceId(memory.source)
      if (!sourceId) return memory
      const label = this.sourceLabelCache.get(sourceId)
      if (label) {
        return { ...memory, source: normalizeNmemSourceLabel(label) }
      }
      return memory
    })
  }

  async ingestContent(input: NmemIngestInput, signal?: AbortSignal): Promise<NmemIngestResult> {
    const settings = this.getSettings()
    const response = await this.request(
      endpoint(settings.baseUrl, '/sources/ingest/content'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: input.content,
          name: input.name,
          source_type: input.sourceType
        })
      },
      settings.ingestTimeoutMs,
      signal,
      'ingest_failed'
    )
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new NmemBridgeError('invalid_response', '知识库返回了无法解析的导入结果', error)
    }
    const result = payload as { source_id?: unknown; is_duplicate?: unknown }
    if (typeof result.source_id !== 'string' && typeof result.source_id !== 'number') {
      throw new NmemBridgeError('invalid_response', '知识库导入结果缺少 source_id')
    }
    return {
      sourceId: String(result.source_id),
      isDuplicate: result.is_duplicate === true
    }
  }

  /**
   * 列出全部 source（自动 offset/limit 翻页）。
   * nmem 默认只返回 50 条且 total 可达数百；不去重按钮曾因此永远「无重复源」。
   */
  async listSources(signal?: AbortSignal): Promise<NmemSourceInfo[]> {
    const settings = this.getSettings()
    const byId = new Map<string, NmemSourceInfo>()
    let offset = 0
    let total: number | undefined

    for (let page = 0; page < LIST_SOURCES_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(LIST_SOURCES_PAGE_SIZE)
      })
      const response = await this.request(
        endpoint(settings.baseUrl, `/sources?${params.toString()}`),
        { method: 'GET' },
        settings.searchTimeoutMs,
        signal
      )
      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        throw new NmemBridgeError('invalid_response', '知识库返回了无法解析的来源列表', error)
      }
      const body = payload as { sources?: unknown; total?: unknown }
      const raw = body.sources
      if (!Array.isArray(raw)) {
        throw new NmemBridgeError('invalid_response', '知识库来源列表缺少 sources 数组')
      }
      if (typeof body.total === 'number' && Number.isFinite(body.total)) {
        total = body.total
      }

      const sizeBefore = byId.size
      let pageCount = 0
      for (const value of raw) {
        const info = parseNmemSourceInfo(value)
        if (!info) continue
        byId.set(info.id, info)
        pageCount++
      }

      // 空页 → 结束
      if (pageCount === 0) break
      // 本页没有新 id（API 忽略 offset 反复返回同一页）→ 结束，避免死循环
      if (byId.size === sizeBefore) break

      offset += pageCount
      if (total !== undefined && byId.size >= total) break
      if (pageCount < LIST_SOURCES_PAGE_SIZE) break
    }

    this.markOnline(settings.baseUrl)
    return [...byId.values()]
  }

  async getSource(sourceId: string, signal?: AbortSignal): Promise<NmemSourceInfo | null> {
    const settings = this.getSettings()
    try {
      const response = await this.request(
        endpoint(settings.baseUrl, `/sources/${encodeURIComponent(sourceId)}`),
        { method: 'GET' },
        settings.searchTimeoutMs,
        signal
      )
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return null
      }
      const info = parseNmemSourceInfo(payload)
      if (!info) return null
      this.markOnline(settings.baseUrl)
      return info
    } catch (error) {
      if (error instanceof NmemBridgeError && error.code === 'nmem_offline') throw error
      return null
    }
  }

  /**
   * 删除一个 source：重传前清理旧源 / 去重时删除多余副本。
   * 失败（含 404 已不存在）返回 false，不抛错，避免阻塞主流程。
   */
  async deleteSource(sourceId: string, signal?: AbortSignal): Promise<boolean> {
    if (!sourceId) return false
    const settings = this.getSettings()
    try {
      const response = await this.request(
        endpoint(settings.baseUrl, `/sources/${encodeURIComponent(sourceId)}`),
        { method: 'DELETE' },
        settings.searchTimeoutMs,
        signal
      )
      return response.ok
    } catch {
      return false
    }
  }
}
