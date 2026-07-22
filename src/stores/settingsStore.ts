import { create } from 'zustand'
import { DEFAULT_CLEAN_RULES } from '../cleanRules'
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from '../shortcuts'
import type { AppSettings, FloatingBallSettings, ShortcutMap } from '../global'

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

interface SettingsState {
  settings: AppSettings

  // Actions
  setSettings: (settings: Partial<AppSettings>) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setOpacity: (opacity: number) => void
  setAlwaysOnTop: (flag: boolean) => void
  setFontSize: (body: number, title: number) => void
  setApiKey: (key: string) => void
  setEndpoint: (endpoint: string) => void
  setFloatingBallEnabled: (enabled: boolean) => void
  setFloatingBallSettings: (partial: Partial<FloatingBallSettings>) => void
  setShortcuts: (shortcuts: ShortcutMap) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
}

function mergeLlmConfigs(
  defaults: AppSettings['llmConfigs'],
  loaded?: AppSettings['llmConfigs']
): AppSettings['llmConfigs'] {
  // 首次运行（无已存配置）才播种默认预设；之后完全信任用户配置，删除 / 编辑均持久化
  if (!loaded || !Array.isArray(loaded) || loaded.length === 0) return defaults
  return loaded
}

export const defaultSettings: AppSettings = {
  ttsEngine: 'edge',
  qwenApiKey: '',
  qwenEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/generation',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  defaultSpeed: 1.0,
  defaultVolume: 0.8,
  windowAlwaysOnTop: true,
  windowOpacity: 0.95,
  floatingBallEnabled: true,
  floatingBall: defaultFloatingBall,
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
      name: 'DeepSeek V4 Flash（云端）',
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
      model: 'glm-4.5-air',
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,

  setSettings: (partial) => {
    set((s) => ({ settings: { ...s.settings, ...partial } }))
    // 自动持久化
    get().saveSettings()
  },

  setTheme: (theme) => {
    set((s) => ({ settings: { ...s.settings, theme } }))
    get().saveSettings()
  },

  setOpacity: (opacity) => {
    window.api?.windowSetOpacity(opacity)
    set((s) => ({ settings: { ...s.settings, windowOpacity: opacity } }))
    get().saveSettings()
  },

  setAlwaysOnTop: (flag) => {
    window.api?.windowSetAlwaysOnTop(flag)
    set((s) => ({ settings: { ...s.settings, windowAlwaysOnTop: flag } }))
    get().saveSettings()
  },

  setFontSize: (body, title) => {
    set((s) => ({
      settings: { ...s.settings, fontSize: { body, title } }
    }))
    get().saveSettings()
  },

  setApiKey: (qwenApiKey) => {
    set((s) => ({ settings: { ...s.settings, qwenApiKey } }))
    get().saveSettings()
  },

  setEndpoint: (qwenEndpoint) => {
    set((s) => ({ settings: { ...s.settings, qwenEndpoint } }))
    get().saveSettings()
  },

  setFloatingBallEnabled: (floatingBallEnabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        floatingBallEnabled,
        floatingBall: { ...s.settings.floatingBall, enabled: floatingBallEnabled }
      }
    }))
    if (floatingBallEnabled) window.api?.showFloatingBall()
    else window.api?.hideFloatingBall()
    get().saveSettings()
  },

  setFloatingBallSettings: (partial) => {
    set((s) => ({
      settings: {
        ...s.settings,
        floatingBall: { ...s.settings.floatingBall, ...partial }
      }
    }))
    get().saveSettings()
  },

  setShortcuts: (shortcuts) => {
    const normalized = normalizeShortcuts(shortcuts)
    set((s) => ({ settings: { ...s.settings, shortcuts: normalized } }))
    // 立即同步到主进程，使全局快捷键即时生效
    window.api?.applyShortcuts(normalized as Record<string, string>)
    get().saveSettings()
  },

  loadSettings: async () => {
    try {
      const loaded = await window.api?.loadSettings()
      if (loaded) {
        // Merge with defaults, including new floatingBall sub-object
        const mergedFloatingBall = {
          ...defaultFloatingBall,
          ...((loaded as AppSettings).floatingBall || {}),
          position: {
            ...defaultFloatingBall.position,
            ...(((loaded as AppSettings).floatingBall as FloatingBallSettings | undefined)?.position || {})
          }
        }
        set({
          settings: {
            ...defaultSettings,
            ...loaded,
            floatingBall: mergedFloatingBall,
            shortcuts: normalizeShortcuts((loaded as AppSettings).shortcuts),
            // 确保默认模型不被旧配置覆盖
            llmConfigs: mergeLlmConfigs(defaultSettings.llmConfigs, (loaded as AppSettings).llmConfigs) as AppSettings['llmConfigs']
          }
        })
        // Apply window settings
        const opacity = (loaded as AppSettings).windowOpacity ?? defaultSettings.windowOpacity
        const alwaysOnTop = (loaded as AppSettings).windowAlwaysOnTop ?? defaultSettings.windowAlwaysOnTop
        window.api?.windowSetOpacity(opacity)
        window.api?.windowSetAlwaysOnTop(alwaysOnTop)
      }
    } catch {
      // Use defaults
    }
  },

  saveSettings: async () => {
    try {
      await window.api?.saveSettings(get().settings)
    } catch {
      // Ignore save errors
    }
  }
}))
