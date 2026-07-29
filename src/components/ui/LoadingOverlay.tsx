import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/cn'

export type LoadingOverlayVariant = 'fullscreen' | 'panel' | 'inline'

interface LoadingOverlayProps {
  visible: boolean
  /** 主文案，如「正在打开书架…」 */
  message?: string
  /** 次要说明 */
  detail?: string
  variant?: LoadingOverlayVariant
  className?: string
}

/**
 * 统一加载缓冲层：启动 / 打开书 / 阅读器配件加载时盖住卡顿。
 */
export default function LoadingOverlay({
  visible,
  message = '加载中…',
  detail,
  variant = 'fullscreen',
  className
}: LoadingOverlayProps) {
  if (!visible) return null

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400',
          className
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>{message}</span>
      </div>
    )
  }

  if (variant === 'panel') {
    return (
      <div
        className={cn(
          'absolute inset-0 z-30 flex items-center justify-center bg-white/80 backdrop-blur-[2px] dark:bg-dark-bg/80',
          className
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-primary/20" />
            <Loader2 className="absolute inset-0 m-auto h-12 w-12 animate-spin text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{message}</p>
            {detail ? (
              <p className="mt-1 max-w-xs text-xs text-gray-400 dark:text-gray-500">{detail}</p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // fullscreen
  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center bg-gray-50/95 dark:bg-dark-bg/95',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 px-8 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-pulse" />
          <Loader2 className="relative h-9 w-9 animate-spin text-primary" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-800 dark:text-gray-100">听伴</p>
          <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">{message}</p>
          {detail ? (
            <p className="mt-1 max-w-sm text-xs text-gray-400 dark:text-gray-500">{detail}</p>
          ) : null}
        </div>
        {/* 轻量进度感：不确定进度条 */}
        <div className="h-1 w-40 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="h-full w-1/2 animate-[loading-bar_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  )
}
