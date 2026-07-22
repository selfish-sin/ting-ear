import { create } from 'zustand'
import type { PlayState } from '../global'
import { useBookStore } from './bookStore'

interface PlayerState {
  // Playback state
  playState: PlayState
  currentSentenceIndex: number
  currentChapterIndex: number
  totalSentences: number

  // Playback settings
  speed: number
  volume: number
  voiceId: string
  isMuted: boolean

  // TTS engine
  ttsEngine: string
  useSystemTTS: boolean // whether we've fallen back to system TTS

  // Audio
  currentAudio: HTMLAudioElement | null

  // Pagination for non-chaptered books
  pageIndex: number
  pageSize: number

  // Time map for progress bar (cumulative ms per sentence)
  timeMap: number[]

  // Actions
  setTimeMap: (map: number[]) => void
  updateTimeMapEntry: (index: number, durationMs: number) => void
  setPlayState: (state: PlayState) => void
  setCurrentSentenceIndex: (index: number) => void
  setCurrentChapterIndex: (index: number) => void
  setTotalSentences: (count: number) => void
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setVoiceId: (voiceId: string) => void
  toggleMute: () => void
  setTtsEngine: (engine: string) => void
  setUseSystemTTS: (flag: boolean) => void
  setCurrentAudio: (audio: HTMLAudioElement | null) => void
  setPageIndex: (pageIndex: number) => void
  reset: () => void
  resetToQwenTTS: () => void
}

const initialState = {
  playState: 'idle' as PlayState,
  currentSentenceIndex: 0,
  currentChapterIndex: 0,
  totalSentences: 0,
  speed: 1.0,
  volume: 0.8,
  voiceId: 'zh-CN-XiaoxiaoNeural',
  isMuted: false,
  ttsEngine: 'edge' as const,
  useSystemTTS: false,
  currentAudio: null,
  pageIndex: 0,
  pageSize: 500,
  timeMap: []
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...initialState,

  setPlayState: (playState) => set({ playState }),
  setCurrentSentenceIndex: (currentSentenceIndex) => set({ currentSentenceIndex }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setTotalSentences: (totalSentences) => set({ totalSentences }),
  setSpeed: (speed) => set({ speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed)) }),
  setVolume: (volume) => {
    const v = Math.max(0, Math.min(1, volume))
    set((s) => ({
      volume: v,
      // 音量降至 0 自动静音；回升到大于 0 时自动取消静音
      isMuted: v === 0 ? true : v > 0 ? false : s.isMuted
    }))
    // 立即应用到正在播放的音频，保证快捷键调节即时可闻
    const audio = get().currentAudio
    if (audio) audio.volume = v
  },
  setVoiceId: (voiceId) => set({ voiceId }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  setTtsEngine: (ttsEngine) => set({ ttsEngine }),
  setUseSystemTTS: (useSystemTTS) => set({ useSystemTTS }),
  setCurrentAudio: (currentAudio) => set({ currentAudio }),
  setPageIndex: (pageIndex) => set({ pageIndex }),
  setTimeMap: (timeMap) => set({ timeMap }),
  updateTimeMapEntry: (index, durationMs) =>
    set((s) => {
      const map = [...s.timeMap]
      // 确保数组足够长
      while (map.length <= index) map.push(0)
      map[index] = durationMs

      // 触发保存到 BookData
      setTimeout(() => {
        useBookStore.getState().updateCurrentTimeMap([...map])
      }, 0)

      return { timeMap: map }
    }),
  reset: () => set(initialState),
  resetToQwenTTS: () => set({ useSystemTTS: false, ttsEngine: 'qwen' })
}))

/** 倍速调节参数（全局快捷键使用） */
export const SPEED_MIN = 0.5
export const SPEED_MAX = 3.0
export const SPEED_STEP = 0.1
/** 音量调节参数：内部以 0~1 存储，UI 以 0~100% 展示 */
export const VOLUME_STEP = 0.05
/** 默认值（恢复默认快捷键使用） */
export const DEFAULT_SPEED = 1.0
export const DEFAULT_VOLUME = 0.8

/** 找到某个 voiceId 属于哪个引擎；找不到返回 null。
 *  用于渲染层在选中音色时自动切换活动引擎，避免 Edge/Qwen 音色串台。 */
export function findEngineForVoice(
  engines: { id: string; voices?: { id: string }[] }[],
  voiceId: string
): string | null {
  for (const e of engines) {
    if (e.voices?.some((v) => v.id === voiceId)) return e.id
  }
  return null
}
