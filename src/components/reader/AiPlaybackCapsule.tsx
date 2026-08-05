import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { PlayState } from '../../global'
import { useBookStore } from '../../stores/bookStore'
import { usePlayerStore } from '../../stores/playerStore'

type ReaderMode = 'ai-reading' | 'listening'

/** @deprecated 保留给旧测试/兼容；顶栏模式不再拖拽 */
export function clampPlaybackCapsulePosition(
  position: { x: number; y: number },
  container: { width: number; height: number },
  capsule: { width: number; height: number }
): { x: number; y: number } {
  const margin = 8
  return {
    x: Math.max(margin, Math.min(position.x, container.width - capsule.width - margin)),
    y: Math.max(margin, Math.min(position.y, container.height - capsule.height - margin))
  }
}

export function shouldShowFullPlaybackBar(readerMode: ReaderMode): boolean {
  return readerMode === 'listening'
}

export function shouldShowAiPlaybackCapsule(readerMode: ReaderMode): boolean {
  return readerMode === 'ai-reading'
}

interface AiPlaybackCapsuleProps {
  /** 可选：不传则组件内自订阅 store（推荐，避免 App 每句重渲染） */
  playState?: PlayState
  currentSentencePreview?: string
  onPlay: () => void
  onPause: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
  /** 顶栏内嵌（默认）或独立条 */
  variant?: 'header' | 'bar'
}

/**
 * AI 阅读模式播放控件：固定在阅读顶栏。
 * 主色描边/底，避免在花背景上发「死灰」。
 */
export default function AiPlaybackCapsule({
  playState: playStateProp,
  currentSentencePreview: previewProp,
  onPlay,
  onPause,
  onPrevSentence,
  onNextSentence,
  variant = 'header'
}: AiPlaybackCapsuleProps) {
  const storePlayState = usePlayerStore((s) => s.playState)
  const currentSentenceIndex = usePlayerStore((s) => s.currentSentenceIndex)
  const sentences = useBookStore((s) => s.sentences)
  const playState = playStateProp ?? storePlayState
  const currentSentencePreview =
    previewProp ??
    sentences[currentSentenceIndex]?.trim() ??
    '点击正文句子设定起点，再按播放'
  const playing = playState === 'playing'

  const preview = (currentSentencePreview || '').replace(/\s+/g, ' ').trim()
  const previewText = preview
    ? preview.length > 24
      ? `${preview.slice(0, 24)}…`
      : preview
    : '点击正文设定起点'

  const isHeader = variant === 'header'
  // 胶囊整体中性透明；只有主播放键用主题色点缀
  const sideBtn =
    'flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-primary/10 hover:text-primary dark:text-gray-400'

  return (
    <div
      data-ai-playback-capsule="true"
      data-playback-variant={variant}
      className={
        isHeader
          ? 'flex h-7 max-w-[min(18rem,42vw)] items-center gap-0.5 rounded-md border border-black/5 bg-black/[0.03] px-0.5 dark:border-white/10 dark:bg-white/[0.06]'
          : 'flex h-9 items-center gap-0.5 rounded-lg border border-black/5 bg-black/[0.03] px-1 dark:border-white/10 dark:bg-white/[0.06]'
      }
      title={preview || '点击正文句子设定播放起点，再按播放'}
    >
      <button type="button" onClick={onPrevSentence} className={sideBtn} title="上一句" aria-label="上一句">
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[rgb(var(--on-primary-rgb))] shadow-sm transition-opacity hover:opacity-90"
        title={playing ? '暂停' : `播放：${previewText}`}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
      </button>
      <button type="button" onClick={onNextSentence} className={sideBtn} title="下一句" aria-label="下一句">
        <SkipForward className="h-3.5 w-3.5" />
      </button>
      <span
        data-playback-preview="true"
        className="mr-1 hidden min-w-0 max-w-[9rem] truncate text-[10px] text-gray-500 dark:text-gray-400 md:inline"
      >
        {previewText}
      </span>
    </div>
  )
}
