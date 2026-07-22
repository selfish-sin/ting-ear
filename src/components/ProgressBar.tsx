import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import type { Chapter } from '../global'

interface ProgressBarProps {
  onSeek: (sentenceIndex: number) => void
  onPause?: () => void
  onResume?: () => void
}

/** \u6839\u636e\u5b57\u7b26\u6570\u4f30\u7b97\u53e5\u5b50\u65f6\u957f\uff0c\u8003\u8651\u8bed\u901f\u548c\u6807\u70b9\u505c\u987f */
function estimateSentenceDuration(text: string, speed: number = 1.0): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const punctuation = (text.match(/[,\u3002!?\u3001;:\uff0c\uff01\uff1f\uff1b\uff1a]/g) || []).length
  const otherChars = text.replace(/[\u4e00-\u9fff,\u3002!?\u3001;:\uff0c\uff01\uff1f\uff1b\uff1a]/g, '').length

  // \u57fa\u7840\u65f6\u957f\uff1a\u4e2d\u6587\u5b57250ms\uff0c\u6807\u70b9150ms\u505c\u987f\uff0c\u5176\u4ed6\u5b57\u7b26100ms
  const baseDuration = chineseChars * 250 + punctuation * 150 + otherChars * 100

  // \u8bed\u901f\u4fee\u6b63
  return Math.max(500, baseDuration / speed)
}

