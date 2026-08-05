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

  // 底栏：整体透明；主题色只点缀「播放中 / 进度相关主按钮 / 状态」
  const sideBtn =
    'w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-colors text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-primary/10 disabled:text-gray-300 disabled:dark:text-gray-600 disabled:cursor-not-allowed disabled:hover:bg-transparent'
  const stepBtn =
    'w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-primary/10 hover:text-primary transition-all'

  return (
    <div className="relative flex h-12 sm:h-14 md:h-16 flex-shrink-0 select-none items-center bg-transparent px-1.5 sm:px-3 md:px-4">
      {/* 左：倍速 + 音量（中性底，数值平常色） */}
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1 sm:gap-1.5">
        <div className="ctrl-group" title={ttsEngine === 'qwen' ? '千问引擎暂不支持调速' : '倍速'}>
          <button type="button" onClick={() => stepSpeed(-1)} className="ctrl-btn">
            <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
          <span className="w-7 sm:w-8 text-center text-[10px] font-medium tabular-nums text-gray-600 dark:text-gray-300 sm:text-[11px] md:text-xs">
            {speed.toFixed(1)}x
          </span>
          <button type="button" onClick={() => stepSpeed(1)} className="ctrl-btn">
            <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
        </div>

        <div
          className="ctrl-group"
          title={
            displayVolume > 1
              ? `音量增强 ${Math.round(displayVolume * 100)}%（上限 ${Math.round(VOLUME_MAX * 100)}%）`
              : `音量 ${Math.round(displayVolume * 100)}%（可超过 100% 增强）`
          }
        >
          <button
            type="button"
            onClick={toggleMute}
            className="ctrl-btn"
            title={isMuted ? '取消静音' : '静音'}
          >
            {displayVolume === 0 ? (
              <VolumeX className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            ) : (
              <Volume2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            )}
          </button>
          <button type="button" onClick={() => stepVolume(-1)} className="ctrl-btn !w-5 sm:!w-5">
            <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
          <span
            className={`w-7 sm:w-8 text-center text-[10px] font-medium tabular-nums sm:text-[11px] md:text-xs ${
              displayVolume > 1
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {Math.round(displayVolume * 100)}%
          </span>
          <button type="button" onClick={() => stepVolume(1)} className="ctrl-btn !w-5 sm:!w-5">
            <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
        </div>
      </div>

      {/* 正中：包绕播放 —— 仅主播放键用实心主题色 */}
      <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={() => onSkipChapter(-1)}
          disabled={!canPrevChapter}
          className={sideBtn}
          title={hasChapters ? '上一章' : '上一页'}
        >
          <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>

        <div className="flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.03] px-1 py-0.5 dark:border-white/10 dark:bg-white/[0.06] sm:px-1.5 sm:py-1">
          <button type="button" onClick={onPrevSentence} className={stepBtn} title="上一句">
            <SkipBack className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </button>
          <button
            type="button"
            onClick={handleTogglePlay}
            className="mx-0.5 flex h-10 w-10 sm:h-11 sm:w-11 md:h-12 md:w-12 items-center justify-center rounded-full bg-primary text-[rgb(var(--on-primary-rgb))] shadow-md shadow-primary/25 transition-all hover:bg-primary-600 active:scale-95 btn-bounce"
            title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 sm:h-5 sm:w-5" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 h-4 w-4 sm:h-5 sm:w-5" fill="currentColor" />
            )}
          </button>
          <button type="button" onClick={onNextSentence} className={stepBtn} title="下一句">
            <SkipForward className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onSkipChapter(1)}
          disabled={!canNextChapter}
          className={sideBtn}
          title={hasChapters ? '下一章' : '下一页'}
        >
          <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>

        <button type="button" onClick={onStop} className={sideBtn} title="停止 (Esc)">
          <Square className="h-3 w-3 sm:h-3.5 sm:w-3.5" fill="currentColor" />
        </button>
      </div>

      {/* 右：TTS + 在线/离线（离线态用琥珀点缀，在线保持中性） */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 pl-1 sm:gap-1.5">
        <div className="min-w-0 max-w-[6.5rem] sm:max-w-[9rem] md:max-w-[11rem]">
          <VoiceSelector compact showToast={showToast} />
        </div>
        <button
          type="button"
          onClick={toggleOffline}
          className={`flex h-7 sm:h-8 items-center gap-1 rounded-lg px-1.5 sm:px-2 text-[10px] sm:text-xs font-medium transition-colors ${
            useSystemTTS
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
              : 'bg-black/[0.04] text-gray-600 hover:bg-primary/10 hover:text-primary dark:bg-white/[0.06] dark:text-gray-300'
          }`}
          title={useSystemTTS ? '离线模式（点击切回在线）' : '在线模式（点击切离线）'}
        >
          {useSystemTTS ? (
            <WifiOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          ) : (
            <Wifi className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          )}
          <span className="hidden sm:inline">{useSystemTTS ? '离线' : '在线'}</span>
        </button>
      </div>
    </div>
  )
}
