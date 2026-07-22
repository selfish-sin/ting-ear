import axios from 'axios'
import { createHash } from 'crypto'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { app } from 'electron'
import type { ITTSAdapter, TTSResult, TTSVoice } from './adapter'

const QWEN_VOICES: TTSVoice[] = [
  { id: 'Cherry', name: '芊悦', description: '女声 阳光亲切', gender: 'female', language: 'zh-CN' },
  { id: 'Serena', name: '苏瑶', description: '女声 温柔', gender: 'female', language: 'zh-CN' },
  { id: 'Ethan', name: '晨煦', description: '男声 阳光活力', gender: 'male', language: 'zh-CN' },
  { id: 'Chelsie', name: '千雪', description: '女声 二次元', gender: 'female', language: 'zh-CN' },
  { id: 'Momo', name: '茉兔', description: '女声 撒娇搞怪', gender: 'female', language: 'zh-CN' },
  { id: 'Vivian', name: '十三', description: '女声 拽酷可爱', gender: 'female', language: 'zh-CN' },
  { id: 'Moon', name: '月白', description: '男声 率性帅气', gender: 'male', language: 'zh-CN' },
  { id: 'Maia', name: '四月', description: '女声 知性温柔', gender: 'female', language: 'zh-CN' },
  { id: 'Kai', name: '凯', description: '男声 磁性', gender: 'male', language: 'zh-CN' },
  { id: 'Andre', name: '安德雷', description: '男声 沉稳', gender: 'male', language: 'zh-CN' },
  { id: 'Stella', name: '少女阿月', description: '甜美女声', gender: 'female', language: 'zh-CN' },
  { id: 'Nofish', name: '不吃鱼', description: '男声', gender: 'male', language: 'zh-CN' },
  { id: 'Bella', name: '萌宝', description: '小萝莉', gender: 'female', language: 'zh-CN' },
  { id: 'Jennifer', name: '詹妮弗', description: '美语女声', gender: 'female', language: 'en-US' },
  { id: 'Ryan', name: '甜茶', description: '男声 戏感强', gender: 'male', language: 'zh-CN' },
  { id: 'Katerina', name: '卡捷琳娜', description: '御姐', gender: 'female', language: 'zh-CN' },
  { id: 'Aiden', name: '艾登', description: '美语男声', gender: 'male', language: 'en-US' },
  { id: 'Mia', name: '乖小妹', description: '女声 温顺', gender: 'female', language: 'zh-CN' },
  { id: 'Mochi', name: '沙小弥', description: '童声', language: 'zh-CN' },
  { id: 'Bunny', name: '萌小姬', description: '小萝莉', gender: 'female', language: 'zh-CN' }
]

export class QwenAdapter implements ITTSAdapter {
  readonly engineId = 'qwen'
  readonly engineName = '千问 TTS'

  private apiKey: string
  private endpoint: string
  private cacheDir: string

  constructor(apiKey: string, endpoint: string) {
    this.apiKey = apiKey
    this.endpoint = endpoint
    this.cacheDir = join(app.getPath('userData'), '听伴', 'qwen_cache')
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true })
  }

  /** 清理超过 10 天的缓存文件（启动时调用） */
  static cleanupCache(): void {
    try {
      const dir = join(app.getPath('userData'), '听伴', 'qwen_cache')
      if (!existsSync(dir)) return
      const cutoff = Date.now() - 10 * 86400000
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f)
        if (statSync(fp).mtimeMs < cutoff) {
          unlinkSync(fp)
          console.info(`[Qwen] cache cleaned: ${f}`)
        }
      }
    } catch { /* ignore */ }
  }

  private getCacheKey(text: string, voice: string): string {
    return createHash('md5').update(text + '|' + voice).digest('hex')
  }

  async synthesize(text: string, voiceId: string, _speed: number, _volume: number): Promise<TTSResult> {
    const key = this.apiKey
    if (!key) {
      console.info('[Qwen] API key is empty')
      return { success: false, error: 'API_KEY_INVALID', fallback: true }
    }

    // 防止音色跨引擎串台：验证 voiceId 是否在千问已知音色列表中
    const isValid = QWEN_VOICES.some((v) => v.id === voiceId)
    const voice = (voiceId && isValid) ? voiceId : 'Cherry'
    if (voiceId && !isValid) {
      console.info(`[Qwen] voice "${voiceId}" not found in Qwen list, falling back to ${voice}`)
    }

    // Check cache
    const cacheKey = this.getCacheKey(text, voice)
    const cachePath = join(this.cacheDir, `${cacheKey}.wav`)
    if (existsSync(cachePath)) {
      console.info(`[Qwen] cache hit: ${cacheKey}`)
      try {
        const buf = readFileSync(cachePath)
        const base64 = buf.toString('base64')
        console.info(`[Qwen] cached audio: ${buf.length} bytes`)
        return { success: true, audio: base64, audioFormat: 'wav' }
      } catch { /* fall through */ }
    }

    const reqBody = {
      model: 'qwen3-tts-flash',
      input: { text },
      parameters: { voice }
    }
    console.info(`[Qwen] POST ${this.endpoint}`)
    console.info(`[Qwen] req:`, JSON.stringify(reqBody))

    try {
      const response = await axios.post(this.endpoint, reqBody, {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      })

      console.info(`[Qwen] HTTP ${response.status}`)

      // Qwen TTS returns output.audio.url (signed URL valid 24h)
      const audioUrl: string | undefined = response.data?.output?.audio?.url
      if (audioUrl) {
        console.info(`[Qwen] audio URL: ${audioUrl.substring(0, 100)}...`)
        const audioResp = await axios.get(audioUrl, {
          responseType: 'arraybuffer',
          timeout: 30000
        })
        console.info(`[Qwen] audio downloaded: ${audioResp.data.byteLength} bytes`)
        // Save to cache
        try { writeFileSync(cachePath, Buffer.from(audioResp.data)) } catch { /* ignore */ }
        const base64 = Buffer.from(audioResp.data).toString('base64')
        console.info(`[Qwen] base64 length: ${base64.length}`)
        return { success: true, audio: base64, audioFormat: 'wav' }
      }

      console.info(`[Qwen] unexpected response shape:`, JSON.stringify(response.data).substring(0, 300))
      return { success: false, error: 'API 返回格式异常', fallback: true }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        const body = error.response?.data
        console.info(`[Qwen] axios error: status=${status} code=${error.code} body=${JSON.stringify(body).substring(0, 300)}`)
        if (status === 401) {
          return { success: false, error: 'API_KEY_INVALID', fallback: true }
        }
        if (status === 429) {
          return { success: false, error: 'QUOTA_EXCEEDED', fallback: true }
        }
        if (error.code === 'ECONNABORTED') {
          return { success: false, error: 'TIMEOUT', fallback: true }
        }
      }
      console.info(`[Qwen] unknown error:`, error)
      return { success: false, error: String(error), fallback: true }
    }
  }

  async fetchVoices(): Promise<TTSVoice[]> {
    return QWEN_VOICES
  }

  async testConnection(): Promise<boolean> {
    const result = await this.synthesize('测试', 'Cherry', 1.0, 0.5)
    return result.success
  }
}
