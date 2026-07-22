import { ipcMain, BrowserWindow } from 'electron'
import type { LogService } from '../services/log-service'

export function registerWindowHandlers(logService: LogService, mainWindow: BrowserWindow | null): void {
  const getMainWindow = (): BrowserWindow | null => mainWindow

  ipcMain.handle('window:minimize', async () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', async () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle('window:close', async () => {
    getMainWindow()?.hide()
    logService.info('UI', '窗口最小化到托盘')
  })

  ipcMain.handle('window:setOpacity', async (_event, opacity: number) => {
    const win = getMainWindow()
    win?.setOpacity(Math.max(0.4, Math.min(1.0, opacity)))
  })

  ipcMain.handle('window:setAlwaysOnTop', async (_event, flag: boolean) => {
    getMainWindow()?.setAlwaysOnTop(flag)
  })

  ipcMain.handle('window:isMaximized', async () => {
    return getMainWindow()?.isMaximized() ?? false
  })
}
