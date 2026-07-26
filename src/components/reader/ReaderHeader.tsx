import type { ReactNode } from 'react'
import ModeSwitch from './ModeSwitch'

interface ReaderHeaderProps {
  /** 左侧内容：章节选择器等 */
  left?: ReactNode
  /** 右侧内容：工具按钮 */
  right?: ReactNode
  /** 沉浸模式隐藏整个顶栏 */
  immersive?: boolean
}

/**
 * 阅读器统一顶栏：左=章节/导航  中=模式切换  右=工具按钮
 * 两个模式（AI阅读/听书）共用此布局壳，各自传入自己的 left/right。
 */
export default function ReaderHeader({ left, right, immersive = false }: ReaderHeaderProps) {
  if (immersive) return null

  return (
    <header className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 sm:px-3 dark:border-dark-border dark:bg-dark-surface">
      {/* 左：章节选择等 */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {left}
      </div>

      {/* 中：模式切换，始终居中 */}
      <div className="flex-shrink-0">
        <ModeSwitch />
      </div>

      {/* 右：工具按钮 */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
        {right}
      </div>
    </header>
  )
}
