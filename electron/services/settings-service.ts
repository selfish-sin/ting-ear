import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import type { AppSettings, FloatingBallSettings } from '../../src/global'
import { DEFAULT_CLEAN_RULES } from '../../src/cleanRules'
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from '../../src/shortcuts'
import { mergeAiSettings } from './ai/ai-config'
import { atomicWriteFile } from '../utils/atomicWrite'

const defaultFloatingBall: FloatingBallSettings = {
  enabled: true,
  alwaysOnTop: true,
  opacity: 0.9,
  locked: false,
  autoSnap: true,
  showHoverCard: true,
  hoverDelayMs: 500,
  hideWhenMainWindowOpen: true,
  showWhenMainWindowMinimized: true,
  position: {
    x: null,
    y: null,
    edge: 'right'
  },
  mode: 'ball'
}

const defaultSettings: AppSettings = {
  ttsEngine: 'edge',
  qwenApiKey: '',
  qwenEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/generation',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  defaultSpeed: 1.0,
  defaultVolume: 0.8,
  windowAlwaysOnTop: false,
  windowOpacity: 0.95,
  floatingBallEnabled: true,
  floatingBall: { ...defaultFloatingBall },
  theme: 'light',
  fontSize: { body: 16, title: 20 },
  cleanRules: DEFAULT_CLEAN_RULES,
  shortcuts: DEFAULT_SHORTCUTS,
  dataDir: '',
  dataDirHistory: [],
  ai: mergeAiSettings()
}

export class SettingsService {
  private settingsDir: string
  private settingsFile: string
  private settings: AppSettings = { ...defaultSettings }

  constructor() {
    this.settingsDir = join(app.getPath('userData'), '听伴')
    this.settingsFile = join(this.settingsDir, 'settings.json')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.settingsDir)) {
      mkdirSync(this.settingsDir, { recursive: true })
    }
  }

  /** 设置文件始终存储在默认目录，不受自定义数据目录影响 */
  getSettingsFile(): string {
    return this.settingsFile
  }

  async load(): Promise<AppSettings> {
    try {
      if (existsSync(this.settingsFile)) {
        const data = readFileSync(this.settingsFile, 'utf-8')
        const parsed = JSON.parse(data) as Partial<AppSettings>
        const mergedFloatingBall: FloatingBallSettings = {
          ...defaultFloatingBall,
          ...(parsed.floatingBall || {}),
          position: {
            ...defaultFloatingBall.position,
            ...(parsed.floatingBall?.position || {})
          }
        }
        // 丢弃旧版 llmConfigs / cleanPrompt 等字段，不再进入内存
        this.settings = {
          ...defaultSettings,
          ...parsed,
          floatingBall: mergedFloatingBall,
          shortcuts: normalizeShortcuts(parsed.shortcuts),
          cleanRules:
            parsed.cleanRules && parsed.cleanRules.length > 0
              ? parsed.cleanRules
              : DEFAULT_CLEAN_RULES,
          ai: mergeAiSettings(parsed.ai)
        }
        // 旧版 settings.json 可能含 llmConfigs 等字段，展开时已丢弃未在 AppSettings 中的键
      }
    } catch {
      this.settings = { ...defaultSettings }
    }
    return this.settings
  }

  async save(settings: Partial<AppSettings>): Promise<AppSettings> {
    // 只保留当前 AppSettings 字段，避免把历史 LLM 字段再写回磁盘
    this.settings = {
      ...defaultSettings,
      ...this.settings,
      ...settings,
      floatingBall: {
        ...defaultSettings.floatingBall,
        ...(this.settings.floatingBall || {}),
        ...(settings.floatingBall || {}),
        position: {
          ...defaultSettings.floatingBall.position,
          ...(this.settings.floatingBall?.position || {}),
          ...(settings.floatingBall?.position || {})
        }
      },
      cleanRules:
        settings.cleanRules ??
        this.settings.cleanRules ??
        DEFAULT_CLEAN_RULES,
      ai: mergeAiSettings(settings.ai ?? this.settings.ai)
    }
    try {
      atomicWriteFile(this.settingsFile, JSON.stringify(this.settings, null, 2))
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
    return this.settings
  }

  get(): AppSettings {
    return this.settings
  }

  getApiKey(): string {
    return this.settings.qwenApiKey
  }

  getEndpoint(): string {
    return this.settings.qwenEndpoint
  }

  getCleanRules() {
    return this.settings.cleanRules ?? DEFAULT_CLEAN_RULES
  }

  /** 导出可迁移的设置包（含 API Key；用户应自行保管） */
  exportBundle(): {
    version: 1
    exportedAt: string
    settings: AppSettings
  } {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...this.settings }
    }
  }

  /** 从导出包合并导入（保留当前 dataDir，避免误切目录） */
  async importBundle(raw: unknown): Promise<{ success: boolean; error?: string }> {
    try {
      if (!raw || typeof raw !== 'object') {
        return { success: false, error: '设置包格式无效' }
      }
      const bundle = raw as { version?: unknown; settings?: unknown }
      const incoming =
        bundle.settings && typeof bundle.settings === 'object'
          ? (bundle.settings as Partial<AppSettings>)
          : (raw as Partial<AppSettings>)
      const keepDataDir = this.settings.dataDir
      const keepHistory = this.settings.dataDirHistory
      await this.save({
        ...incoming,
        dataDir: keepDataDir,
        dataDirHistory: keepHistory
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
