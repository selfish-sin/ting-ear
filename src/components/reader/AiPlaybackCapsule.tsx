import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { PlayState } from '../../global'

type ReaderMode = 'ai-reading' | 'listening'

interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const CAPSULE_MARGIN = 8

export function clampPlaybackCapsulePosition(
  position: Point,
  container: Size,
  capsule: Size
): Point {
  return {
    x: Math.max(CAPSULE_MARGIN, Math.min(position.x, container.width - capsule.width - CAPSULE_MARGIN)),
    y: Math.max(CAPSULE_MARGIN, Math.min(position.y, container.height - capsule.height - CAPSULE_MARGIN))
  }
}

export function shouldShowFullPlaybackBar(readerMode: ReaderMode): boolean {
  return readerMode === 'listening'
}

export function shouldShowAiPlaybackCapsule(readerMode: ReaderMode): boolean {
  return readerMode === 'ai-reading'
}

interface AiPlaybackCapsuleProps {
  playState: PlayState
  /** 即将/正在播放的句子预览，让用户知道会从哪句开始 */
  currentSentencePreview?: string
  onPlay: () => void
  onPause: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
}

export default function AiPlaybackCapsule({
  playState,
  currentSentencePreview,
  onPlay,
  onPause,
  onPrevSentence,
  onNextSentence
}: AiPlaybackCapsuleProps) {
  const playing = playState === 'playing'
  const capsuleRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [position, setPosition] = useState<Point | null>(null)
  const [dragging, setDragging] = useState(false)

  const clampToParent = useCallback((next: Point): Point => {
    const capsule = capsuleRef.current
    const parent = capsule?.offsetParent as HTMLElement | null
    if (!capsule || !parent) return next
    return clampPlaybackCapsulePosition(
      next,
      { width: parent.clientWidth, height: parent.clientHeight },
      { width: capsule.offsetWidth, height: capsule.offsetHeight }
    )
  }, [])

  useEffect(() => {
    const handleResize = () => setPosition((current) => current ? clampToParent(current) : current)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampToParent])

  const handleDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const capsule = capsuleRef.current
    const parent = capsule?.offsetParent as HTMLElement | null
    if (!capsule || !parent) return
    const capsuleRect = capsule.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - capsuleRect.left,
      offsetY: event.clientY - capsuleRect.top
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const handleDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    const capsule = capsuleRef.current
    const parent = capsule?.offsetParent as HTMLElement | null
    if (!drag || drag.pointerId !== event.pointerId || !parent) return
    const parentRect = parent.getBoundingClientRect()
    setPosition(clampToParent({
      x: event.clientX - parentRect.left - drag.offsetX,
      y: event.clientY - parentRect.top - drag.offsetY
    }))
  }

  const handleDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const preview = (currentSentencePreview || '').replace(/\s+/g, ' ').trim()
  const previewText = preview
    ? preview.length > 28
      ? `${preview.slice(0, 28)}…`
      : preview
    : '点击正文句子设定起点'

  return (
    <div
      ref={capsuleRef}
      data-ai-playback-capsule="true"
      className="absolute z-40 flex h-11 max-w-[min(22rem,calc(100%-2rem))] items-center gap-0.5 rounded-full border border-gray-200/90 bg-white/95 px-1 shadow-lg shadow-black/10 backdrop-blur-sm dark:border-gray-600 dark:bg-gray-800/95"
      style={position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }}
      title={preview || '点击正文句子设定播放起点，再按播放'}
    >
      <button
        type="button"
        data-playback-drag-handle="true"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className={`flex h-8 w-5 touch-none items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="拖动播放栏"
        aria-label="拖动播放栏"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onPrevSentence}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
        title="上一句"
        aria-label="上一句"
      >
        <SkipBack className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white transition-opacity hover:opacity-90"
        title={playing ? '暂停' : `播放：${previewText}`}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      <button
        type="button"
        onClick={onNextSentence}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
        title="下一句"
        aria-label="下一句"
      >
        <SkipForward className="h-4 w-4" />
      </button>
      <span
        data-playback-preview="true"
        className="mr-2 ml-0.5 hidden min-w-0 max-w-[11rem] truncate text-[11px] text-gray-500 dark:text-gray-400 sm:inline"
      >
        {previewText}
      </span>
    </div>
  )
}
