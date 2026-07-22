import { create } from 'zustand'
import type { ReviewIssue } from '../global'

interface TextCleanState {
  /** 待清洗的源文本 */
  sourceText: string
  /** 关联的书 ID（从书架右键进入时有值） */
  sourceBookId: string | null
  /** 当前清洗结果 */
  cleanedText: string
  /** 是否正在清洗 */
  isCleaning: boolean
  /** 清洗进度 */
  progress: { current: number; total: number; phase: string } | null

  /** 应用后自动打开的书 ID */
  openBookAfterApply: string | null

  /** 是否正在审校（LLM 审校助手） */
  reviewing: boolean
  /** 审校进度（按段计） */
  reviewProgress: { current: number; total: number } | null
  /** 审校疑点列表 */
  reviewIssues: ReviewIssue[]

  // Actions
  setSource: (text: string, bookId?: string | null) => void
  setCleanedText: (text: string) => void
  setIsCleaning: (v: boolean) => void
  setProgress: (p: { current: number; total: number; phase: string } | null) => void
  setOpenBookAfterApply: (bookId: string | null) => void
  setReviewing: (v: boolean) => void
  setReviewProgress: (p: { current: number; total: number } | null) => void
  setReviewIssues: (issues: ReviewIssue[]) => void
  /** 移除指定疑点（采纳/忽略后） */
  removeReviewIssue: (sentence: string) => void
  reset: () => void
}

export const useTextCleanStore = create<TextCleanState>((set) => ({
  sourceText: '',
  sourceBookId: null,
  cleanedText: '',
  isCleaning: false,
  progress: null,
  openBookAfterApply: null,
  reviewing: false,
  reviewProgress: null,
  reviewIssues: [],

  setSource: (text, bookId = null) =>
    set({
      sourceText: text,
      sourceBookId: bookId,
      cleanedText: '',
      progress: null,
      openBookAfterApply: null,
      reviewIssues: []
    }),

  setCleanedText: (text) => set({ cleanedText: text }),

  setIsCleaning: (v) => set({ isCleaning: v }),

  setProgress: (p) => set({ progress: p }),

  setOpenBookAfterApply: (bookId) => set({ openBookAfterApply: bookId }),

  setReviewing: (v) => set({ reviewing: v }),

  setReviewProgress: (p) => set({ reviewProgress: p }),

  setReviewIssues: (issues) => set({ reviewIssues: issues }),

  removeReviewIssue: (sentence) =>
    set((state) => ({ reviewIssues: state.reviewIssues.filter((i) => i.sentence !== sentence) })),

  reset: () =>
    set({
      sourceText: '',
      sourceBookId: null,
      cleanedText: '',
      isCleaning: false,
      progress: null,
      openBookAfterApply: null,
      reviewing: false,
      reviewProgress: null,
      reviewIssues: []
    })
}))
