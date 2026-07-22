import { create } from 'zustand'
import type { PlayerSnapshot } from '../global'
import { usePlayerStore } from './playerStore'
import { useBookStore } from './bookStore'

type FloatingBallMode = 'ball' | 'hover' | 'mini'

interface FloatingBallPosition {
  x: number | null
  y: number | null
  edge: 'left' | 'right'
}

interface FloatingBallState {
  // 模式与可见性
  mode: FloatingBallMode
  visible: boolean

  // 设置
  locked: boolean
  opacity: number
  position: FloatingBallPosition

  // 运行时状态
  isDragging: boolean
  hoverCardVisible: boolean
  error: string | null

  // 播放器快照（由主窗口广播更新）
  snapshot: PlayerSnapshot

  // Actions
  setMode: (mode: FloatingBallMode) => void
  setVisible: (visible: boolean) => void
  setLocked: (locked: boolean) => void
  setOpacity: (opacity: number) => void
  setPosition: (pos: Partial<FloatingBallPosition>) => void
  setIsDragging: (dragging: boolean) => void
  setHoverCardVisible: (visible: boolean) => void
  setError: (error: string | null) => void
  setSnapshot: (snapshot: PlayerSnapshot) => void
  resetPosition: () => void

  /** 从 playerStore + bookStore 构建快照 */
  buildSnapshot: () => PlayerSnapshot
}

const defaultPosition: FloatingBallPosition = {
  x: null,
  y: null,
  edge: 'right'
}

const emptySnapshot: PlayerSnapshot = {
  hasContent: false,
  isPlaying: false,
  isLoading: false,
  error: null,
  bookTitle: '',
  chapterTitle: '',
  currentSentenceText: '',
  progressPercent: 0
}

export const useFloatingBallStore = create<FloatingBallState>((set, get) => ({
  mode: 'ball',
  visible: false,
  locked: false,
  opacity: 0.9,
  position: { ...defaultPosition },
  isDragging: false,
  hoverCardVisible: false,
  error: null,
  snapshot: { ...emptySnapshot },

  setMode: (mode) => set({ mode }),
  setVisible: (visible) => set({ visible }),
  setLocked: (locked) => set({ locked }),
  setOpacity: (opacity) => set({ opacity }),
  setPosition: (pos) => set((s) => ({ position: { ...s.position, ...pos } })),
  setIsDragging: (isDragging) => set({ isDragging }),
  setHoverCardVisible: (hoverCardVisible) => set({ hoverCardVisible }),
  setError: (error) => set({ error }),
  setSnapshot: (snapshot) => set({ snapshot }),
  resetPosition: () => set({ position: { ...defaultPosition } }),

  buildSnapshot: () => {
    const player = usePlayerStore.getState()
    const bookStore = useBookStore.getState()
    const book = bookStore.currentBook
    const chapters = book?.chapters || []
    const bounds = bookStore.getRangeBounds()

    let chapterTitle = ''
    if (chapters.length > 0) {
      const found = chapters.find(
        (ch) =>
          player.currentSentenceIndex >= ch.startIndex &&
          player.currentSentenceIndex < ch.startIndex + ch.sentenceCount
      )
      if (found) chapterTitle = found.title
    }

    const totalSentences = book?.sentences.length || 0
    const currentText = book?.sentences[player.currentSentenceIndex] || ''

    // range-aware 进度：范围激活时按窗口内相对位置计算
    const windowSize = Math.max(1, bounds.end - bounds.start)
    const rangeActive = bounds.start !== 0 || bounds.end !== totalSentences
    const progressPercent = rangeActive
      ? ((player.currentSentenceIndex - bounds.start) / windowSize) * 100
      : totalSentences > 0
        ? (player.currentSentenceIndex / totalSentences) * 100
        : 0

    return {
      hasContent: !!book && totalSentences > 0,
      isPlaying: player.playState === 'playing',
      isLoading: player.playState === 'playing' && !currentText,
      error: get().error,
      bookTitle: book?.title || '',
      chapterTitle,
      currentSentenceText: currentText,
      progressPercent
    }
  }
}))
