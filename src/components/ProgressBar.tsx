import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import type { Chapter } from '../global'

interface ProgressBarProps {
  onSeek: (sentenceIndex: number) => void
  onPause?: () => void
  onResume?: () => void
}

function estimateSentenceDuration(text: string, speed: number = 1.0): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const punctuation = (text.match(/[,。!?、;:，！？；：]/g) || []).length
  const otherChars = text.replace(/[\u4e00-\u9fff,。!?、;:，！？；：]/g, '').length
  const baseDuration = chineseChars * 250 + punctuation * 150 + otherChars * 100
  return Math.max(500, baseDuration / speed)
}

function formatTime(totalMs: number): string {
  const totalSec = Math.round(totalMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 紧凑进度条：少占高度，窄屏不挤 */
export default function ProgressBar({ onSeek, onPause, onResume }: ProgressBarProps) {
  const currentSentenceIndex = usePlayerStore((s) => s.currentSentenceIndex)
  const playState = usePlayerStore((s) => s.playState)
  const timeMap = usePlayerStore((s) => s.timeMap)
  const speed = usePlayerStore((s) => s.speed)
  const currentChapterIndex = usePlayerStore((s) => s.currentChapterIndex)
  const pageIndex = usePlayerStore((s) => s.pageIndex)
  const pageSize = usePlayerStore((s) => s.pageSize)
  const sentences = useBookStore((s) => s.sentences)
  const chapters = useBookStore((s) => s.chapters)
  const currentBook = useBookStore((s) => s.currentBook)
  const sentenceRange = useBookStore((s) => s.sentenceRange)

  const hasChapters = (currentBook?.chapters?.length || 0) > 1

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
  const total = Math.max(0, bounds.end - bounds.start)

  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null)
  const [wasPlayingBeforeDrag, setWasPlayingBeforeDrag] = useState(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { cumulativeMap, totalDurationMs }: {
    cumulativeMap: Map<number, number>
    totalDurationMs: number
  } = useMemo(() => {
    const map: Map<number, number> = new Map<number, number>()
    let acc = 0
    map.set(bounds.start, 0)
    for (let i = bounds.start; i < bounds.end; i++) {
      let dur: number
      if (timeMap[i] !== undefined && timeMap[i] > 0) {
        dur = timeMap[i]
      } else {
        dur = estimateSentenceDuration(sentences[i] || '', speed)
      }
      acc += dur
      map.set(i + 1, acc)
    }
    return { cumulativeMap: map, totalDurationMs: acc }
  }, [bounds.start, bounds.end, timeMap, sentences, speed])

  const currentTimeMs = cumulativeMap.get(currentSentenceIndex) ?? 0
  const progress = totalDurationMs > 0 ? (currentTimeMs / totalDurationMs) * 100 : 0

  const xToTime = useCallback(
    (clientX: number) => {
      if (!trackRef.current || totalDurationMs <= 0) return 0
      const rect = trackRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * totalDurationMs
    },
    [totalDurationMs]
  )

  const timeToSentence = useCallback(
    (timeMs: number) => {
      let best = bounds.start
      for (let i = bounds.start; i < bounds.end; i++) {
        const t = cumulativeMap.get(i) ?? 0
        if (t <= timeMs) best = i
        else break
      }
      return best
    },
    [bounds.start, bounds.end, cumulativeMap]
  )

  const findChapter = (sentenceIndex: number): Chapter | null => {
    if (!chapters.length) return null
    return (
      chapters.find(
        (ch) =>
          sentenceIndex >= ch.startIndex && sentenceIndex < ch.startIndex + ch.sentenceCount
      ) || null
    )
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setWasPlayingBeforeDrag(playState === 'playing')
    if (playState === 'playing' && onPause) onPause()
    setIsDragging(true)
    const time = xToTime(e.clientX)
    setHoverTimeMs(time)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) {
      const time = xToTime(e.clientX)
      setHoverTimeMs(time)
    }
  }

  const handleMouseLeave = () => {
    if (!isDragging) setHoverTimeMs(null)
  }

  const handleGlobalMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      setHoverTimeMs(xToTime(e.clientX))
    },
    [isDragging, xToTime]
  )

  const handleGlobalMouseUp = useCallback(() => {
    if (isDragging && hoverTimeMs !== null) {
      onSeek(timeToSentence(hoverTimeMs))
    }
    setIsDragging(false)
    setHoverTimeMs(null)
    if (wasPlayingBeforeDrag && onResume) {
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
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = null
      }
    }
  }, [isDragging, handleGlobalMouseMove, handleGlobalMouseUp])

  const hoverChapter = hoverTimeMs !== null ? findChapter(timeToSentence(hoverTimeMs)) : null
  const displayProgress =
    isDragging && hoverTimeMs !== null && totalDurationMs > 0
      ? (hoverTimeMs / totalDurationMs) * 100
      : progress

  const relIndex = Math.max(
    1,
    Math.min(total, currentSentenceIndex - bounds.start + 1)
  )

  return (
    <div className="flex-shrink-0 bg-transparent px-3 sm:px-4 pt-1.5 pb-0.5">
      <div
        ref={trackRef}
        className="group relative h-1.5 cursor-pointer rounded-full bg-black/10 dark:bg-white/15"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* 进度条：主题色点缀 */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-primary transition-all duration-100"
          style={{ width: `${displayProgress}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-sm dark:border-white/90"
          style={{ left: `${displayProgress}%`, marginLeft: '-6px' }}
        />
        {hoverTimeMs !== null && totalDurationMs > 0 && (
          <div
            className="pointer-events-none absolute -top-8 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-white shadow"
            style={{ left: `${(hoverTimeMs / totalDurationMs) * 100}%` }}
          >
            {formatTime(hoverTimeMs)}
            {hoverChapter && <span className="ml-1 text-white/70">{hoverChapter.title}</span>}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-gray-500 dark:text-gray-400 sm:text-[11px]">
        <span>
          {formatTime(isDragging && hoverTimeMs != null ? hoverTimeMs : currentTimeMs)} /{' '}
          {formatTime(totalDurationMs)}
        </span>
        <span>
          {relIndex}/{total || 0} 句
        </span>
      </div>
    </div>
  )
}
