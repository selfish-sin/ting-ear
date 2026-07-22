import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import axios from 'axios'
import type { ITTSAdapter, TTSResult, TTSVoice, TTSEngineConfig } from './adapter'
import { QwenAdapter } from './qwen-adapter'
import { EdgeAdapter } from './edge-adapter'
import { HttpAdapter } from './http-adapter'
import { getProviderVoices, mergeVoices } from './provider-voices'

type DeployParseResult = {
  format: string
  apiUrl?: string
  apiKey?: string
  requestMethod?: 'POST' | 'GET'
  requestTemplate?: Record<string, unknown>
  responseAudioField?: string
  responseFormat?: 'base64' | 'url' | 'binary'
  voiceField?: string
  maxTextLength?: number
  voices?: TTSVoice[]
  name?: string
  type?: 'openai' | 'http'
}

export class EngineManager {
  private adapters: Map<string, ITTSAdapter> = new Map()
  private config: TTSEngineConfig[] = []
  private configPath: string
  private activeEngineId: string

  constructor() {
    const dir = join(app.getPath('userData'), '听伴')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.configPath = join(dir, 'engines.json')
    this.activeEngineId = 'edge' // Default to Edge TTS (free)
    this.loadConfig()
  }

  private loadConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8')
        this.config = JSON.parse(data)
      }
    } catch {
      // Use defaults
    }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch {
      // ignore
    }
  }

  /** Initialize built-in engines and custom engines from config */
  async init(apiKey?: string, endpoint?: string): Promise<void> {
    // Built-in engines
    this.adapters.set('edge', new EdgeAdapter())
    
    // Qwen with user-provided credentials
    const key = apiKey || process.env.QWEN_API_KEY || ''
    const ep = endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/generation'
    this.adapters.set('qwen', new QwenAdapter(key, ep))

    // Register adapters for custom engines from config
    for (const cfg of this.config) {
      this.registerCustomAdapter(cfg)
    }
  }

  /** Register (or replace) adapter for a custom engine config */
  private registerCustomAdapter(cfg: TTSEngineConfig): void {
    // Only create adapters for http/openai/local types
    if (['http', 'openai'].includes(cfg.type)) {
      this.adapters.set(cfg.id, new HttpAdapter(cfg))
      console.info(`[EngineManager] registered adapter for custom engine: ${cfg.id} (${cfg.type})`)
    }
  }

  /** Unregister adapter for a custom engine */
  private unregisterCustomAdapter(engineId: string): void {
    this.adapters.delete(engineId)
    console.info(`[EngineManager] unregistered adapter: ${engineId}`)
  }

  /** Update Qwen credentials dynamically */
  updateQwenCredentials(apiKey: string, endpoint: string): void {
    this.adapters.set('qwen', new QwenAdapter(apiKey, endpoint))
  }

  setActiveEngine(engineId: string): void {
    this.activeEngineId = engineId
  }

  getActiveEngineId(): string {
    return this.activeEngineId
  }

  private getAdapter(engineId?: string): ITTSAdapter | null {
    const id = engineId || this.activeEngineId
    return this.adapters.get(id) || null
  }

  /** Synthesize text using the active engine */
  async synthesize(
    text: string,
    voiceId: string,
    speed: number,
    volume: number,
    engineId?: string
  ): Promise<TTSResult & { engineUsed?: string }> {
    const targetEngine = engineId || this.activeEngineId
    console.info(`[TTS] synthesize: textLen=${text.length} voice=${voiceId} engine=${targetEngine}`)

    // Try active engine first
    const adapter = this.getAdapter(targetEngine)
    if (adapter) {
      console.info(`[TTS] trying engine: ${adapter.engineId}`)
      const result = await adapter.synthesize(text, voiceId, speed, volume)
      console.info(`[TTS] ${adapter.engineId} result: success=${result.success} error=${result.error || 'none'}`)
      if (result.success) {
        return { ...result, engineUsed: adapter.engineId }
      }
    } else {
      console.info(`[TTS] adapter not found for: ${targetEngine}`)
    }

    // 主引擎失败 → 直接返回，不回退到其他引擎
    // 千问是付费 API，只在用户手动选择时才用，不做自动回退
    // useTTS.ts 收到 failure 后自动降级到系统离线 TTS（免费）
    console.info(`[TTS] ${targetEngine} failed, no fallback`)
    return { success: false, error: `${targetEngine} 不可用`, fallback: true, engineUsed: 'system' }
  }

  /** Get voices for an engine */
  async fetchVoices(engineId?: string): Promise<TTSVoice[]> {
    const adapter = this.getAdapter(engineId)
    if (!adapter) return []
    return adapter.fetchVoices()
  }

  /** Test engine connection */
  async testConnection(engineId: string): Promise<boolean> {
    const adapter = this.getAdapter(engineId)
    if (!adapter) return false
    return adapter.testConnection()
  }

  /** Get all available engine configs (built-in + custom).
   *  voices 字段实时从对应 adapter 拉取，不再依赖文件底部重复声明的常量。 */
  async getEngineConfigs(): Promise<TTSEngineConfig[]> {
    const builtIn: TTSEngineConfig[] = [
      {
        id: 'edge',
        name: 'Edge TTS（微软免费）',
        type: 'edge',
        enabled: true,
        sortOrder: 0,
        voices: await this.fetchVoices('edge')
      },
      {
        id: 'qwen',
        name: '千问 TTS（阿里云收费）',
        type: 'qwen',
        enabled: true,
        sortOrder: 1,
        voices: await this.fetchVoices('qwen')
      },
      {
        id: 'system',
        name: '系统 TTS（离线免费）',
        type: 'system',
        enabled: true,
        sortOrder: 9,
        voices: [
          { id: 'system-zh-female', name: '中文女声', description: '系统默认 · 女声', gender: 'female', language: 'zh-CN' },
          { id: 'system-zh-male', name: '中文男声', description: '系统默认 · 男声', gender: 'male', language: 'zh-CN' },
          { id: 'system-auto', name: '系统自动', description: '自动选择最佳中文语音', gender: 'female', language: 'zh-CN' }
        ]
      }
    ]
    return [...builtIn, ...this.config.map((cfg) => this.withProviderVoices(cfg))]
  }

  /** Add a custom engine */
  addCustomEngine(config: TTSEngineConfig): void {
    this.registerCustomAdapter(config)
    this.config.push(config)
    this.saveConfig()
  }

  /** Update a custom engine */
  updateCustomEngine(config: TTSEngineConfig): void {
    const idx = this.config.findIndex((c) => c.id === config.id)
    if (idx >= 0) {
      this.config[idx] = config
      this.saveConfig()
      // Re-register adapter with updated config
      this.registerCustomAdapter(config)
    }
  }

  /** Delete a custom engine */
  deleteCustomEngine(engineId: string): void {
    this.config = this.config.filter((c) => c.id !== engineId)
    this.saveConfig()
    this.unregisterCustomAdapter(engineId)
  }

  /** Update engine sort order */
  updateSortOrder(orderedIds: string[]): void {
    for (const cfg of this.config) {
      const idx = orderedIds.indexOf(cfg.id)
      if (idx >= 0) cfg.sortOrder = idx
    }
    this.saveConfig()
  }

  /** Auto-discover voices for a custom engine and save to config */
  async discoverVoices(engineId: string): Promise<{ voices: TTSVoice[]; success: boolean }> {
    const adapter = this.adapters.get(engineId)
    if (!adapter) {
      // Try to create a temporary adapter for the config
      const cfg = this.config.find((c) => c.id === engineId)
      if (!cfg) return { voices: [], success: false }
      const tempAdapter = new HttpAdapter(cfg)
      const voices = await tempAdapter.discoverVoices()
      if (voices.length > 0) {
        // Persist discovered voices to config
        cfg.voices = voices
        this.saveConfig()
      }
      return { voices, success: voices.length > 0 }
    }

    if (adapter instanceof HttpAdapter) {
      const voices = await adapter.discoverVoices()
      if (voices.length > 0) {
        const cfg = this.config.find((c) => c.id === engineId)
        if (cfg) {
          cfg.voices = voices
          this.saveConfig()
        }
      }
      return { voices, success: voices.length > 0 }
    }

    // For built-in engines, just return their voices
    const voices = await adapter.fetchVoices()
    return { voices, success: voices.length > 0 }
  }

  /** Discover voices from an unsaved settings-form config without persisting it. */
  async discoverVoicesForConfig(input: Partial<TTSEngineConfig>): Promise<{ voices: TTSVoice[]; success: boolean; error?: string }> {
    try {
      if (!input.apiUrl) return { voices: [], success: false, error: '请先填写 API URL' }

      const config: TTSEngineConfig = {
        id: input.id || `probe-${Date.now()}`,
        name: input.name || this.guessNameFromUrl(input.apiUrl),
        type: input.type === 'openai' || input.type === 'http' ? input.type : 'http',
        enabled: true,
        apiUrl: input.apiUrl,
        apiKey: input.apiKey,
        requestMethod: input.requestMethod || 'POST',
        requestTemplate: input.requestTemplate,
        responseAudioField: input.responseAudioField,
        responseFormat: input.responseFormat,
        voices: input.voices
      }

      const adapter = new HttpAdapter(config)
      const voices = await adapter.fetchVoices()
      return { voices, success: voices.length > 0 }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[EngineManager] discoverVoicesForConfig failed:', msg)
      return { voices: [], success: false, error: msg }
    }
  }

  /** 导出引擎配置为可分享的 curl 命令（去除敏感信息） */
  exportEngine(engineId: string): string | null {
    const cfg = this.config.find((c) => c.id === engineId)
    if (!cfg) return null

    const apiKey = cfg.apiKey ? '填入你的 API Key' : 'your-key'
    const method = cfg.requestMethod || 'POST'
    const body = cfg.requestTemplate
      ? JSON.stringify(cfg.requestTemplate).replace(/'/g, `'\\''`)
      : '{"model":"tts-1","input":"Hello world","voice":"alloy"}'

    let curl = `curl ${method === 'GET' ? '' : '-X POST '}${cfg.apiUrl}`
    if (apiKey) curl += ` \\\n  -H "Authorization: Bearer ${apiKey}"`
    curl += ` \\\n  -H "Content-Type: application/json"`
    curl += ` \\\n  -d '${body}'`

    return curl
  }

  /** 一键部署：智能解析 curl / Python / JSON 输入，导入引擎配置 */
  importEngine(input: string): { success: boolean; error?: string; config?: TTSEngineConfig; detectedFormat?: string } {
    try {
      const parsed = this.parseDeployInput(input)
      if (!parsed) return { success: false, error: '无法识别输入格式。支持 curl 命令 / Python requests / JSON 配置' }
      if (!parsed.apiUrl) return { success: false, error: '未能提取到 API URL' }

      const apiUrl = parsed.apiUrl.trim()
      if (!this.isHttpUrl(apiUrl)) {
        return { success: false, error: 'API URL 必须是有效的 http(s) 地址' }
      }

      const name = parsed.name?.trim() || this.guessNameFromUrl(apiUrl)

      // 自动推断类型：URL 含 openai 或 /v1/audio/speech → openai
      const isOpenAI = apiUrl.includes('openai') || apiUrl.includes('/v1/audio/speech')
      const type: TTSEngineConfig['type'] = parsed.type || (isOpenAI ? 'openai' : 'http')

      const config: TTSEngineConfig = {
        id: `custom-deploy-${Date.now()}`,
        name,
        type,
        enabled: true,
        apiUrl,
        apiKey: parsed.apiKey || undefined,
        requestMethod: parsed.requestMethod || 'POST',
      requestTemplate: parsed.requestTemplate || undefined,
      responseAudioField: parsed.responseAudioField || undefined,
      responseFormat: parsed.responseFormat || undefined,
      voiceField: parsed.voiceField || undefined,
      maxTextLength: parsed.maxTextLength,
      voices: mergeVoices(
        parsed.voices || this.extractVoicesFromTemplate(parsed.requestTemplate) || [],
        getProviderVoices({ apiUrl, requestTemplate: parsed.requestTemplate, type })
      )
      }

      // 检查重复
      const duplicate = this.config.find((c) => c.name === name && c.apiUrl === apiUrl)
      if (duplicate) {
        return { success: false, error: `引擎「${name}」已存在（URL: ${apiUrl}）` }
      }

      this.addCustomEngine(config)
      console.info(`[EngineManager] imported engine from ${parsed.format}: ${name} (${type})`)
      return { success: true, config, detectedFormat: parsed.format }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[EngineManager] importEngine failed:', msg)
      return { success: false, error: `部署解析失败：${msg}` }
    }
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  /** 从 URL 提取引擎名称 */
  private guessNameFromUrl(url: string): string {
    try {
      const hostname = new URL(url).hostname
      return hostname.replace(/^api\./, '').replace(/^tts\./, '').split('.')[0]
        .replace(/^[a-z]/, (c) => c.toUpperCase())
    } catch { return '自定义 TTS' }
  }

  /** 智能解析 curl / Python requests / JSON */
  private parseDeployInput(input: string): DeployParseResult | null {
    if (typeof input !== 'string') return null
    const trimmed = input.trim()
    if (!trimmed) return null

    // ─── 1. 尝试 JSON ───
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const data = JSON.parse(trimmed)
        const root = this.getDeployRoot(data)
        if (root) return this.parseJsonDeployRoot(root)
      } catch { /* fall through to other parsers */ }
    }

    // ─── 2. 尝试 curl ───
    if (/^\s*curl\b/i.test(trimmed) || trimmed.includes('curl ')) {
      return this.parseCurl(trimmed)
    }

    // ─── 3. 尝试 Python requests ───
    if (trimmed.includes('requests.') || trimmed.includes('import requests')) {
      return this.parsePythonRequests(trimmed)
    }

    return null
  }

  /** 解析 curl 命令 */
  private parseCurl(input: string): DeployParseResult | null {
    // 1. 合并续行（反斜杠 + 换行），保留非续行换行以便 body 解析
    const merged = input.replace(/\\\s*\r?\n\s*/g, ' ')

    // 2. 直接在原始文本中提取 URL（最可靠的方式）
    const urlMatch = merged.match(/https?:\/\/[^\s'"]+/)
    if (!urlMatch) return null
    const apiUrl = urlMatch[0].replace(/['"]/g, '')

    // 3. 提取请求方法
    let requestMethod: 'POST' | 'GET' = 'GET'
    const methodMatch = merged.match(/(?:-X|--request)\s+['"]?(\w+)['"]?/i)
    if (methodMatch) requestMethod = methodMatch[1].toUpperCase() as 'POST' | 'GET'
    // 有 data body → POST
    if (/(?:-d|--data(?:-raw|-binary)?)\s/.test(merged)) requestMethod = 'POST'

    // 4. 提取 API Key — 按优先级匹配多种常见 header 模式
    let apiKey: string | undefined
    const headerPatterns = [
      /(?:-H|--header)\s+['"]([^'"]+)['"]/gi  // -H "Key: Value" or -H 'Key: Value'
    ]
    for (const pattern of headerPatterns) {
      for (const m of merged.matchAll(pattern)) {
        const header = m[1]
        // 按优先级尝试各种 key header 格式
        const authMatch = header.match(/^Authorization:\s*Bearer\s+(.+)$/i)
                     || header.match(/^(?:api-key|apikey|x-api-key|ocp-apim-subscription-key):\s*(.+)$/i)
        if (authMatch) {
          const val = authMatch[1].trim()
          // 跳过 shell 变量引用（$VAR / ${VAR}）
          if (!/^\$/.test(val)) apiKey = val
        }
      }
    }

    // 5. 提取 body — 支持多行
    let requestTemplate: Record<string, unknown> | undefined
    let voices: TTSVoice[] | undefined
    // 先尝试提取 --data-raw 的多行 body（原始文本，合并了续行但保留内部换行）
    const bodyMatch = merged.match(/(?:-d|--data(?:-raw|-binary)?)\s+(['"])([\s\S]*?)\1\s*(?:--|$)/)
                   || merged.match(/(?:-d|--data(?:-raw|-binary)?)\s+(['"])([\s\S]*?)\1\s*$/)
    const bodyStr = bodyMatch?.[2]

    if (bodyStr) {
      try {
        // 压缩空白后用 JSON.parse
        const compact = bodyStr.replace(/\s+/g, ' ').trim()
        const rawTemplate = JSON.parse(compact)
        voices = this.extractVoicesFromTemplate(rawTemplate)
        requestTemplate = this.normalizeRequestTemplate(rawTemplate)
      } catch {
        // body 不是合法 JSON，保留原始字符串供手动配置
        console.info('[EngineManager] curl body is not valid JSON, skipping requestTemplate')
      }
    }

    return {
      format: 'curl',
      apiUrl,
      apiKey,
      requestMethod,
      requestTemplate,
      responseFormat: this.guessResponseFormat(apiUrl, requestTemplate),
      responseAudioField: this.guessResponseAudioField(apiUrl, requestTemplate),
      voices
    }
  }

  /** 解析 Python requests 代码 */
  private parsePythonRequests(input: string): DeployParseResult | null {
    // 提取 URL
    const urlMatch = input.match(/['"](https?:\/\/[^'"]+)['"]/)
    if (!urlMatch) return null
    const apiUrl = urlMatch[1]

    // 提取方法
    let requestMethod: 'POST' | 'GET' = 'POST'
    if (input.includes('requests.get(')) requestMethod = 'GET'
    else if (input.includes('requests.post(')) requestMethod = 'POST'
    else if (input.includes('requests.put(')) requestMethod = 'POST'

    // 提取 API Key from headers
    let apiKey: string | undefined
    const authMatch = input.match(/['"]Authorization['"]\s*:\s*['"]Bearer\s+(.+?)['"]/)
    if (authMatch) apiKey = authMatch[1].trim()

    // 提取 json body
    let requestTemplate: Record<string, unknown> | undefined
    let voices: TTSVoice[] | undefined
    // 匹配 json={...} 或 json = {...}
    const jsonMatch = input.match(/json\s*=\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/)
    if (jsonMatch) {
      try {
        const rawTemplate = JSON.parse(jsonMatch[1])
        voices = this.extractVoicesFromTemplate(rawTemplate)
        requestTemplate = this.normalizeRequestTemplate(rawTemplate)
      } catch { /* ignore */ }
    }
    // 也尝试 data={...}
    if (!requestTemplate) {
      const dataMatch = input.match(/data\s*=\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/)
      if (dataMatch) {
        try {
          const rawTemplate = JSON.parse(dataMatch[1])
          voices = this.extractVoicesFromTemplate(rawTemplate)
          requestTemplate = this.normalizeRequestTemplate(rawTemplate)
        } catch { /* ignore */ }
      }
    }

    return {
      format: 'python',
      apiUrl,
      apiKey,
      requestMethod,
      requestTemplate,
      responseFormat: this.guessResponseFormat(apiUrl, requestTemplate),
      responseAudioField: this.guessResponseAudioField(apiUrl, requestTemplate),
      voices
    }
  }

  private getDeployRoot(data: unknown): Record<string, unknown> | null {
    if (!this.isRecord(data)) return null
    if (data.format === 'ting-ear-engine-deploy' && this.isRecord(data.config)) {
      return data.config
    }
    if (this.isRecord(data.engine)) return data.engine
    if (this.isRecord(data.config)) return data.config
    return data
  }

  private parseJsonDeployRoot(root: Record<string, unknown>): DeployParseResult {
    const apiUrl = this.stringValue(root.apiUrl) || this.stringValue(root.url) || this.stringValue(root.endpoint)
    const rawTemplate = root.requestTemplate || root.body || root.json
    const requestTemplate = this.normalizeRequestTemplate(rawTemplate)
    return {
      format: 'json',
      apiUrl,
      apiKey: this.stringValue(root.apiKey) || this.stringValue(root.key),
      requestMethod: this.normalizeMethod(root.requestMethod || root.method),
      requestTemplate,
      responseAudioField: this.stringValue(root.responseAudioField)
        || this.guessResponseAudioField(apiUrl, requestTemplate),
      responseFormat: this.normalizeResponseFormat(root.responseFormat)
        || this.guessResponseFormat(apiUrl, requestTemplate),
      voiceField: this.stringValue(root.voiceField),
      maxTextLength: typeof root.maxTextLength === 'number' ? root.maxTextLength : undefined,
      voices: this.normalizeVoices(root.voices) || this.extractVoicesFromTemplate(rawTemplate),
      name: this.stringValue(root.name),
      type: this.normalizeEngineType(root.type)
    }
  }

  private normalizeRequestTemplate(value: unknown): Record<string, unknown> | undefined {
    if (!this.isRecord(value)) return undefined
    return this.normalizeTemplateValue(value) as Record<string, unknown>
  }

  private normalizeTemplateValue(value: unknown, key = ''): unknown {
    if (Array.isArray(value)) {
      if (key === 'messages') {
        return value.map((item) => {
          if (!this.isRecord(item)) return this.normalizeTemplateValue(item)
          const normalizedMessage: Record<string, unknown> = { ...item }
          if (item.role === 'assistant' && typeof item.content === 'string' && !item.content.includes('{text}')) {
            normalizedMessage.content = '{text}'
          }
          return this.normalizeTemplateValue(normalizedMessage)
        })
      }
      return value.map((item) => this.normalizeTemplateValue(item))
    }
    if (!this.isRecord(value)) {
      if (typeof value === 'string') {
        if (['text', 'input', 'prompt'].includes(key) && !value.includes('{text}')) return '{text}'
        if (['voice', 'voice_id', 'speaker'].includes(key) && !value.includes('{voice}')) return '{voice}'
      }
      if ((typeof value === 'number' || typeof value === 'string') && key === 'speed') return '{speed}'
      return value
    }

    const normalized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      normalized[childKey] = this.normalizeTemplateValue(childValue, childKey)
    }
    return normalized
  }

  private extractVoicesFromTemplate(template: unknown): TTSVoice[] | undefined {
    const voices = new Set<string>()
    const visit = (value: unknown, key = ''): void => {
      if (typeof value === 'string') {
        if (['voice', 'voice_id', 'speaker'].includes(key) && value && value !== '{voice}') {
          voices.add(value)
        }
        return
      }
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item))
        return
      }
      if (this.isRecord(value)) {
        for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey)
      }
    }
    visit(template)
    const list = [...voices].map((voice) => ({
      id: voice,
      name: voice,
      description: '从部署配置自动识别'
    }))
    return list.length > 0 ? list : undefined
  }

  private withProviderVoices(config: TTSEngineConfig): TTSEngineConfig {
    const providerVoices = getProviderVoices({
      apiUrl: config.apiUrl,
      requestTemplate: config.requestTemplate,
      type: config.type
    })
    if (providerVoices.length === 0) return config
    return {
      ...config,
      voices: mergeVoices(config.voices || [], providerVoices)
    }
  }

  private guessResponseFormat(apiUrl: string | undefined, template: Record<string, unknown> | undefined): 'base64' | undefined {
    if (apiUrl?.includes('/chat/completions')) return 'base64'
    if (this.isRecord(template?.audio)) return 'base64'
    return undefined
  }

  private guessResponseAudioField(apiUrl: string | undefined, template: Record<string, unknown> | undefined): string | undefined {
    if (apiUrl?.includes('/chat/completions') || this.isRecord(template?.audio)) {
      return 'choices.0.message.audio.data'
    }
    return undefined
  }

  private normalizeVoices(value: unknown): TTSVoice[] | undefined {
    if (!Array.isArray(value)) return undefined
    const voices = value
      .map((item): TTSVoice | null => {
        if (typeof item === 'string') return { id: item, name: item }
        if (!this.isRecord(item)) return null
        const id = this.stringValue(item.id) || this.stringValue(item.name)
        if (!id) return null
        return {
          id,
          name: this.stringValue(item.name) || id,
          language: this.stringValue(item.language),
          gender: item.gender === 'male' || item.gender === 'female' ? item.gender : undefined,
          description: this.stringValue(item.description)
        }
      })
      .filter((voice): voice is TTSVoice => Boolean(voice))
    return voices.length > 0 ? voices : undefined
  }

  private normalizeMethod(value: unknown): 'POST' | 'GET' | undefined {
    if (typeof value !== 'string') return undefined
    const method = value.toUpperCase()
    return method === 'POST' || method === 'GET' ? method : undefined
  }

  private normalizeResponseFormat(value: unknown): 'base64' | 'url' | 'binary' | undefined {
    return value === 'base64' || value === 'url' || value === 'binary' ? value : undefined
  }

  private normalizeEngineType(value: unknown): 'openai' | 'http' | undefined {
    return value === 'openai' || value === 'http' ? value : undefined
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /** Probe a URL to auto-detect engine capabilities.
   *  Returns suggested name, type, and whether the probe succeeded. */
  async probeEngineUrl(apiUrl: string, apiKey?: string): Promise<{
    suggestedName: string
    suggestedType: 'openai' | 'http'
    isOpenAICompatible: boolean
  }> {
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    // Extract hostname for name suggestion
    let suggestedName = '自建 TTS'
    try {
      const u = new URL(apiUrl)
      const host = u.hostname.replace(/^api\./, '').replace(/^tts\./, '')
      // Capitalize first letter
      suggestedName = host.split('.')[0].replace(/^[a-z]/, (c) => c.toUpperCase())
    } catch { /* ignore */ }

    // Try OpenAI-compatible models endpoint
    let isOpenAICompatible = false
    try {
      const base = apiUrl.replace(/\/+$/, '')
      const modelsUrl = base.endsWith('/v1')
        ? `${base}/models`
        : `${base}/v1/models`
      const resp = await axios.get(modelsUrl, { headers, timeout: 5000 })
      if (resp.data && (resp.data.data || resp.data.models || Array.isArray(resp.data))) {
        isOpenAICompatible = true
        console.info(`[EngineManager] ${apiUrl} is OpenAI-compatible`)
      }
    } catch {
      // Not OpenAI-compatible
    }

    // Also check if URL itself hints at OpenAI
    if (!isOpenAICompatible) {
      isOpenAICompatible = apiUrl.includes('openai') || apiUrl.includes('/v1/audio/speech')
    }

    return {
      suggestedName,
      suggestedType: isOpenAICompatible ? 'openai' : 'http',
      isOpenAICompatible
    }
  }
}
