import { useState, useEffect } from 'react'
import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'

export default function TitleBar() {
  const [isMaximized, setMaximized] = useState(false)
  const { settings, setTheme } = useSettingsStore()

  useEffect(() => {
    window.api?.windowSetAlwaysOnTop(settings.windowAlwaysOnTop)
    window.api?.windowSetOpacity(settings.windowOpacity)
  }, [])

  useEffect(() => {
    const syncState = async () => {
      const maximized = await window.api?.windowIsMaximized()
      if (typeof maximized === 'boolean') setMaximized(maximized)
    }
    syncState()
    window.addEventListener('resize', syncState)
    return () => window.removeEventListener('resize', syncState)
  }, [])

  const handleMinimize = () => window.api?.windowMinimize()
  const handleMaximize = () => window.api?.windowMaximize()
  const handleClose = () => window.api?.windowClose()

  return (
    <div className="titlebar-drag flex items-center justify-between h-10 px-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 select-none">
      {/* Left: App icon + name */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
          <span className="text-white text-xs font-bold">听</span>
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">听伴</span>
      </div>

      {/* Right: Quick controls + Window buttons */}
      <div className="flex items-center gap-1 titlebar-no-drag">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
          className="titlebar-no-drag w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title={settings.theme === 'light' ? '切换深色模式' : '切换浅色模式'}
        >
          {settings.theme === 'light' ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
        </button>

        {/* Window control buttons */}
        <button
          onClick={handleMinimize}
          className="titlebar-no-drag w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="titlebar-no-drag w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {isMaximized ? (
            <Maximize2 className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="titlebar-no-drag w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:text-white hover:bg-red-500 dark:text-gray-400 dark:hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
