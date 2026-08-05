import { create } from 'zustand'
import type { OutlineBatchProgress } from '../global'

interface OutlineBatchState {
  running: boolean
  progress: OutlineBatchProgress | null
  result: { succeeded: number; failed: number; skipped: number } | null
  error?: string
  start: (force: boolean) => Promise<void>
  cancel: () => Promise<void>
  clearResult: () => void
}

export const useOutlineBatchStore = create<OutlineBatchState>((set) => ({
  running: false,
  progress: null,
  result: null,
  error: undefined,

  start: async (force) => {
    set({ running: true, progress: null, result: null, error: undefined })
    try {
      const result = await window.api.aiOutlineRegenerateAll({ force })
      if (!result.accepted) {
        set({ running: false, progress: null, result: null, error: result.reason === 'already-running' ? '已有任务在运行' : '启动失败' })
      }
    } catch (error) {
      set({ running: false, progress: null, result: null, error: error instanceof Error ? error.message : String(error) })
    }
  },

  cancel: async () => {
    try { await window.api.aiOutlineCancelBatch() } catch { /* 进度推送会自动结束 */ }
  },

  clearResult: () => set({ result: null, error: undefined }),
}))

// 模块级 IPC 订阅 —— 应用存活期间持续监听，不随组件卸载丢失
if (window.api?.onOutlineBatchProgress) {
  window.api.onOutlineBatchProgress((progress) => {
    const store = useOutlineBatchStore
    if (progress.phase === 'done') {
      store.setState({ running: false, progress: null, result: { succeeded: progress.succeeded, failed: progress.failed, skipped: progress.skipped } })
    } else {
      store.setState({ running: true, progress, result: null })
    }
  })
}
