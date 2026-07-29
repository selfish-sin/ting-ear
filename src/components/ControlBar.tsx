import { useCallback } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  VolumeX,
  Volume2,
  Wifi,
  WifiOff
} from 'lucide-react'
import {
  usePlayerStore,
  SPEED_MIN,
  SPEED_MAX,
  SPEED_STEP,
  VOLUME_STEP,
  VOLUME_MAX
} from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useSettingsStore } from '../stores/settingsStore'
import VoiceSelector from './VoiceSelector'
import type { ToastItem } from '../global'

interface ControlBarProps {
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
  onSkipChapter: (direction: -1 | 1) => void
  showToast: (type: ToastItem['type'], message: string) => void
}

/**
 * 底栏布局：
 * 左：倍速 + 音量（随宽度缩放）
 * 中：包绕播放
 * 右：TTS 音色 + 在线/离线
 */
export default function ControlBar({
  onPlay,
  onPause,
  onStop,
  onPrevSentence,
  onNextSentence,
  onSkipChapter,
  showToast
}: ControlBarProps) {
  const playState = usePlayerStore((s) => s.playState)
  const pageIndex = usePlayerStore((s) => s.pageIndex)
  const pageSize = usePlayerStore((s) => s.pageSize)
  const currentChapterIndex = usePlayerStore((s) => s.currentChapterIndex)
  const speed = usePlayerStore((s) => s.speed)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)
  const setSpeed = usePlayerStore((s) => s.setSpeed)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const ttsEngine = usePlayerStore((s) => s.ttsEngine)
  const useSystemTTS = usePlayerStore((s) => s.useSystemTTS)
  const setUseSystemTTS = usePlayerStore((s) => s.setUseSystemTTS)
  const currentBook = useBookStore((s) => s.currentBook)
  const settings = useSettingsStore((s) => s.settings)

  const hasChapters = (currentBook?.chapters?.length || 0) > 1
  const canPrevChapter = hasChapters ? currentChapterIndex > 0 : pageIndex > 0
  const canNextChapter = hasChapters
    ? currentChapterIndex < (currentBook?.chapters?.length || 0) - 1
    : currentBook
      ? pageIndex < Math.ceil(currentBook.sentences.length / pageSize) - 1
      : false

  const isPlaying = playState === 'playing'
  const displayVolume = isMuted ? 0 : volume

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) onPause()
    else onPlay()
  }, [isPlaying, onPlay, onPause])

  const stepSpeed = (dir: -1 | 1) => {
    const next = Math.round((speed + dir * SPEED_STEP) * 10) / 10
    setSpeed(Math.max(SPEED_MIN, Math.min(SPEED_MAX, next)))
  }

  const stepVolume = (dir: -1 | 1) => {
    // 静音时 displayVolume 为 0，不能拿它做基数，否则会冲掉记忆音量；
    // 且 setVolume 在 v>0 时已自动取消静音，切勿再 toggleMute（会立刻重新静音）。
    if (isMuted) {
      if (dir > 0) {
        setVolume(volume > 0 ? volume : VOLUME_STEP)
      } else {
        setVolume(Math.max(0, Math.round((volume - VOLUME_STEP) * 100) / 100))
      }
      return
    }
    const next = Math.round((volume + dir * VOLUME_STEP) * 100) / 100
    setVolume(Math.max(0, Math.min(VOLUME_MAX, next)))
  }

  const toggleOffline = () => {
    const next = !useSystemTTS
    const player = usePlayerStore.getState()
    if (next) {
      setUseSystemTTS(true)
      player.setVoiceId('system-auto')
      player.setTtsEngine('system')
      return
    }
    const onlineEngine =
      settings.ttsEngine && settings.ttsEngine !== 'system' ? settings.ttsEngine : 'edge'
    const onlineVoice =
      settings.voiceId && !settings.voiceId.startsWith('system-')
        ? settings.voiceId
        : 'zh-CN-XiaoxiaoNeural'
    setUseSystemTTS(false)
    player.setTtsEngine(onlineEngine)
    player.setVoiceId(onlineVoice)
    void window.api?.ttsSetActiveEngine(onlineEngine)
  }

  return (
    <div className="relative flex items-center h-12 sm:h-14 md:h-16 px-1.5 sm:px-3 md:px-4 select-none flex-shrink-0 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border">
      {/* 左：倍速 + 音量（窄屏更紧凑） */}
      <div className="flex-1 min-w-0 flex items-center gap-1 sm:gap-1.5 justify-start">
        <div
          className="flex items-center gap-0.5 rounded-md sm:rounded-lg bg-gray-100 dark:bg-dark-muted px-0.5 sm:px-1 py-0.5"
          title={ttsEngine === 'qwen' ? '千问引擎暂不支持调速' : '倍速'}
        >
          <button
            onClick={() => stepSpeed(-1)}
            className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Minus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </button>
          <span className="text-[10px] sm:text-[11px] md:text-xs text-gray-600 dark:text-gray-300 w-7 sm:w-8 text-center tabular-nums font-medium">
            {speed.toFixed(1)}x
          </span>
          <button
            onClick={() => stepSpeed(1)}
            className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </button>
        </div>

        <div
          className="flex items-center gap-0.5 rounded-md sm:rounded-lg bg-gray-100 dark:bg-dark-muted px-0.5 sm:px-1 py-0.5"
          title={
            displayVolume > 1
              ? `音量增强 ${Math.round(displayVolume * 100)}%（上限 ${Math.round(VOLUME_MAX * 100)}%）`
              : `音量 ${Math.round(displayVolume * 100)}%（可超过 100% 增强）`
          }
        >
          <button
            onClick={toggleMute}
            className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            title={isMuted ? '取消静音' : '静音'}
          >
            {displayVolume === 0 ? (
              <VolumeX className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            ) : (
              <Volume2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            )}
          </button>
          <button
            onClick={() => stepVolume(-1)}
            className="w-5 h-5 sm:w-5 sm:h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Minus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </button>
          <span
            className={`text-[10px] sm:text-[11px] md:text-xs w-7 sm:w-8 text-center tabular-nums font-medium ${
              displayVolume > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {Math.round(displayVolume * 100)}%
          </span>
          <button
            onClick={() => stepVolume(1)}
            className="w-5 h-5 sm:w-5 sm:h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </button>
        </div>
      </div>

      {/* 正中：包绕播放 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-0.5 sm:gap-1 z-10">
        <button
          onClick={() => onSkipChapter(-1)}
          disabled={!canPrevChapter}
          className={`w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-colors ${
            canPrevChapter
              ? 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-dark-muted'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          title={hasChapters ? '上一章' : '上一页'}
        >
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <div className="flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-full bg-gray-100 dark:bg-dark-muted border border-gray-200/80 dark:border-dark-border">
          <button
            onClick={onPrevSentence}
            className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-dark-raised hover:text-primary transition-all"
            title="上一句"
          >
            <SkipBack className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          </button>
          <button
            onClick={handleTogglePlay}
            className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 mx-0.5 rounded-full bg-primary hover:bg-primary-600 active:scale-95 text-white flex items-center justify-center transition-all btn-bounce shadow-md shadow-primary/30"
            title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" />
            ) : (
              <Play className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" fill="currentColor" />
            )}
          </button>
          <button
            onClick={onNextSentence}
            className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-dark-raised hover:text-primary transition-all"
            title="下一句"
          >
            <SkipForward className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
          </button>
        </div>

        <button
          onClick={() => onSkipChapter(1)}
          disabled={!canNextChapter}
          className={`w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-colors ${
            canNextChapter
              ? 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-dark-muted'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          title={hasChapters ? '下一章' : '下一页'}
        >
          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={onStop}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-muted transition-colors"
          title="停止 (Esc)"
        >
          <Square className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" />
        </button>
      </div>

      {/* 右：TTS + 在线/离线 */}
      <div className="flex-1 min-w-0 flex items-center justify-end gap-1 sm:gap-1.5 pl-1">
        <div className="min-w-0 max-w-[6.5rem] sm:max-w-[9rem] md:max-w-[11rem]">
          <VoiceSelector compact showToast={showToast} />
        </div>
        <button
          onClick={toggleOffline}
          className={`h-7 sm:h-8 px-1.5 sm:px-2 rounded-lg flex items-center gap-1 text-[10px] sm:text-xs font-medium transition-colors ${
            useSystemTTS
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
              : 'bg-gray-100 dark:bg-dark-muted text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
          }`}
          title={useSystemTTS ? '离线模式（点击切回在线）' : '在线模式（点击切离线）'}
        >
          {useSystemTTS ? (
            <WifiOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          ) : (
            <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          )}
          <span className="hidden sm:inline">{useSystemTTS ? '离线' : '在线'}</span>
        </button>
      </div>
    </div>
  )
}
