import { create } from 'zustand'

interface TextCleanState {
  /** 待清洗的源文本 */
  sourceText: string
  /** 关联的书 ID（从书架右键进入时有值） */
  sourceBookId: string | null
  /** 当前清洗结果 */
  cleanedText: string
  /** 是否正在清洗 */
  isCleaning: boolean
  /** 清洗进度（规则清洗瞬时完成，保留字段兼容 UI） */
  progress: { current: number; total: number; phase: string } | null
  /** 应用后自动打开的书 ID */
  openBookAfterApply: string | null

  setSource: (text: string, bookId?: string | null) => void
  setCleanedText: (text: string) => void
  setIsCleaning: (v: boolean) => void
  setProgress: (p: { current: number; total: number; phase: string } | null) => void
  setOpenBookAfterApply: (bookId: string | null) => void
  reset: () => void
}

export const useTextCleanStore = create<TextCleanState>((set) => ({
  sourceText: '',
  sourceBookId: null,
  cleanedText: '',
  isCleaning: false,
  progress: null,
  openBookAfterApply: null,

  setSource: (text, bookId = null) =>
    set({
      sourceText: text,
      sourceBookId: bookId,
      cleanedText: '',
      progress: null,
      openBookAfterApply: null
    }),

  setCleanedText: (text) => set({ cleanedText: text }),
  setIsCleaning: (v) => set({ isCleaning: v }),
  setProgress: (p) => set({ progress: p }),
  setOpenBookAfterApply: (bookId) => set({ openBookAfterApply: bookId }),

  reset: () =>
    set({
      sourceText: '',
      sourceBookId: null,
      cleanedText: '',
      isCleaning: false,
      progress: null,
      openBookAfterApply: null
    })
}))
