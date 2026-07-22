import { useEffect, useState, useCallback, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Headphones, Minimize2 } from 'lucide-react'
import type { PlayerSnapshot } from '../global'

/* ====== 类型 ====== */
type FBMode = 'ball' | 'mini' // 'ball' = 260x56 胶囊；'mini' = 320x120 迷你播放器

interface FBState extends PlayerSnapshot {
  locked?: boolean
  nearbySentences?: Array<{ index: number; text: string; isCurrent: boolean }>
}

/* ====== 常量 ====== */
const DOUBLE_CLICK_MS = 300 // 双击间隔
const SINGLE_CLICK_DELAY_MS = 220 // 单击延迟：等双击判定窗口过了再触发单击动作

/* ====== Electron IPC helper ====== */
const electron = typeof window !== 'undefined'
  ? (window.electron as unknown as {
      ipcRenderer: {
        invoke: (ch: string, ...args: unknown[]) => Promise<unknown>
        on: (ch: string, cb: (...args: unknown[]) => void) => void
      }
    })
  : null

/**
 * 独立悬浮球窗口组件。通过 hash=#/floating 加载。
 *
 * 设计原则（v3 方案）：
 *   - 单一胶囊形态 260×56，左 56px 拖拽区（系统原生 drag）、中 120px 信息区、右 84px 控制区。
 *   - 严禁 JS 距离判断拖拽，全部交给 -webkit-app-region。
 *   - 仅在用户主动展开时切换为 320×120 迷你播放器。
 */
