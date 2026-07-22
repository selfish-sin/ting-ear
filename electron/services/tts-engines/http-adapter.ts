/**
 * Generic HTTP TTS Adapter.
 *
 * Handles two modes:
 *   1. OpenAI-compatible: POST /v1/audio/speech (industry standard)
 *   2. Generic HTTP: configurable via requestTemplate / responseAudioField
 *
 * Also supports voice discovery for known patterns:
 *   - OpenAI: hardcoded 13 voices
 *   - Kokoro-style: GET /api/v1/audio/voices
 *   - Custom: user-defined list
 */
import axios from 'axios'
import { createHash } from 'crypto'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import type { ITTSAdapter, TTSResult, TTSVoice, TTSEngineConfig } from './adapter'
import { getProviderVoices, mergeVoices } from './provider-voices'

export class HttpAdapter implements ITTSAdapter {
  readonly engineId: string
  readonly engineName: string

  private config: TTSEngineConfig
  private cacheDir: string

  constructor(config: TTSEngineConfig) {
    this.config = config
    this.engineId = config.id
    this.engineName = config.name

    this.cacheDir = join(app.getPath('userData'), '听伴', `cache_${config.id}`)
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  private getCacheKey(text: string, voice: string): string {
    return createHash('md5').update([text, voice, this.config.apiUrl || '', this.engineId].join('|')).digest('hex')
  }

  async synthesize(text: string, voiceId: string, speed: number, _volume: number): Promise<TTSResult> {
    const apiUrl = this.config.apiUrl
    const apiKey = this.config.apiKey

    if (!apiUrl) {
      return { success: false, error: '引擎未配置 API URL', fallback: true }
    }

    const cacheKey = this.getCacheKey(text, voiceId)
    const configuredFormat = this.getConfiguredAudioFormat()
    const cachePath = join(this.cacheDir, `${cacheKey}.${configuredFormat}`)
    if (existsSync(cachePath)) {
      try {
        const buf = readFileSync(cachePath)
        console.info(`[HttpAdapter:${this.engineId}] cache hit`)
        return { success: true, audio: buf.toString('base64'), audioFormat: configuredFormat }
      } catch {
        // corrupted → fall through
      }
    }

    const voice = voiceId || this.config.voices?.[0]?.id || 'alloy'

    try {
      if (this.config.type === 'openai') {
        return this.synthesizeOpenAI(text, voice, speed, apiUrl, apiKey, cachePath)
      }
      return this.synthesizeGeneric(text, voice, speed, apiUrl, apiKey, cachePath)
    } catch (error: unknown) {
      const msg = this.formatError(error)
      console.error(`[HttpAdapter:${this.engineId}] synthesize error:`, msg)
      return { success: false, error: msg, fallback: true }
    }
  }

  /** OpenAI-compatible: POST /v1/audio/speech */
  private async synthesizeOpenAI(
    text: string,
    voice: string,
    speed: number,
    apiUrl: string,
    apiKey: string | undefined,
    cachePath: string
  ): Promise<TTSResult> {
    // normalize: strip trailing slash, ensure /v1/audio/speech path
    const base = apiUrl.replace(/\/+$/, '')
    const speechUrl = base.endsWith('/v1/audio/speech')
      ? base
      : base.endsWith('/v1')
        ? `${base}/audio/speech`
        : `${base}/v1/audio/speech`

    console.info(`[HttpAdapter:${this.engineId}] OpenAI speech: ${speechUrl}`)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const body: Record<string, unknown> = {
      model: 'tts-1',
      input: text,
      voice,
      speed,
      response_format: 'mp3'
    }

    const response = await axios.post(speechUrl, body, {
      headers,
      responseType: 'arraybuffer',
      timeout: 30000
    })

    const audioBuffer = Buffer.from(response.data)
    console.info(`[HttpAdapter:${this.engineId}] audio: ${audioBuffer.length} bytes`)

    if (audioBuffer.length < 100) {
      // Likely JSON error response
      const errorText = audioBuffer.toString('utf-8')
      console.error(`[HttpAdapter:${this.engineId}] short response: ${errorText}`)
      return { success: false, error: 'API 返回了非音频数据', fallback: true }
    }

    try { writeFileSync(cachePath, audioBuffer) } catch { /* ignore */ }
    return { success: true, audio: audioBuffer.toString('base64'), audioFormat: 'mp3' }
  }

  /** Generic HTTP: configurable request/response format */
  private async synthesizeGeneric(
    text: string,
    voice: string,
    speed: number,
    apiUrl: string,
    apiKey: string | undefined,
    cachePath: string
  ): Promise<TTSResult> {
    console.info(`[HttpAdapter:${this.engineId}] generic HTTP: ${apiUrl}`)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    // Use requestTemplate if configured, otherwise use a sensible default
    const body = this.config.requestTemplate
      ? this.renderTemplate(this.config.requestTemplate, { text, voice, speed })
      : { text, voice, speed }

    const response = await axios({
      method: this.config.requestMethod || 'POST',
      url: apiUrl,
      headers,
      data: body,
      responseType: 'arraybuffer',
      timeout: 30000
    })

    let audioBuffer: Buffer

    // Handle different response formats
    const respFormat = this.config.responseFormat || 'binary'
    const audioField = this.config.responseAudioField

    if (respFormat === 'url') {
      // Response is JSON with an audio URL
      const respText = Buffer.from(response.data).toString('utf-8')
      let json: Record<string, unknown>
      try {
        json = JSON.parse(respText)
      } catch {
        return { success: false, error: '响应不是有效的 JSON', fallback: true }
      }
      const url = audioField
        ? (this.getNestedValue(json, audioField) as string)
        : (json.audio_url || json.url || json.audioUrl) as string
      if (!url) {
        console.error(`[HttpAdapter:${this.engineId}] no audio URL in response:`, respText.substring(0, 200))
        return { success: false, error: '响应中未找到音频 URL', fallback: true }
      }
      const audioResp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
      audioBuffer = Buffer.from(audioResp.data)
    } else if (respFormat === 'base64') {
      // Response is JSON with a base64 audio field
      const respText = Buffer.from(response.data).toString('utf-8')
      let json: Record<string, unknown>
      try {
        json = JSON.parse(respText)
      } catch {
        return { success: false, error: '响应不是有效的 JSON', fallback: true }
      }
      const b64 = audioField
        ? (this.getNestedValue(json, audioField) as string)
        : (json.audio || json.data || json.audio_data) as string
      if (!b64) {
        console.error(`[HttpAdapter:${this.engineId}] no base64 audio in response`)
        return { success: false, error: '响应中未找到音频数据', fallback: true }
      }
      audioBuffer = Buffer.from(b64.replace(/^data:audio\/[^;]+;base64,/i, ''), 'base64')
    } else {
      // binary: response IS audio data directly
      audioBuffer = Buffer.from(response.data)
    }

    console.info(`[HttpAdapter:${this.engineId}] audio: ${audioBuffer.length} bytes`)

    if (audioBuffer.length < 100) {
      return { success: false, error: 'API 返回数据过短', fallback: true }
    }

    try { writeFileSync(cachePath, audioBuffer) } catch { /* ignore */ }
    return {
      success: true,
      audio: audioBuffer.toString('base64'),
      audioFormat: this.detectAudioFormat(audioBuffer) || this.getConfiguredAudioFormat()
    }
  }

  private getConfiguredAudioFormat(): 'mp3' | 'wav' {
    const findFormat = (value: unknown): string | undefined => {
      if (typeof value === 'string') {
        const normalized = value.toLowerCase()
        return normalized === 'wav' || normalized === 'mp3' ? normalized : undefined
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findFormat(item)
          if (found) return found
        }
        return undefined
      }
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        for (const key of ['format', 'response_format', 'audioFormat']) {
          const found = findFormat(record[key])
          if (found) return found
        }
        for (const child of Object.values(record)) {
          const found = findFormat(child)
          if (found) return found
        }
      }
      return undefined
    }