function formatTime(totalMs: number): string {
  const totalSec = Math.round(totalMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ProgressBar({ onSeek, onPause, onResume }: ProgressBarProps) {
  const { currentSentenceIndex, playState, timeMap, speed, currentChapterIndex, pageIndex, pageSize } = usePlayerStore()
  const { sentences, chapters, currentBook, sentenceRange } = useBookStore()

  const hasChapters = (currentBook?.chapters?.length || 0) > 1

  // 可视窗口（与 PlayerView 保持一致）
  const bounds: { start: number; end: number } = (() => {
    if (!currentBook) return { start: 0, end: 0 }
    const total = currentBook.sentences.length
    if (hasChapters) {
      const ch = currentBook.chapters[currentChapterIndex]
      if (ch) return { start: ch.startIndex, end: Math.min(ch.startIndex + ch.sentenceCount, total) }
    }
    if (sentenceRange) {
      return { start: sentenceRange.start, end: Math.min(sentenceRange.end, total) }
    }
    const start = pageIndex * pageSize
    const end = Math.min(start + pageSize, total)
    return { start, end }
  })()
  const total = Math.max(0, bounds.end - bounds.start) // 窗口内句数（仅用于显示分母）

  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null)
  const [, setHoverX] = useState(0)
  const [wasPlayingBeforeDrag, setWasPlayingBeforeDrag] = useState(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 累积时间表：key=全局句子索引，value=该句起始的累积毫秒。
  const { cumulativeMap, totalDurationMs }: {
    cumulativeMap: Map<number, number>
    totalDurationMs: number
  } = useMemo(() => {
    const map: Map<number, number> = new Map<number, number>()
    let acc = 0
    map.set(bounds.start, 0) // 窗口首句起始 = 0
    for (let i = bounds.start; i < bounds.end; i++) {
      let dur: number
      if (timeMap[i] !== undefined && timeMap[i] > 0) {
        dur = timeMap[i] // 实测时长（全局索引）
      } else {
        dur = estimateSentenceDuration(sentences[i] || '', speed)
      }
      acc += dur
      map.set(i + 1, acc) // i+1 句的起始时间
    }
    return { cumulativeMap: map, totalDurationMs: acc }
  }, [bounds.start, bounds.end, timeMap, sentences, speed])

  // 当前句的累积时间（读全局 currentSentenceIndex）
  const currentTimeMs = cumulativeMap.get(currentSentenceIndex) ?? 0
  // progress 基于实时 totalDurationMs（实测覆盖预估），上限 100%
  const progress = totalDurationMs > 0 ? Math.min((currentTimeMs / totalDurationMs) * 100, 100) : 0

  // Convert mouse X to time in ms
  const xToTime = useCallback(
    (clientX: number): number => {
      if (!trackRef.current || totalDurationMs === 0) return 0
      const rect = trackRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * totalDurationMs
    },
    [totalDurationMs]
  )

  // timeMs → 全局句子索引（在窗口内查找）
  const timeToSentence = useCallback(
    (timeMs: number): number => {
      let lo = bounds.start
      let hi = bounds.end - 1
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2)
        const startMs = cumulativeMap.get(mid) ?? 0
        if (startMs <= timeMs) lo = mid
        else hi = mid - 1
      }
      return Math.min(lo, bounds.end - 1)
    },
    [cumulativeMap, bounds.start, bounds.end]
  )

  // Find chapter for a given sentence index（chapters 是全局，自洽）
  const findChapter = useCallback(
    (sentenceIndex: number): Chapter | null => {
      if (!chapters.length) return null
      for (const ch of chapters) {
        if (sentenceIndex >= ch.startIndex && sentenceIndex < ch.startIndex + ch.sentenceCount) {
          return ch
        }
      }
      return null
    },
    [chapters]
  )

  const handleMouseDown = (e: React.MouseEvent) => {
    // 仅左键触发拖拽，避免右键菜单冲突
    if (e.button !== 0) return
    setIsDragging(true)
    // 记录当前播放状态
    const wasPlaying = playState === 'playing'
    setWasPlayingBeforeDrag(wasPlaying)
    // 拖动开始立即暂停当前音频（onPause 通常映射到 tts.pause）
    if (wasPlaying && onPause) {
      onPause()
    }
    // 立即把光标定位到按下点（预览）
    const time = xToTime(e.clientX)
    setHoverTimeMs(time)
    setHoverX(e.clientX)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const time = xToTime(e.clientX)
    setHoverTimeMs(time)
    setHoverX(e.clientX)
  }

  const handleMouseLeave = () => {
    setHoverTimeMs(null)
  }

  const handleGlobalMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      // 拖动过程中不 seek，只更新 hover 状态用于预览
      const time = xToTime(e.clientX)
      setHoverTimeMs(time)
    },
    [isDragging, xToTime]
  )

  const handleGlobalMouseUp = useCallback(() => {
    // 松手时才执行 seek（新 seekTo 仅移动位置，不强制播放）
    if (isDragging && hoverTimeMs !== null) {
      const idx = timeToSentence(hoverTimeMs)
      onSeek(idx)
    }
    setIsDragging(false)
    setHoverTimeMs(null)
    // 如果拖动前在播放，松手后恢复播放（继续从新位置朗读，而非从头）
    if (wasPlayingBeforeDrag && onResume) {
      // 延迟一点，确保 store 的 currentSentenceIndex 已更新
      resumeTimerRef.current = setTimeout(() => onResume(), 60)
    }
    setWasPlayingBeforeDrag(false)
  }, [isDragging, hoverTimeMs, timeToSentence, onSeek, wasPlayingBeforeDrag, onResume])

  useEffect(() => {
    if (!isDragging) return
    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      // Clean up any pending resume timer
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = null
      }
    }
  }, [isDragging, handleGlobalMouseMove, handleGlobalMouseUp])

  // Chapter info for hover/drag
  const hoverChapter = hoverTimeMs !== null ? findChapter(timeToSentence(hoverTimeMs)) : null
  const currentChapter = findChapter(currentSentenceIndex)

  // Has any actual duration data? (shows if timeMap is populated)
  const hasRealData = timeMap.some((d) => d > 0)

  return (
    <div className="px-3 sm:px-4 pt-2 pb-1.5 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
      {/* Main progress bar */}
      <div
        ref={trackRef}
        className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer group"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all duration-150"
          style={{ width: `${progress}%` }}
        />

        {/* Chapter markers (subtle vertical lines at chapter boundaries).
            chapters 是全局索引；只画落在窗口内的章界。 */}
        {chapters.length > 1 && totalDurationMs > 0 &&
          chapters.slice(0, -1).map((ch, i) => {
            const chapterEnd = ch.startIndex + ch.sentenceCount
            // 只画窗口内、非窗口末端的章界
            if (chapterEnd <= bounds.start || chapterEnd >= bounds.end) return null
            const chapterTime = cumulativeMap.get(chapterEnd) ?? 0
            const pct = (chapterTime / totalDurationMs) * 100
            return (
              <div
                key={i}
                className="absolute top-0 h-full w-[1px] bg-gray-400/30 dark:bg-gray-500/30"
                style={{ left: `${pct}%` }}
                title={chapters[i + 1]?.title || ''}
              />
            )
          })}

        {/* Drag/position knob */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-primary rounded-full shadow-md border-2 border-white dark:border-gray-800 transition-opacity"
          style={{
            left: `${progress}%`,
            marginLeft: '-7px',
            opacity: isDragging || hoverTimeMs !== null ? 1 : 0.6
          }}
        />

        {/* Hover tooltip */}
        {hoverTimeMs !== null && !isDragging && (
          <div
            className="absolute -top-9 bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none transform -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${(hoverTimeMs / totalDurationMs) * 100}%` }}
          >
            {formatTime(hoverTimeMs)}
            {hoverChapter && (
              <span className="text-white/60 ml-1">- {hoverChapter.title}</span>
            )}
          </div>
        )}
      </div>

      {/* Progress text */}
      <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-2">
          <span>{formatTime(currentTimeMs)} / {formatTime(totalDurationMs)}</span>
          {hasRealData && (
            <span className="text-primary/60 text-[10px]">● 实时</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {currentChapter && (
            <span className="text-gray-400 dark:text-gray-500 truncate max-w-[120px]">{currentChapter.title}</span>
          )}
          <span className="tabular-nums">
            第 {sentenceRange ? currentSentenceIndex - bounds.start + 1 : currentSentenceIndex + 1}/{total} 句
          </span>
        </span>
      </div>
    </div>
  )
}
