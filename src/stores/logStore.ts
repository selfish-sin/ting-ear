import { create } from 'zustand'
import type { LogEntry } from '../global'

interface LogState {
  logs: LogEntry[]
  loadLogs: () => Promise<void>
  appendLog: (entry: LogEntry) => void
  clearLogs: () => Promise<void>
  levelFilter: 'ALL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  searchKeyword: string
  setLevelFilter: (filter: LogState['levelFilter']) => void
  setSearchKeyword: (keyword: string) => void
  getFilteredLogs: () => LogEntry[]
}

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  levelFilter: 'ALL',
  searchKeyword: '',

  loadLogs: async () => {
    try {
      const logs = (await window.api?.loadLogs()) as LogEntry[]
      const sorted = (logs || []).sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      set({ logs: sorted })
    } catch {
      // ignore
    }
  },

  appendLog: (entry) =>
    set((s) => {
      const next = [entry, ...s.logs]
      if (next.length > 5000) next.length = 5000
      return { logs: next }
    }),

  clearLogs: async () => {
    try {
      await window.api?.clearLogs()
      set({ logs: [] })
    } catch {
      // ignore
    }
  },

  setLevelFilter: (levelFilter) => set({ levelFilter }),
  setSearchKeyword: (searchKeyword) => set({ searchKeyword }),

  getFilteredLogs: () => {
    const { logs, levelFilter, searchKeyword } = get()
    let filtered = logs
    if (levelFilter !== 'ALL') {
      filtered = filtered.filter((l) => l.level === levelFilter)
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      filtered = filtered.filter(
        (l) =>
          l.message.toLowerCase().includes(kw) ||
          (l.details || '').toLowerCase().includes(kw) ||
          l.source.toLowerCase().includes(kw)
      )
    }
    return filtered
  }
}))