export function FloatingBallWindow() {
  const [mode, setMode] = useState<FBMode>('ball')
  const [state, setState] = useState<FBState>({
    hasContent: false,
    isPlaying: false,
    isLoading: false,
    error: null,
    bookTitle: '',
    chapterTitle: '',
    currentSentenceText: '',
    progressPercent: 0,
    locked: false
  })

  // 单击/双击判定
  const lastClickTimeRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ====== 透明窗口背景 ======
  // index.html 的 body 默认带 bg-white，会让 transparent 窗口变成白色矩形。
  // 悬浮球窗口需要把 body 背景清空，让窗口真正透明。
  useEffect(() => {
    const prev = document.body.style.background
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.style.background = prev
      document.documentElement.style.background = ''
    }
  }, [])

  // ====== 窗口尺寸同步 ======
  const syncWindowSize = useCallback((newMode: FBMode) => {
    electron?.ipcRenderer.invoke('floatingball:resize', newMode).catch(() => {})
    electron?.ipcRenderer.invoke('floatingball:setMode', newMode).catch(() => {})
  }, [])

  useEffect(() => {
    syncWindowSize(mode)
  }, [mode, syncWindowSize])

  // ====== 监听主进程状态广播 ======
  useEffect(() => {
    if (!electron) return
    const handler = (_e: unknown, s: Partial<FBState>) => {
      setState((prev) => ({ ...prev, ...s }))
    }
    electron.ipcRenderer.on('fb:update-state', handler as (...args: unknown[]) => void)

    // 监听命令（右键菜单触发）
    const cmdHandler = (_e: unknown, cmd: string) => {
      if (cmd === 'openMiniPlayer') {
        setMode('mini')
      } else if (cmd === 'toggleLock') {
        setState((prev) => ({ ...prev, locked: !prev.locked }))
      }
      // opacityChanged 由主进程直接设置，无需处理
    }
    electron.ipcRenderer.on('fb:command', cmdHandler as (...args: unknown[]) => void)
  }, [electron])

  // ====== 播放控制命令 ======
  // 注意：走 floatingball:play / floatingball:pause 而非 togglePlay。
  // 主窗口只监听了 fb:play / fb:pause（见 App.tsx onFloatingBallPlay/Pause），
  // 没有接 fb:toggle-play，用 toggle 通道会静默失效。
  const togglePlay = useCallback(() => {
    // 无书 → 打开主窗口
    if (!state.hasContent) {
      electron?.ipcRenderer.invoke('floatingball:expand')
      return
    }
    if (state.isLoading) return // 加载中不响应
    // 不做乐观更新：等主窗口回传 snapshot（fb:update-state）再刷新，
    // 避免 play() 失败（如未导书）时小球卡在"播放中"假状态。
    if (state.isPlaying) {
      electron?.ipcRenderer.invoke('floatingball:pause')
    } else {
      electron?.ipcRenderer.invoke('floatingball:play')
    }
  }, [state.hasContent, state.isLoading, state.isPlaying])

  const prevSentence = useCallback(() => {
    electron?.ipcRenderer.invoke('floatingball:prev')
  }, [])

  const nextSentence = useCallback(() => {
    electron?.ipcRenderer.invoke('floatingball:next')
  }, [])

  const expandMainWindow = useCallback(() => {
    electron?.ipcRenderer.invoke('floatingball:expand')
  }, [])

  const collapseToBall = useCallback(() => {
    setMode('ball')
  }, [])

  const seekToSentence = useCallback((index: number) => {
    electron?.ipcRenderer.invoke('floatingball:seekTo', index)
  }, [])

  // ====== 信息区单击/双击 ======
  // 单击 → 220ms 内若无第二次点击则触发"播放/暂停"（v3 §6.3）
  // 双击 → 取消待执行的单击，展开主窗口
  const handleInfoClick = useCallback(() => {
    const now = Date.now()
    const elapsed = now - lastClickTimeRef.current
    lastClickTimeRef.current = now

    // 在双击窗口内到来的第二次点击：交由 onDoubleClick 处理，取消等待中的单击
    if (elapsed < DOUBLE_CLICK_MS) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      return
    }

    // 首次点击：延迟 SINGLE_CLICK_DELAY_MS 后触发播放/暂停；
    // 若用户在这段时间内再次点击（即上面分支），则取消。
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      togglePlay()
    }, SINGLE_CLICK_DELAY_MS)
  }, [togglePlay])

  const handleInfoDoubleClick = useCallback(() => {
    // 双击取消任何待执行的单击动作
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    expandMainWindow()
  }, [expandMainWindow])

  // ====== 右键菜单（委托主进程） ======
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      electron?.ipcRenderer.invoke('floatingball:showContextMenu', {
        hasContent: state.hasContent,
        isPlaying: state.isPlaying,
        locked: state.locked
      })
    },
    [state.hasContent, state.isPlaying, state.locked]
  )

  // 避免 WebkitAppRegion 在 TS 报错
  const dragRegion = { WebkitAppRegion: 'drag' } as unknown as React.CSSProperties
  const noDragRegion = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties

  const locked = !!state.locked

  /* ============== 渲染：胶囊态（ball） ============== */
  if (mode === 'ball') {
    const cover = (state.bookTitle || '听').charAt(0) || '听'
    return (
      <div
        className="w-full h-full flex items-stretch overflow-hidden"
        style={{
          borderRadius: 14,
          background: 'rgba(17, 24, 39, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          color: '#F3F4F6',
          userSelect: 'none'
        }}
        onContextMenu={handleContextMenu}
      >
        {/* 左：拖拽区 56px —— 系统原生 drag，不含点击事件 */}
        <div
          className="flex items-center justify-center flex-shrink-0 relative"
          style={{
            width: 56,
            height: 56,
            ...(locked ? noDragRegion : dragRegion),
            cursor: locked ? 'default' : 'grab'
          }}
          title={locked ? '位置已锁定' : '拖动移动位置'}
        >
          <div
            className="rounded-lg flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              background: 'rgba(59, 130, 246, 0.18)',
              border: '1px solid rgba(59, 130, 246, 0.35)'
            }}
          >
            {state.hasContent ? (
              <span style={{ color: '#93C5FD', fontSize: 16, fontWeight: 600 }}>{cover}</span>
            ) : (
              <Headphones className="w-4 h-4 text-gray-400" />
            )}
          </div>
        </div>

        {/* 中：信息区 120px —— no-drag，双击展开主窗口 */}
        <div
          className="flex flex-col justify-center min-w-0 flex-1 px-2 relative"
          style={{ ...noDragRegion, cursor: 'pointer', width: 120 }}
          onClick={handleInfoClick}
          onDoubleClick={handleInfoDoubleClick}
        >
          <div
            className="text-[12px] font-medium truncate leading-tight"
            style={{ color: '#F3F4F6' }}
          >
            {state.bookTitle || '还没有选择书籍'}
          </div>
          <div
            className="text-[10px] truncate leading-tight mt-0.5"
            style={{ color: '#9CA3AF' }}
          >
            {state.hasContent ? state.chapterTitle || '未知章节' : '点击打开听伴'}
          </div>
          {/* 2px 进度条 */}
          <div
            className="absolute left-2 right-2 bottom-1 rounded-full overflow-hidden"
            style={{ height: 2, background: 'rgba(255,255,255,0.10)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${state.progressPercent}%`, background: '#3B82F6' }}
            />
          </div>
        </div>

        {/* 右：控制区 84px —— no-drag，三个 28×28 按钮 */}
        <div
          className="flex items-center justify-center gap-1 flex-shrink-0 px-1"
          style={{ ...noDragRegion, width: 84 }}
        >
          <CtrlButton title="上一句" onClick={prevSentence} disabled={!state.hasContent}>
            <SkipBack className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
          </CtrlButton>

          <button
            onClick={togglePlay}
            title={state.isPlaying ? '暂停' : '播放'}
            className="flex items-center justify-center flex-shrink-0 transition-colors"
            style={{
              width: 28,
              height: 28,
              borderRadius: 9999,
              background: state.isPlaying ? '#3B82F6' : state.error ? '#EF4444' : '#4B5563'
            }}
          >
            {state.isLoading ? <Spinner /> : state.isPlaying ? (
              <Pause className="w-3.5 h-3.5 text-white" fill="currentColor" />
            ) : (
              <Play className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" />
            )}
          </button>

          <CtrlButton title="下一句" onClick={nextSentence} disabled={!state.hasContent}>
            <SkipForward className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
          </CtrlButton>
        </div>

        {/* 错误指示红点 */}
        {state.error && (
          <div
            className="absolute rounded-full"
            style={{
              top: 6,
              right: 6,
              width: 6,
              height: 6,
              background: '#EF4444',
              boxShadow: '0 0 0 2px rgba(17,24,39,0.9)'
            }}
          />
        )}
      </div>
    )
  }

  /* ============== 渲染：迷你播放器（mini） ============== */
  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{
        borderRadius: 12,
        background: 'rgba(17, 24, 39, 0.90)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        color: '#F3F4F6',
        userSelect: 'none'
      }}
    >
      {/* 顶部标题栏 —— 系统 drag */}
      <div
        className="flex items-center px-2.5 py-1.5 border-b"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.06)',
          ...(locked ? noDragRegion : dragRegion),
          cursor: locked ? 'default' : 'grab'
        }}
        onDoubleClick={expandMainWindow}
        onContextMenu={handleContextMenu}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium truncate text-white">
            {state.bookTitle || '听伴'}
          </p>
          {state.chapterTitle && (
            <p className="text-[9px] truncate text-gray-400">{state.chapterTitle}</p>
          )}
        </div>
        {/* 收起为小球（不是退出！） */}
        <button
          onClick={collapseToBall}
          className="ml-1 rounded hover:bg-white/10 flex items-center justify-center"
          style={{ ...noDragRegion, width: 20, height: 20 }}
          title="收起为胶囊"
        >
          <Minimize2 className="w-3 h-3 text-gray-400" />
        </button>
      </div>

      {/* 进度条 */}
      <div className="px-2.5 py-1.5" style={noDragRegion}>
        <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.10)' }}>
          <div
            className="h-full rounded-full transition-all duration-150"
            style={{ width: `${state.progressPercent}%`, background: '#3B82F6' }}
          />
        </div>
      </div>

      {/* 句子列表（4句窗口，当前句高亮，点击跳转） */}
      <div className="flex-1 flex flex-col justify-center px-2.5 py-0.5 overflow-hidden" style={noDragRegion}>
        {(state.nearbySentences && state.nearbySentences.length > 0) ? (
          <div className="flex flex-col gap-0.5">
            {state.nearbySentences.map((s) => (
              <button
                key={s.index}
                onClick={() => seekToSentence(s.index)}
                className="text-left text-[11px] leading-tight px-1.5 py-0.5 rounded truncate transition-colors"
                style={{
                  color: s.isCurrent ? '#F3F4F6' : '#9CA3AF',
                  background: s.isCurrent ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                  borderLeft: s.isCurrent ? '2px solid #3B82F6' : '2px solid transparent',
                }}
                title={s.text}
              >
                {s.text}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-gray-500 text-center">无内容</p>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-3 px-2 py-1" style={noDragRegion}>
        <button
          onClick={prevSentence}
          disabled={!state.hasContent}
          className="rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          style={{ width: 24, height: 24 }}
          title="上一句"
        >
          <SkipBack className="w-3 h-3 text-gray-300" />
        </button>
        <button
          onClick={togglePlay}
          className="rounded-full flex items-center justify-center shadow-md transition-colors"
          style={{
            width: 32,
            height: 32,
            background: state.isPlaying ? '#3B82F6' : state.error ? '#EF4444' : '#4B5563'
          }}
          title="播放/暂停"
        >
          {state.isLoading ? <Spinner /> : state.isPlaying ? (
            <Pause className="w-4 h-4 text-white" fill="currentColor" />
          ) : (
            <Play className="w-4 h-4 text-white ml-0.5" fill="currentColor" />
          )}
        </button>
        <button
          onClick={nextSentence}
          disabled={!state.hasContent}
          className="rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          style={{ width: 24, height: 24 }}
          title="下一句"
        >
          <SkipForward className="w-3 h-3 text-gray-300" />
        </button>
      </div>
    </div>
  )
}

/* ====== 子组件 ====== */

/** 控制按钮（无背景圆形） */
function CtrlButton({
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
      className="flex items-center justify-center flex-shrink-0 rounded-full hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ width: 28, height: 28 }}
    >
      {children}
    </button>
  )
}

/** 加载旋转圈 */
function Spinner() {
  return (
    <div
      className="rounded-full"
      style={{
        width: 14,
        height: 14,
        border: '2px solid rgba(255,255,255,0.8)',
        borderTopColor: 'transparent',
        animation: 'spin 0.8s linear infinite'
      }}
    />
  )
}

/* 默认导出保留空组件（兼容旧引用），实际不再使用 */
export default function FloatingBall() {
  return null
}
