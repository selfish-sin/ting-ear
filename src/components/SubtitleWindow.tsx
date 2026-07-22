import { useEffect, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, Home, Minus, Plus } from 'lucide-react'
import type { SubtitleStyle } from '../global'

/**
 * 桌面字幕窗口组件。通过 hash=#/subtitle 加载。
 *
 * 带播放控制按钮的桌面字幕条：
 * - 上方：书名·章节 + 当前句子文本（完整显示，不截断）
 * - 下方：播放/暂停 | 上一句 | 下一句 | 打开主窗口 | 关闭字幕
 * - 可拖拽移动、可拉伸调整大小
 */
export function SubtitleWindow() {
  const [text, setText] = useState('')
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 20,
    fontColor: '#FFFFFF',
    bgColor: 'rgba(0, 0, 0, 0.80)',
    opacity: 0.95,
    maxWidth: 960
  })
  const [chapterTitle, setChapterTitle] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  const [progress, setProgress] = useState(0)

  const electron = typeof window !== 'undefined'
    ? (window.electron as unknown as {
        ipcRenderer: {
          invoke: (ch: string, ...args: unknown[]) => Promise<unknown>
          on: (ch: string, cb: (...args: unknown[]) => void) => void
          removeAllListeners: (ch: string) => void
        }
      })
    : null

  // 透明背景
  useEffect(() => {
    const prevBody = document.body.style.background
    const prevHtml = document.documentElement.style.background
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.style.background = prevBody
      document.documentElement.style.background = prevHtml
    }
  }, [])

  // 监听字幕更新
  useEffect(() => {
    if (!electron) return

    const updateHandler = (_e: unknown, data: {
      text?: string
      bookTitle?: string
      chapterTitle?: string
      style?: Partial<SubtitleStyle>
    }) => {
      if (data.style) setSubtitleStyle((prev) => ({ ...prev, ...data.style }))
      if (data.bookTitle !== undefined) setBookTitle(data.bookTitle)
      if (data.chapterTitle !== undefined) setChapterTitle(data.chapterTitle)
      if (data.text !== undefined && data.text !== '') setText(data.text)
    }
    electron.ipcRenderer.on('subtitle:update', updateHandler as (...args: unknown[]) => void)

    // 监听播放状态
    const stateHandler = (_e: unknown, data: {
      isPlaying?: boolean
      hasContent?: boolean
      progressPercent?: number
    }) => {
      if (data.isPlaying !== undefined) setIsPlaying(data.isPlaying)
      if (data.hasContent !== undefined) setHasContent(data.hasContent)
      if (data.progressPercent !== undefined) setProgress(data.progressPercent)
    }
    electron.ipcRenderer.on('subtitle:state', stateHandler as (...args: unknown[]) => void)

    // 请求初始样式
    electron.ipcRenderer.invoke('subtitle:getStyle').then((s) => {
      if (s) setSubtitleStyle((prev) => ({ ...prev, ...(s as SubtitleStyle) }))
    }).catch(() => {})

    return () => {
      electron.ipcRenderer.removeAllListeners('subtitle:update')
      electron.ipcRenderer.removeAllListeners('subtitle:state')
    }
  }, [electron])

  // 播放控制
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      electron?.ipcRenderer.invoke('subtitle:pause').catch(() => {})
    } else {
      electron?.ipcRenderer.invoke('subtitle:play').catch(() => {})
    }
  }, [electron, isPlaying])

  const prevSentence = useCallback(() => {
    electron?.ipcRenderer.invoke('subtitle:prev').catch(() => {})
  }, [electron])

  const nextSentence = useCallback(() => {
    electron?.ipcRenderer.invoke('subtitle:next').catch(() => {})
  }, [electron])

  const openMain = useCallback(() => {
    electron?.ipcRenderer.invoke('subtitle:openMain').catch(() => {})
  }, [electron])

  const closeSubtitle = useCallback(() => {
    electron?.ipcRenderer.invoke('subtitle:hide').catch(() => {})
  }, [electron])

  // 字号缩放
  const fontScale = useCallback((delta: number) => {
    setSubtitleStyle((prev) => {
      const next = Math.max(12, Math.min(48, prev.fontSize + delta))
      const updated = { ...prev, fontSize: next }
      // 同步到主进程
      electron?.ipcRenderer.invoke('subtitle:setStyle', { fontSize: next }).catch(() => {})
      return updated
    })
  }, [electron])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    electron?.ipcRenderer.invoke('subtitle:showContextMenu').catch(() => {})
  }, [electron])

  const dragRegion = { WebkitAppRegion: 'drag' } as unknown as React.CSSProperties
  const noDrag = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties

  const s = subtitleStyle

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{
        borderRadius: 14,
        background: s.bgColor,
        opacity: s.opacity,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.06) inset',
        border: '1.5px solid rgba(255,255,255,0.18)',
        color: '#F3F4F6',
        userSelect: 'none',
      }}
      onContextMenu={handleContextMenu}
    >
      {/* === 顶部拖拽栏 === */}
      <div
        className="flex items-center px-3 py-2 flex-shrink-0"
        style={{
          ...dragRegion,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          cursor: 'grab',
        }}
        onDoubleClick={openMain}
      >
        {/* 书名·章节 */}
        <div className="flex-1 min-w-0">
          <span
            style={{
              fontSize: Math.max(10, Math.round(s.fontSize * 0.36)),
              color: 'rgba(255,255,255,0.45)',
              fontWeight: 400,
            }}
            className="truncate"
          >
            {bookTitle ? `${bookTitle}` : '听伴字幕'}
            {chapterTitle ? ` · ${chapterTitle}` : ''}
          </span>
        </div>
        {/* 进度条 */}
        <div
          className="flex-shrink-0 ml-2"
          style={{ width: 60, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, ...noDrag }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              borderRadius: 2,
              background: '#3B82F6',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>

      {/* === 文本区（自适应高度，完整显示） === */}
      <div
        className="flex-1 flex px-4 py-2 overflow-y-auto"
        style={{
          ...dragRegion,
          cursor: 'grab',
          alignItems: 'flex-start',
          minHeight: 0,
        }}
      >
        <div
          style={{
            fontSize: s.fontSize,
            color: s.fontColor,
            fontWeight: 500,
            lineHeight: 1.6,
            textShadow: '0 1px 6px rgba(0,0,0,0.5)',
            wordBreak: 'break-word',
            width: '100%',
          }}
        >
          {text || (hasContent ? '准备就绪' : '听伴字幕')}
        </div>
      </div>

      {/* === 控制栏 === */}
      <div
        className="flex items-center justify-center gap-2 px-3 py-1.5 flex-shrink-0"
        style={{
          ...noDrag,
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <CtrlBtn title="上一句" onClick={prevSentence} disabled={!hasContent}>
          <SkipBack style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>

        <button
          onClick={togglePlay}
          disabled={!hasContent}
          title={isPlaying ? '暂停' : '播放'}
          className="flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9999,
            background: isPlaying ? '#3B82F6' : 'rgba(75,85,99,0.8)',
            border: 'none',
            cursor: hasContent ? 'pointer' : 'default',
            opacity: hasContent ? 1 : 0.4,
          }}
        >
          {isPlaying ? (
            <Pause style={{ width: 16, height: 16, color: '#fff' }} fill="currentColor" />
          ) : (
            <Play style={{ width: 16, height: 16, color: '#fff', marginLeft: 2 }} fill="currentColor" />
          )}
        </button>

        <CtrlBtn title="下一句" onClick={nextSentence} disabled={!hasContent}>
          <SkipForward style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />

        {/* 字号缩放 */}
        <CtrlBtn title="缩小字号" onClick={() => fontScale(-2)}>
          <Minus style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>
        <CtrlBtn title="放大字号" onClick={() => fontScale(2)}>
          <Plus style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />

        <CtrlBtn title="打开主窗口" onClick={openMain}>
          <Home style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>

        <CtrlBtn title="关闭字幕" onClick={closeSubtitle}>
          <X style={{ width: 14, height: 14, color: '#9CA3AF' }} />
        </CtrlBtn>
      </div>
    </div>
  )
}

/** 小型控制按钮 */
function CtrlBtn({
  children,
  onClick,
  title,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center flex-shrink-0 transition-colors"
      style={{
        width: 26,
        height: 26,
        borderRadius: 9999,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.3 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

export default SubtitleWindow
