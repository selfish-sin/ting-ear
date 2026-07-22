// Polyfill Web Crypto for msedge-tts (which expects globalThis.crypto).
// Electron 28 bundles Node 18 where globalThis.crypto may not be available.
import { webcrypto, createHash } from 'node:crypto'
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).crypto = webcrypto
}

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { app } from 'electron'
import type { ITTSAdapter, TTSResult, TTSVoice } from './adapter'

/**
 * Edge TTS adapter.
 *
 * Uses the `msedge-tts` library which speaks the real Microsoft Edge
 * ReadAloud WebSocket protocol (sec-ms-gec token, SSML over WSS).
 *
 * Voice list comes directly from Microsoft's official /voices/list endpoint
 * (fetched 2026-07) and only contains voices that actually return audio.
 *
 * Local cache: MD5(text+voice+speed) → MP3 file. Cuts latency from ~500ms to ~5ms
 * on repeated sentences. Cache expires after 10 days.
 */

// Lazy-loaded to play nice with electron-vite externalization.
let MsEdgeTTSModule: Record<string, unknown> | null = null
type MsEdgeTTSAPI = {
  MsEdgeTTS: new (...args: unknown[]) => { setMetadata: (a: string, b: string) => Promise<void>; toStream: (a: string, b: { rate: string; volume: number }) => { audioStream: NodeJS.ReadableStream }; close: () => void }
  OUTPUT_FORMAT: Record<string, string>
}
async function getMsEdgeTTS(): Promise<MsEdgeTTSAPI> {
  if (!MsEdgeTTSModule) {
    MsEdgeTTSModule = require('msedge-tts')
  }
  return MsEdgeTTSModule as unknown as MsEdgeTTSAPI
}

/**
 * Real, verified-available Chinese voices on the Edge ReadAloud service.
 */
