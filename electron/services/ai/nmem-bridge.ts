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
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function sourceName(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const candidate = value as { name?: unknown; source?: unknown }
    if (typeof candidate.name === 'string') return candidate.name
    if (typeof candidate.source === 'string') return candidate.source
  }
  return ''
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
    return result
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

  async listSources(signal?: AbortSignal): Promise<NmemSourceInfo[]> {
    const settings = this.getSettings()
    const response = await this.request(
      endpoint(settings.baseUrl, '/sources'),
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
    const raw = (payload as { sources?: unknown })?.sources
    if (!Array.isArray(raw)) {
      throw new NmemBridgeError('invalid_response', '知识库来源列表缺少 sources 数组')
    }
    this.markOnline(settings.baseUrl)
    return raw.flatMap((value): NmemSourceInfo[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as { id?: unknown; name?: unknown; status?: unknown; error?: unknown }
      if (typeof item.id !== 'string' && typeof item.id !== 'number') return []
      const status = typeof item.status === 'string' ? item.status : 'pending'
      return [{
        id: String(item.id),
        name: typeof item.name === 'string' ? item.name : '',
        status: (['pending', 'processing', 'ready', 'failed'].includes(status) ? status : 'pending') as NmemSourceStatus,
        error: typeof item.error === 'string' ? item.error : undefined
      }]
    })
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
      const item = payload as { id?: unknown; name?: unknown; status?: unknown; error?: unknown }
      if (typeof item.id !== 'string' && typeof item.id !== 'number') return null
      const status = typeof item.status === 'string' ? item.status : 'pending'
      this.markOnline(settings.baseUrl)
      return {
        id: String(item.id),
        name: typeof item.name === 'string' ? item.name : '',
        status: (['pending', 'processing', 'ready', 'failed'].includes(status) ? status : 'pending') as NmemSourceStatus,
        error: typeof item.error === 'string' ? item.error : undefined
      }
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
