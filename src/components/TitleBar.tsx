import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy, Moon, Sun, Maximize2, Minimize2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'

interface TitleBarProps {
  /** 沉浸阅读时：极简透明，仅保留窗控 */
  immersive?: boolean
  /** 传入时显示沉浸切换按钮（仅播放器视图传） */
  onToggleImmersive?: () => void
}

/**
 * 最顶系统栏：拖拽区 + 主题 + 窗口按钮。
 * 仿原生 Windows 无边框窗：右侧按钮占满高度、关闭键悬停变红。
 * 沉浸切换按钮集成在标题栏右侧（窗控左边），不再用 fixed 浮层。
 */
export default function TitleBar({ immersive = false, onToggleImmersive }: TitleBarProps) {
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

  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'system' && !document.documentElement.classList.contains('dark'))

  // 沉浸：透明细条，只保留窗控 + 沉浸退出，不挡正文
  if (immersive) {
    return (
      <div className="titlebar-drag flex items-center justify-end h-7 select-none bg-transparent absolute top-0 left-0 right-0 z-modal">
        <div className="titlebar-no-drag flex items-stretch h-full ml-auto opacity-60 hover:opacity-100 transition-opacity">
          {onToggleImmersive && (
            <button
              onClick={onToggleImmersive}
              className="w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"
              title="退出沉浸"
            >
              <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
          <button
            onClick={handleMinimize}
            className="w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"
            title="最小化"
          >
            <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={handleMaximize}
            className="w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"
            title={isMaximized ? '还原' : '最大化'}
          >
            {isMaximized ? (
              <Copy className="w-3 h-3 rotate-180" strokeWidth={1.75} />
            ) : (
              <Square className="w-3 h-3" strokeWidth={1.75} />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-11 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-red-500 hover:text-white transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`titlebar-drag flex items-stretch h-8 select-none border-b ${
        isLight
          ? 'bg-[#f3f3f3] border-gray-200/80'
          : 'bg-dark-surface border-dark-border'
      }`}
    >
      {/* 左：纯拖拽区（品牌在侧栏，避免双 Logo） */}
      <div className="flex-1 min-w-0" />

      {/* 右：非拖拽控件，贴齐顶角 */}
      <div className="titlebar-no-drag flex items-stretch h-full flex-shrink-0">
        {onToggleImmersive && (
          <button
            onClick={onToggleImmersive}
            className={`w-10 h-full flex items-center justify-center transition-colors ${
              isLight
                ? 'text-gray-500 hover:bg-black/[0.06] hover:text-gray-800'
                : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
            }`}
            title="沉浸模式"
          >
            <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}

        <button
          onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
          className={`w-10 h-full flex items-center justify-center transition-colors ${
            isLight
              ? 'text-gray-500 hover:bg-black/[0.06] hover:text-gray-800'
              : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
          }`}
          title={settings.theme === 'light' ? '切换深色模式' : '切换浅色模式'}
        >
          {settings.theme === 'light' ? (
            <Moon className="w-3.5 h-3.5" strokeWidth={1.75} />
          ) : (
            <Sun className="w-3.5 h-3.5" strokeWidth={1.75} />
          )}
        </button>

        <button
          onClick={handleMinimize}
          className={`w-11 h-full flex items-center justify-center transition-colors ${
            isLight
              ? 'text-gray-500 hover:bg-black/[0.06] hover:text-gray-800'
              : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
          }`}
          title="最小化"
        >
          <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <button
          onClick={handleMaximize}
          className={`w-11 h-full flex items-center justify-center transition-colors ${
            isLight
              ? 'text-gray-500 hover:bg-black/[0.06] hover:text-gray-800'
              : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
          }`}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <Copy className="w-3 h-3" strokeWidth={1.75} style={{ transform: 'scaleX(-1)' }} />
          ) : (
            <Square className="w-3 h-3" strokeWidth={1.75} />
          )}
        </button>

        <button
          onClick={handleClose}
          className={`w-12 h-full flex items-center justify-center transition-colors ${
            isLight
              ? 'text-gray-500 hover:bg-[#e81123] hover:text-white'
              : 'text-gray-400 hover:bg-[#e81123] hover:text-white'
          }`}
          title="关闭"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