const EDGE_VOICES: TTSVoice[] = [
  // zh-CN (Mandarin, Simplified)
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', description: '女声 · 新闻/小说', gender: 'female', language: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', description: '女声 · 卡通/小说', gender: 'female', language: 'zh-CN' },
  { id: 'zh-CN-YunjianNeural', name: '云健', description: '男声 · 体育/小说', gender: 'male', language: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural', name: '云希', description: '男声 · 小说', gender: 'male', language: 'zh-CN' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏', description: '男声 · 卡通/小说', gender: 'male', language: 'zh-CN' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', description: '男声 · 新闻', gender: 'male', language: 'zh-CN' },
  // zh-HK (Cantonese)
  { id: 'zh-HK-HiuGaaiNeural', name: '曉佳', description: '女声 · 粤语', gender: 'female', language: 'zh-HK' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼', description: '女声 · 粤语', gender: 'female', language: 'zh-HK' },
  { id: 'zh-HK-WanLungNeural', name: '雲龍', description: '男声 · 粤语', gender: 'male', language: 'zh-HK' },
  // zh-TW (Mandarin, Traditional)
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻', description: '女声 · 台湾', gender: 'female', language: 'zh-TW' },
  { id: 'zh-TW-HsiaoYuNeural', name: '曉雨', description: '女声 · 台湾', gender: 'female', language: 'zh-TW' },
  { id: 'zh-TW-YunJheNeural', name: '雲哲', description: '男声 · 台湾', gender: 'male', language: 'zh-TW' },
]

/** Convert our (speed multiplier, volume 0..1) into msedge-tts prosody options. */
function toProsody(speed: number, volume: number) {
  const ratePercent = Math.round((speed - 1) * 100)
  const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`
  const volNum = Math.max(0, Math.min(100, Math.round(volume * 100)))
  return { rate: rateStr, volume: volNum }
}

export class EdgeAdapter implements ITTSAdapter {
  readonly engineId = 'edge'
  readonly engineName = 'Edge TTS（微软免费）'

  private cacheDir: string

  constructor() {
    try {
      this.cacheDir = join(app.getPath('userData'), '听伴', 'edge_cache')
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true })
      }
    } catch {
      // Fallback: use a temp directory if userData path fails
      this.cacheDir = join(require('os').tmpdir(), 'ting-ear-edge-cache')
      try { mkdirSync(this.cacheDir, { recursive: true }) } catch { /* give up on caching */ }
    }
  }

  /** 清理超过 10 天的缓存文件（启动时调用） */
  static cleanupCache(): void {
    try {
      const dir = join(app.getPath('userData'), '听伴', 'edge_cache')
      if (!existsSync(dir)) return
      const cutoff = Date.now() - 10 * 86400000
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f)
        if (statSync(fp).mtimeMs < cutoff) {
          unlinkSync(fp)
          console.info(`[Edge] cache cleaned: ${f}`)
        }
      }
    } catch { /* ignore */ }
  }

  private getCacheKey(text: string, voice: string, speed: number): string {
    return createHash('md5').update(text + '|' + voice + '|' + speed.toFixed(1)).digest('hex')
  }

  async synthesize(text: string, voiceId: string, speed: number, volume: number): Promise<TTSResult> {
    // 防止音色跨引擎串台：验证 voiceId 是否在 Edge 已知音色列表中
    const isValid = EDGE_VOICES.some((v) => v.id === voiceId)
    const voice = (voiceId && isValid) ? voiceId : 'zh-CN-XiaoxiaoNeural'
    if (voiceId && !isValid) {
      console.info(`[Edge] voice "${voiceId}" not found in Edge list, falling back to ${voice}`)
    }
    console.info(`[Edge] synthesize: textLen=${text.length} voice=${voice} speed=${speed.toFixed(1)}`)

    // === 检查本地缓存 ===
    const cacheKey = this.getCacheKey(text, voice, speed)
    const cachePath = join(this.cacheDir, `${cacheKey}.mp3`)
    if (existsSync(cachePath)) {
      console.info(`[Edge] cache hit: ${cacheKey}`)
      try {
        const buf = readFileSync(cachePath)
        console.info(`[Edge] cached audio: ${buf.length} bytes`)
        return { success: true, audio: buf.toString('base64') }
      } catch {
        // cache file corrupted → fall through to live synthesis
      }
    }

    // === 实时合成（带超时重试） ===
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        console.info(`[Edge] retry attempt ${attempt} after 500ms backoff`)
        await new Promise((r) => setTimeout(r, 500))
      }
      try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = await getMsEdgeTTS()
        const tts = new MsEdgeTTS()
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

        const chunks: Buffer[] = []
        await new Promise<void>((resolve, reject) => {
          const { audioStream } = tts.toStream(text, toProsody(speed, volume))
          let settled = false
          const timer = setTimeout(() => {
            if (settled) return
            settled = true
            try { tts.close() } catch { /* ignore */ }
            reject(new Error('Edge TTS: synthesize timeout (8s)'))
          }, 8000)

          audioStream.on('data', (b: Buffer) => chunks.push(b))
          audioStream.on('close', () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve()
          })
          audioStream.on('error', (e: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            try { tts.close() } catch { /* ignore */ }
            reject(e)
          })
        })

        try { tts.close() } catch { /* ignore */ }

        const total = chunks.reduce((n, b) => n + b.length, 0)
        console.info(`[Edge] audio: ${total} bytes for voice=${voice}`)
        if (total === 0) {
          return {
            success: false,
            error: `Edge TTS: 该音色(${voice})未返回音频，可能不可用`,
            fallback: true
          }
        }

        // === 写入缓存 ===
        const audioBuffer = Buffer.concat(chunks)
        try { writeFileSync(cachePath, audioBuffer) } catch { /* ignore */ }

        return { success: true, audio: audioBuffer.toString('base64') }
      } catch (error) {
        lastError = error
        const msg = String(error instanceof Error ? error.message : error)
        console.info(`[Edge] attempt ${attempt} failed: ${msg}`)
        // 只有超时才重试，其他错误直接放弃
        if (!msg.includes('timeout')) break
      }
    }
    // 所有重试都失败
    console.info(`[Edge] all retries exhausted, error:`, lastError)
    return {
      success: false,
      error: String(lastError instanceof Error ? (lastError as Error).message : lastError),
      fallback: true
    }
  }

  async fetchVoices(): Promise<TTSVoice[]> {
    return EDGE_VOICES
  }

  async testConnection(): Promise<boolean> {
    const result = await this.synthesize('测试', 'zh-CN-XiaoxiaoNeural', 1.0, 0.5)
    return result.success
  }
}
