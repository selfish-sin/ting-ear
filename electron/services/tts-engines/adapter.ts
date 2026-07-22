/**
 * TTS Engine Adapter Interface.
 * All TTS engines implement this interface to support plug-in replacement.
 */

export interface TTSResult {
  success: boolean
  audio?: string   // base64-encoded audio data
  audioFormat?: 'mp3' | 'wav'  // v5: for correct MIME type selection
  error?: string
  fallback?: boolean
}

export interface TTSVoice {
  id: string
  name: string
  /** 语言代码，如 'zh-CN' / 'en-US'；缺省视为中文 */
  language?: string
  gender?: 'male' | 'female'
  /** 风格/特征描述，如 '女声 阳光亲切'；用于音色列表副信息行 */
  description?: string
}

export interface TTSEngineConfig {
  id: string
  name: string
  type: 'qwen' | 'system' | 'edge' | 'openai' | 'http' | 'local' | 'indextts'
  enabled: boolean

  // Connection
  apiUrl?: string
  apiKey?: string
  requestMethod?: 'POST' | 'GET'

  // Advanced (for custom engines)
  requestTemplate?: Record<string, unknown>
  responseAudioField?: string
  responseFormat?: 'base64' | 'url' | 'binary'
  voiceField?: string
  maxTextLength?: number
  sortOrder?: number

  // Voice list (fetched from engine)
  voices?: TTSVoice[]

  // Local engine config
  localCommand?: string
  localWorkDir?: string
}

export interface ITTSAdapter {
  readonly engineId: string
  readonly engineName: string

  /** Synthesize text to audio. Returns base64-encoded audio. */
  synthesize(text: string, voiceId: string, speed: number, volume: number): Promise<TTSResult>

  /** Fetch available voices for this engine. */
  fetchVoices(): Promise<TTSVoice[]>

  /** Test connection. */
  testConnection(): Promise<boolean>
}
