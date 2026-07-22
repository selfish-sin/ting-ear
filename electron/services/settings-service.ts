import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { AppSettings, FloatingBallSettings } from '../../src/global'
import { DEFAULT_CLEAN_RULES } from '../../src/cleanRules'
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from '../../src/shortcuts'

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

/** 合并 LLM 配置：默认预设不被旧配置覆盖，同时保留用户自定义的配置 */
type LlmConfigLike = { id?: string }
function mergeLlmConfigs(defaults: unknown[], loaded?: unknown[]): unknown[] {
  if (!loaded || !Array.isArray(loaded)) return defaults
  const loadedArr = loaded as LlmConfigLike[]
  const loadedIds = new Set(loadedArr.filter((c) => c?.id).map((c) => c.id))
  // 保留所有用户配置（包括被编辑过的默认配置）
  const merged = [...loaded]
  // 添加用户配置中不存在的默认预设
  for (const d of defaults) {
    if (!(loadedIds.has((d as LlmConfigLike).id))) {
      merged.push(d)
    }
  }
  return merged
}

const defaultSettings: AppSettings = {
  ttsEngine: 'edge',
  qwenApiKey: '',
  qwenEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/generation',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  defaultSpeed: 1.0,
  defaultVolume: 0.8,
  windowAlwaysOnTop: true,
  windowOpacity: 0.95,
  floatingBallEnabled: true,
  floatingBall: { ...defaultFloatingBall },
  theme: 'light',
  fontSize: { body: 16, title: 20 },
  activeLlmId: 'qwen3.5-4b',
  llmConfigs: [
    {
      id: 'qwen3.5-4b',
      provider: 'ollama' as const,
      name: '千问 3.5 4B（本地免费）',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      model: 'qwen3.5:4b',
      contextWindow: 32768,
      maxTokens: 4096,
      temperature: 0.3
    },
    {
      id: 'deepseek-v4-flash',
      provider: 'openai' as const,
      name: 'DeepSeek Chat（云端·推荐清洗）',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      contextWindow: 1000000,
      maxTokens: 8192,
      temperature: 0.3
    },
    {
      id: 'glm-4.5-air',
      provider: 'openai' as const,
      name: '智谱 GLM-4.5 Air（云端）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      model: 'glm-4-flash',
      contextWindow: 131072,
      maxTokens: 4096,
      temperature: 0.3
    }
  ],
  cleanPrompt: `你是一个专业的文档清洗助手。请对以下文档片段执行清洗：

规则：
1. 删除页码与期号：如"第X页""Page X""12/345""- X -"纯数字页码行、"年第X期""总第X期""N o.""No."等
2. 删除页眉页脚：仅当期刊名/章节名/作者名/卷期信息单独成行且重复出现时删除
3. 合并被硬换行打断的不完整段落（非句末标点结尾的行与下一行合并）
4. 半角标点转全角（,→， .→。 ;→； :→：）
5. 删除单词内部多余空格（含中英文：把 "J o u r n a l" 合并为 "Journal"，"福 建" 合并为 "福建"），保留单词之间的正常空格
6. 删除连续3个以上空行
7. 仅删除真正的乱码：显示为方块（■/）、Unicode 私用区字符、完全无法识别的符号。保留正常外文术语、人名、参考文献中的英文
8. 保留原文段落结构，不要因句号/问号/感叹号强行换行，不要限制单句长度

严禁：添加正文内容、删除正文语义、改写原文表达、输出任何解释。只返回清洗后的纯文本。`,
  cleanRules: DEFAULT_CLEAN_RULES,
  shortcuts: DEFAULT_SHORTCUTS
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

  async load(): Promise<AppSettings> {
    try {
      if (existsSync(this.settingsFile)) {
        const data = readFileSync(this.settingsFile, 'utf-8')
        const parsed = JSON.parse(data)
        // 合并默认值，确保新增的 floatingBall 子对象一定存在
        const mergedFloatingBall: FloatingBallSettings = {
          ...defaultFloatingBall,
          ...((parsed as AppSettings).floatingBall || {}),
          position: {
            ...defaultFloatingBall.position,
            ...(((parsed as AppSettings).floatingBall as FloatingBallSettings | undefined)?.position || {})
          }
        }
        this.settings = {
          ...defaultSettings,
          ...parsed,
          floatingBall: mergedFloatingBall,
          shortcuts: normalizeShortcuts((parsed as AppSettings).shortcuts),
          // 确保新预设模型不被旧配置覆盖（老用户升级也能用上新模型）
          llmConfigs: mergeLlmConfigs(defaultSettings.llmConfigs, (parsed as AppSettings).llmConfigs)
        }
      }
    } catch {
      this.settings = { ...defaultSettings }
    }
    return this.settings
  }

  async save(settings: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...settings }
    try {
      writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save settings:', error)
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

  // === LLM 配置管理 ===
  getLlmConfigs() {
    return this.settings.llmConfigs
  }

  getActiveLlmId(): string {
    return this.settings.activeLlmId
  }

  setActiveLlmId(id: string): void {
    this.settings.activeLlmId = id
    this.saveNow()
  }

  getCleanPrompt(): string {
    return this.settings.cleanPrompt
  }

  getCleanRules() {
    return this.settings.cleanRules ?? DEFAULT_CLEAN_RULES
  }

  private saveNow(): void {
    try {
      writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch {
      // ignore
    }
  }
}
