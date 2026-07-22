import { ipcMain } from 'electron'
import type { LogService } from '../services/log-service'

export function registerLogHandlers(logService: LogService): void {
  // Load all logs
  ipcMain.handle('log:load', async () => {
    return logService.getLogs()
  })

  // Clear all logs
  ipcMain.handle('log:clear', async () => {
    logService.clearLogs()
    logService.info('System', '用户清空了日志')
    return { success: true }
  })
}
