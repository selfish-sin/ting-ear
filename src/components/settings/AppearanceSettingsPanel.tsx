import { useSettingsStore } from '../../stores/settingsStore'

export default function AppearanceSettingsPanel() {
  const { settings, setTheme, setOpacity, setFontSize } = useSettingsStore()

  return (
            <div className="space-y-5">
              {/* Theme */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">主题</label>
                <div className="flex gap-3">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                        settings.theme === t
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary/30'
                      }`}
                    >
                      {t === 'light' ? '☀️ 浅色' : t === 'dark' ? '🌙 深色' : '💻 跟随系统'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Window opacity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  窗口透明度: {Math.round(settings.windowOpacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0.4"
                  max="1.0"
                  step="0.05"
                  value={settings.windowOpacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Font size */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  正文字号: {settings.fontSize.body}px
                </label>
                <input
                  type="range"
                  min="14"
                  max="24"
                  step="1"
                  value={settings.fontSize.body}
                  onChange={(e) => setFontSize(parseInt(e.target.value), settings.fontSize.title)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  书名字号: {settings.fontSize.title}px
                </label>
                <input
                  type="range"
                  min="16"
                  max="28"
                  step="1"
                  value={settings.fontSize.title}
                  onChange={(e) => setFontSize(settings.fontSize.body, parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

            </div>
  )
}
