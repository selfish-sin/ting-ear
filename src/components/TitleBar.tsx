import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'

interface TitleBarProps {
  /** 沉浸阅读时：极简透明，仅保留窗控 */
  immersive?: boolean
  /** 传入时显示沉浸切换按钮（仅播放器视图传） */
  onToggleImmersive?: () => void
}

/**
 * 顶栏：拖拽 + 窗控。
 * 半透明叠在真背景上；日夜切换请到「设置 → 常规」（不再放标题栏，避免和背景叠层打架）。
 */
export default function TitleBar({ immersive = false, onToggleImmersive }: TitleBarProps) {
  const [isMaximized, setMaximized] = useState(false)
  const settings = useSettingsStore((s) => s.settings)

  useEffect(() => {
    window.api?.windowSetAlwaysOnTop(settings.windowAlwaysOnTop)
    window.api?.windowSetOpacity(settings.windowOpacity)
  }, [])

  useEffect(() => {
    const syncState = async () => {
      const maximized = await window.api?.windowIsMaximized()
      if (typeof maximized === 'boolean') setMaximized(maximized)
    }
    void syncState()
    window.addEventListener('resize', syncState)
    return () => window.removeEventListener('resize', syncState)
  }, [])

  const handleMinimize = () => window.api?.windowMinimize()
  const handleMaximize = () => window.api?.windowMaximize()
  const handleClose = () => window.api?.windowClose()

  const btn =
    'w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors'
  const btnWide =
    'w-11 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors'

  if (immersive) {
    return (
      <div className="titlebar-drag absolute top-0 left-0 right-0 z-modal flex h-7 select-none items-center justify-end bg-transparent">
        <div className="titlebar-no-drag ml-auto flex h-full items-stretch opacity-60 transition-opacity hover:opacity-100">
          {onToggleImmersive && (
            <button type="button" onClick={onToggleImmersive} className={btn} title="退出沉浸">
              <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
          <button type="button" onClick={handleMinimize} className={btn} title="最小化">
            <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={handleMaximize} className={btn} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? (
              <Copy className="h-3 w-3 rotate-180" strokeWidth={1.75} />
            ) : (
              <Square className="h-3 w-3" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-full w-11 items-center justify-center text-gray-500 transition-colors hover:bg-red-500 hover:text-white dark:text-gray-400"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-chrome titlebar-drag flex h-8 select-none items-stretch border-b border-black/5 bg-white/55 dark:border-white/10 dark:bg-dark-surface/55">
      <div className="min-w-0 flex-1" />
      <div className="titlebar-no-drag flex h-full flex-shrink-0 items-stretch">
        {onToggleImmersive && (
          <button type="button" onClick={onToggleImmersive} className={btn} title="沉浸模式">
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
        <button type="button" onClick={handleMinimize} className={btnWide} title="最小化">
          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={handleMaximize} className={btnWide} title={isMaximized ? '还原' : '最大化'}>
          {isMaximized ? (
            <Copy className="h-3 w-3" strokeWidth={1.75} style={{ transform: 'scaleX(-1)' }} />
          ) : (
            <Square className="h-3 w-3" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-full w-12 items-center justify-center text-gray-500 transition-colors hover:bg-red-500 hover:text-white dark:text-gray-400"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
