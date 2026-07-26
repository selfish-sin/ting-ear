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
      const diskLogs = (await window.api?.loadLogs()) as LogEntry[]
      const existing = get().logs
      // 合并：磁盘快照 + 已有实时条目，按 id 去重；实时条目优先保留
      const byId = new Map<string, LogEntry>()
      for (const entry of diskLogs || []) byId.set(entry.id, entry)
      for (const entry of existing) byId.set(entry.id, entry)
      const merged = Array.from(byId.values())
      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      if (merged.length > 5000) merged.length = 5000
      set({ logs: merged })
    } catch {
      // ignore
    }
  },

  appendLog: (entry) =>
    set((s) => {
      // 实时推送：去重后插到最前（最新）
      if (s.logs.some((l) => l.id === entry.id)) return s
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
