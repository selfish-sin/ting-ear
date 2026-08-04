import { create } from 'zustand'
import { DEFAULT_CLEAN_RULES } from '../cleanRules'
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from '../shortcuts'
import type { AppSettings, FloatingBallSettings, ShortcutMap, BackgroundSettings } from '../global'
import { mergeAiSettings } from '../aiSettings'

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

const defaultBackground: BackgroundSettings = {
  enabled: false,
  source: 'preset',
  presetId: null,
  customPath: null,
  fit: 'cover',
  blur: 0,
  overlayColor: 'auto',
  overlayOpacity: 0.7
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
  setBackground: (partial: Partial<BackgroundSettings>) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
}

export const defaultSettings: AppSettings = {
  ttsEngine: 'edge',
  qwenApiKey: '',
  qwenEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-to-speech/generation',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  defaultSpeed: 1.0,
  defaultVolume: 0.8,
  windowAlwaysOnTop: false,
  windowOpacity: 0.95,
  floatingBallEnabled: true,
  floatingBall: defaultFloatingBall,
  theme: 'light',
  fontSize: { body: 16, title: 20 },
  cleanRules: DEFAULT_CLEAN_RULES,
  shortcuts: DEFAULT_SHORTCUTS,
  dataDir: '',
  dataDirHistory: [],
  autoResume: false,
  ai: mergeAiSettings(),
  background: defaultBackground
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

  setBackground: (partial) => {
    set((s) => ({
      settings: {
        ...s.settings,
        background: { ...(s.settings.background ?? defaultBackground), ...partial }
      }
    }))
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
        const loadedSettings = loaded as AppSettings
        set({
          settings: {
            ...defaultSettings,
            ...loadedSettings,
            floatingBall: mergedFloatingBall,
            shortcuts: normalizeShortcuts(loadedSettings.shortcuts),
            cleanRules:
              loadedSettings.cleanRules && loadedSettings.cleanRules.length > 0
                ? loadedSettings.cleanRules
                : DEFAULT_CLEAN_RULES,
            ai: mergeAiSettings(loadedSettings.ai),
            background: { ...defaultBackground, ...(loadedSettings.background || {}) }
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
