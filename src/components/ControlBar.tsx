import { useCallback } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  VolumeX,
  Volume2,
  Minus,
  Plus,
  Camera,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Captions
} from 'lucide-react'
import { usePlayerStore, SPEED_MIN, SPEED_MAX } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import VoiceSelector from './VoiceSelector'
import type { ToastItem } from '../global'

interface ControlBarProps {
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
  onSkipChapter: (direction: -1 | 1) => void
  onToggleFloatingBall?: () => void
  onToggleSubtitle?: () => void
  subtitleEnabled?: boolean
  showToast: (type: ToastItem['type'], message: string) => void
}

export default function ControlBar({
  onPlay,
  onPause,
  onStop,
  onPrevSentence,
  onNextSentence,
  onSkipChapter,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToggleFloatingBall,
  onToggleSubtitle,
  subtitleEnabled,
  showToast
}: ControlBarProps) {
  const {
    playState,
    speed,
    volume,
    isMuted,
    setSpeed,
    setVolume,
    toggleMute,
    useSystemTTS,
    setUseSystemTTS,
    ttsEngine,
    pageIndex,
    pageSize,
    currentChapterIndex,
    currentSentenceIndex
  } = usePlayerStore()
  const { currentBook } = useBookStore()

  const hasChapters = (currentBook?.chapters?.length || 0) > 1

  // 翻章/翻页按钮：父组件处理具体跳转，这里只触发
  const canPrevChapter = hasChapters ? currentChapterIndex > 0 : pageIndex > 0
  const canNextChapter = hasChapters
    ? currentChapterIndex < (currentBook?.chapters?.length || 0) - 1
    : currentBook ? pageIndex < Math.ceil(currentBook.sentences.length / pageSize) - 1 : false

  // 中间状态信息：章节名 + 当前位置
  const currentChapter = hasChapters ? currentBook?.chapters?.[currentChapterIndex] : null
  const chapterTitle = currentChapter?.title || currentBook?.title || ''
  const posInChapter = currentChapter
    ? currentSentenceIndex - currentChapter.startIndex + 1
    : currentSentenceIndex + 1
  const chapterTotal = currentChapter?.sentenceCount ?? currentBook?.sentences.length ?? 0

  const isPlaying = playState === 'playing'

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
  }, [isPlaying, onPlay, onPause])

  const displayVolume = isMuted ? 0 : volume

  const stepSpeed = (dir: -1 | 1) => {
    const next = Math.round((speed + dir * 0.1) * 10) / 10
    setSpeed(Math.max(SPEED_MIN, Math.min(SPEED_MAX, next)))
  }

  const stepVolume = (dir: -1 | 1) => {
    const next = Math.round((displayVolume + dir * 0.1) * 100) / 100
    setVolume(Math.max(0, Math.min(1, next)))
    if (isMuted && next > 0) toggleMute()
  }

  return (
    <div className="flex items-center h-16 px-3 sm:px-4 bg-white dark:bg-dark-surface select-none flex-shrink-0">
      {/* Left: Playback controls */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        <button
          onClick={() => onSkipChapter(-1)}
          disabled={!canPrevChapter}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            canPrevChapter
              ? 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          title={hasChapters ? '上一章' : '上一页'}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={onPrevSentence}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="上一句"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={handleTogglePlay}
          className="w-11 h-11 mx-1 sm:mx-1.5 rounded-full bg-primary hover:bg-primary/90 text-white flex items-center justify-center transition-all btn-bounce shadow-md shadow-primary/25"
          title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" fill="currentColor" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
          )}
        </button>

        <button
          onClick={onNextSentence}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="下一句"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={() => onSkipChapter(1)}
          disabled={!canNextChapter}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            canNextChapter
              ? 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          title={hasChapters ? '下一章' : '下一页'}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={onStop}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="停止 (Esc)"
        >
          <Square className="w-3.5 h-3.5" fill="currentColor" />
        </button>
      </div>

      {/* Center: Chapter + position */}
      <div className="flex-1 min-w-3 flex items-center justify-center px-3">
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {chapterTitle && (
            <span className="text-gray-500 dark:text-gray-400">{chapterTitle}</span>
          )}
          {chapterTotal > 0 && (
            <span className="ml-2 tabular-nums">{posInChapter}/{chapterTotal}</span>
          )}
        </span>
      </div>

      {/* Right: Adjustments */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {/* Speed stepper */}
        <div
          className="flex items-center gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-1 py-0.5"
          title={ttsEngine === 'qwen' ? '千问引擎暂不支持调速' : '倍速'}
        >
          <button
            onClick={() => stepSpeed(-1)}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[11px] text-gray-600 dark:text-gray-300 w-8 text-center tabular-nums font-medium">
            {speed.toFixed(1)}x
          </span>
          <button
            onClick={() => stepSpeed(1)}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Volume stepper */}
        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-1 py-0.5">
          <button
            onClick={toggleMute}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            title={isMuted ? '取消静音' : '静音'}
          >
            {displayVolume === 0 ? (
              <VolumeX className="w-3 h-3" />
            ) : (
              <Volume2 className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={() => stepVolume(-1)}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[11px] text-gray-600 dark:text-gray-300 w-7 text-center tabular-nums font-medium">
            {Math.round(displayVolume * 100)}
          </span>
          <button
            onClick={() => stepVolume(1)}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 hidden sm:block" />

        {/* Voice selector */}
        <div className="min-w-0">
          <VoiceSelector compact showToast={showToast} />
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 hidden sm:block" />

        {/* Tools */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => void window.api?.startScreenshotOcr()}
            className="w-8 h-8 rounded-lg items-center justify-center text-gray-400 dark:text-gray-500 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors hidden sm:flex"
            title="截图朗读"
          >
            <Camera className="w-4 h-4" />
          </button>
          {onToggleSubtitle && (
            <button
              onClick={onToggleSubtitle}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                subtitleEnabled
                  ? 'text-primary bg-primary/10'
                  : 'text-gray-400 dark:text-gray-500 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={subtitleEnabled ? '关闭桌面字幕' : '开启桌面字幕'}
            >
              <Captions className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              const next = !useSystemTTS
              setUseSystemTTS(next)
              if (next) {
                usePlayerStore.getState().setVoiceId('system-auto')
                usePlayerStore.getState().setTtsEngine('system')
              }
            }}
            className={`w-8 h-8 rounded-lg items-center justify-center transition-colors hidden sm:flex ${
              useSystemTTS
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={useSystemTTS ? '离线模式（点击切换在线）' : '切换离线模式'}
          >
            {useSystemTTS ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