    return findFormat(this.config.requestTemplate) === 'wav' ? 'wav' : 'mp3'
  }

  private detectAudioFormat(buffer: Buffer): 'mp3' | 'wav' | undefined {
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
      return 'wav'
    }
    if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3'
    return undefined
  }

  private formatError(error: unknown): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number; data?: unknown } }).response
      if (response) {
        let detail = ''
        if (typeof response.data === 'string') {
          detail = response.data
        } else if (Buffer.isBuffer(response.data)) {
          detail = response.data.toString('utf-8')
        } else if (response.data !== undefined) {
          try { detail = JSON.stringify(response.data) } catch { detail = String(response.data) }
        }
        return `HTTP ${response.status || 'error'}${detail ? `: ${detail.slice(0, 500)}` : ''}`
      }
    }
    return error instanceof Error ? error.message : String(error)
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
      return undefined
    }, obj as unknown)
  }

  private renderTemplate(
    value: Record<string, unknown>,
    vars: { text: string; voice: string; speed: number }
  ): Record<string, unknown> {
    const renderValue = (item: unknown): unknown => {
      if (typeof item === 'string') {
        return item
          .replaceAll('{text}', vars.text)
          .replaceAll('{voice}', vars.voice)
          .replaceAll('{speed}', String(vars.speed))
      }
      if (Array.isArray(item)) return item.map(renderValue)
      if (item && typeof item === 'object') {
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>).map(([key, nested]) => [key, renderValue(nested)])
        )
      }
      return item
    }

    return renderValue(value) as Record<string, unknown>
  }

  async fetchVoices(): Promise<TTSVoice[]> {
    const providerVoices = this.getConfiguredProviderVoices()

    // If user manually configured voices, use those
    if (this.config.voices && this.config.voices.length > 0) {
      return mergeVoices(this.config.voices, providerVoices) || []
    }

    if (providerVoices.length > 0) return providerVoices

    // Try auto-discovery from the API
    return this.discoverVoices()
  }

  /** Auto-discover voices from the engine's API endpoint */
  async discoverVoices(): Promise<TTSVoice[]> {
    const apiUrl = this.config.apiUrl
    if (!apiUrl) return []

    const apiKey = this.config.apiKey
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const voiceEndpoints = this.buildVoiceEndpoints(apiUrl)

    for (const endpoint of voiceEndpoints) {
      try {
        console.info(`[HttpAdapter:${this.engineId}] probing voices: ${endpoint}`)
        const resp = await axios.get(endpoint, { headers, timeout: 5000 })

        const voices = this.parseVoiceResponse(resp.data)
        if (voices.length > 0) {
          console.info(`[HttpAdapter:${this.engineId}] discovered ${voices.length} voices from ${endpoint}`)
          return voices
        }
      } catch {
        // continue to next endpoint
      }
    }

    const providerVoices = this.getConfiguredProviderVoices()
    if (providerVoices.length > 0) return providerVoices

    // No voices discovered
    return []
  }

  private getConfiguredProviderVoices(): TTSVoice[] {
    return getProviderVoices({
      apiUrl: this.config.apiUrl,
      requestTemplate: this.config.requestTemplate,
      type: this.config.type
    })
  }

  private buildVoiceEndpoints(apiUrl: string): string[] {
    const endpoints: string[] = []
    const add = (url: string | null | undefined) => {
      if (url && !endpoints.includes(url)) endpoints.push(url)
    }

    const base = apiUrl.replace(/\/+$/, '')
    add(`${base}/voices`)
    add(`${base}/audio/voices`)

    try {
      const url = new URL(apiUrl)
      const origin = url.origin
      const path = url.pathname.replace(/\/+$/, '')
      const v1Index = path.indexOf('/v1')
      const v1Base = v1Index >= 0
        ? `${origin}${path.slice(0, v1Index + 3)}`
        : `${origin}/v1`

      add(`${v1Base}/voices`)
      add(`${v1Base}/audio/voices`)
      add(`${origin}/voices`)
      add(`${origin}/api/voices`)
      add(`${origin}/api/v1/voices`)
      add(`${origin}/api/v1/audio/voices`)
    } catch {
      const root = base.replace(/\/v1.*$/, '')
      add(`${root}/v1/voices`)
      add(`${root}/v1/audio/voices`)
      add(`${root}/api/v1/voices`)
      add(`${root}/api/v1/audio/voices`)
    }

    return endpoints
  }

  /** Parse various voice list response formats into TTSVoice[] */
  private parseVoiceResponse(data: unknown): TTSVoice[] {
    try {
      // Kokoro format: { voices: ["zf_xiaobei", "zf_xiaoni", ...] }
      if (typeof data === 'object' && data !== null && 'voices' in data) {
        const voices = (data as Record<string, unknown>).voices
        if (Array.isArray(voices)) {
          return voices.map((v: unknown) => {
            if (typeof v === 'string') return { id: v, name: v }
            if (typeof v === 'object' && v !== null) {
              const vo = v as Record<string, unknown>
              return {
                id: String(vo.id || vo.name || vo.voice_id || ''),
                name: String(vo.name || vo.id || ''),
                language: typeof vo.language === 'string' ? vo.language : undefined,
                gender: typeof vo.gender === 'string'
                  ? (vo.gender as 'male' | 'female')
                  : undefined,
                description: typeof vo.description === 'string' ? vo.description : undefined
              }
            }
            return { id: String(v), name: String(v) }
          })
        }
      }

      // Direct array: ["voice1", "voice2", ...]
      if (Array.isArray(data)) {
        return data.map((v: unknown) => {
          if (typeof v === 'string') return { id: v, name: v }
          if (typeof v === 'object' && v !== null) {
            const vo = v as Record<string, unknown>
            return {
              id: String(vo.id || vo.name || vo.voice_id || ''),
              name: String(vo.name || vo.id || ''),
              language: typeof vo.language === 'string' ? vo.language : undefined,
              gender: typeof vo.gender === 'string'
                ? (vo.gender as 'male' | 'female')
                : undefined,
              description: typeof vo.description === 'string' ? vo.description : undefined
            }
          }
          return { id: String(v), name: String(v) }
        })
      }

      // OpenAPI/openai-edge format: { data: [{ id, name, ... }] }
      if (typeof data === 'object' && data !== null && 'data' in data) {
        const list = (data as Record<string, unknown>).data
        if (Array.isArray(list)) {
          return list.map((v: unknown) => {
            if (typeof v === 'object' && v !== null) {
              const vo = v as Record<string, unknown>
              return {
                id: String(vo.id || vo.name || ''),
                name: String(vo.name || vo.id || ''),
                language: typeof vo.language === 'string' ? vo.language : undefined,
                gender: typeof vo.gender === 'string'
                  ? (vo.gender as 'male' | 'female')
                  : undefined,
                description: typeof vo.description === 'string' ? vo.description : undefined
              }
            }
            return { id: String(v), name: String(v) }
          })
        }
      }
    } catch (e) {
      console.error(`[HttpAdapter] parseVoiceResponse error:`, e)
    }
    return []
  }

  async testConnection(): Promise<boolean> {
    try {
      // For OpenAI type, try fetching voices first (lightweight)
      if (this.config.type === 'openai') {
        const voices = await this.fetchVoices()
        if (voices.length > 0) return true
      }
      // Fallback: try a minimal synthesis
      const result = await this.synthesize('测试', '', 1.0, 0.5)
      return result.success
    } catch {
      return false
    }
  }
}
