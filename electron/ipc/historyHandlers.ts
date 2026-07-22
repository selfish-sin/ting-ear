import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { LogService } from '../services/log-service'
import type { HistoryEntry } from '../../src/global'

const MAX_HISTORY_ENTRIES = 2000

function getHistoryFile(): string {
  const dir = join(app.getPath('userData'), '听伴')
  return join(dir, 'history.json')
}

function loadHistory(): HistoryEntry[] {
  try {
    if (existsSync(getHistoryFile())) {
      return JSON.parse(readFileSync(getHistoryFile(), 'utf-8'))
    }
  } catch {
    // corrupted
  }
  return []
}

function saveHistory(history: HistoryEntry[]): void {
  // Trim to max entries
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(history.length - MAX_HISTORY_ENTRIES)
  }
  writeFileSync(getHistoryFile(), JSON.stringify(history, null, 2), 'utf-8')
}

export function registerHistoryHandlers(logService: LogService): void {
  // Save a single history entry
  ipcMain.handle('history:save', async (_event, entry: Omit<HistoryEntry, 'id'>) => {
    try {
      const history = loadHistory()
      const newEntry: HistoryEntry = { ...entry, id: uuidv4() }
      history.push(newEntry)
      saveHistory(history)
      logService.debug('History', `保存历史: ${entry.bookTitle} 第${entry.startSentenceIndex}句`)
      return { success: true, entry: newEntry }
    } catch (error) {
      logService.error('History', `保存历史失败: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  })

  // Load all history
  ipcMain.handle('history:load', async () => {
    return loadHistory()
  })

  // Clear all history
  ipcMain.handle('history:clear', async () => {
    try {
      saveHistory([])
      logService.info('History', '用户清空了历史记录')
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
