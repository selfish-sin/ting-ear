/**
 * 文本清洗 IPC：仅保留纯正则 enhancedClean（秒出，不依赖任何 LLM）。
 */

import { ipcMain } from 'electron'
import type { SettingsService } from '../services/settings-service'
import type { LogService } from '../services/log-service'
import { enhancedClean } from '../services/parsers/textPreprocessor'

export function registerTextCleanHandlers(
  settingsService: SettingsService,
  logService: LogService
): void {
  ipcMain.handle('text:enhancedClean', async (_event, { text }: { text: string }) => {
    try {
      const raw = text || ''
      const cleaned = enhancedClean(raw, settingsService.getCleanRules())
      logService.debug('TextClean', `规则清洗: ${raw.length} → ${cleaned.length} 字`)
      return {
        success: true,
        text: cleaned,
        originalLength: raw.length,
        cleanedLength: cleaned.length
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logService.error('TextClean', `规则清洗失败: ${msg}`)
      return { success: false, text: text || '', originalLength: (text || '').length, cleanedLength: 0, error: msg }
    }
  })
}
