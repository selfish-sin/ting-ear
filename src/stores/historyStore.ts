import { create } from 'zustand'
import type { HistoryEntry } from '../global'

interface HistoryState {
  history: HistoryEntry[]
  loadHistory: () => Promise<void>
  addHistory: (entry: Omit<HistoryEntry, 'id'>) => Promise<void>
  clearHistory: () => Promise<void>
  // Stats
  getTotalDurationSeconds: () => number
  getActiveDays: () => number
  getWeeklyStats: () => Array<{ date: string; minutes: number }>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],

  loadHistory: async () => {
    try {
      const history = (await window.api?.loadHistory()) as HistoryEntry[]
      // Sort newest first
      const sorted = (history || []).sort((a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      )
      set({ history: sorted })
    } catch {
      // ignore
    }
  },

  addHistory: async (entry) => {
    try {
      await window.api?.saveHistory(entry)
      // Reload to get the new entry with id
      await get().loadHistory()
    } catch {
      // ignore
    }
  },

  clearHistory: async () => {
    try {
      await window.api?.clearHistory()
      set({ history: [] })
    } catch {
      // ignore
    }
  },

  getTotalDurationSeconds: () => {
    return get().history.reduce((sum, h) => sum + (h.durationSeconds || 0), 0)
  },

  getActiveDays: () => {
    const days = new Set<string>()
    get().history.forEach((h) => {
      const date = new Date(h.startTime).toDateString()
      days.add(date)
    })
    return days.size
  },

  getWeeklyStats: () => {
    const now = new Date()
    const stats: Array<{ date: string; minutes: number }> = []
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now)
      day.setDate(now.getDate() - i)
      const dayStr = day.toDateString()
      const minutes = get().history
        .filter((h) => new Date(h.startTime).toDateString() === dayStr)
        .reduce((sum, h) => sum + Math.round((h.durationSeconds || 0) / 60), 0)
      stats.push({ date: dayStr, minutes })
    }
    return stats
  }
}))
