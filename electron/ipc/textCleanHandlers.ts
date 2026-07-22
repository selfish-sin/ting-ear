/**
 * 文本清洗 IPC handlers。
 */

import { ipcMain } from 'electron'
import type { EngineManager } from '../services/tts-engines/engine-manager'
import type { SettingsService } from '../services/settings-service'
import type { LogService } from '../services/log-service'
import { createAdapter } from '../services/llm/adapter-factory'
import type { LLMConfig } from '../services/llm/adapter'
import { cleanTextWithLLM, type CleanProgress } from '../services/text-cleaner'
import { enhancedClean } from '../services/parsers/textPreprocessor'

// 运行中的清洗任务（持有 AbortController 以便硬取消）
const activeTasks = new Map<string, { controller: AbortController }>()

export function registerTextCleanHandlers(
  settingsService: SettingsService,
  _engineManager: EngineManager,
  logService: LogService
): void {
  ipcMain.handle(
    'text:cleanWithLLM',
    async (event, { text, configId }: { text: string; configId?: string }) => {
      const configs = settingsService.getLlmConfigs()
      const activeId = configId || settingsService.getActiveLlmId()
      const config = configs.find((c) => c.id === activeId)
      if (!config) {
        return { success: false, error: `未找到 LLM 配置: ${activeId}` }
      }

      const taskId = `clean_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const controller = new AbortController()
      activeTasks.set(taskId, { controller })
      logService.info('TextClean', `开始清洗: taskId=${taskId} model=${config.model} chunks=估算中`)

      // 异步执行，通过事件推送进度
      ;(async () => {
        try {
          const adapter = createAdapter({
            id: config.id,
            provider: config.provider,
            name: config.name,
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            contextWindow: config.contextWindow,
            maxTokens: config.maxTokens,
            temperature: config.temperature
          })

          const result = await cleanTextWithLLM(
            text,
            adapter,
            (p: CleanProgress) => {
              if (controller.signal.aborted) return
              event.sender.send('text:cleanProgress', { taskId, ...p })
            },
            settingsService.getCleanPrompt(),
            config.temperature,
            config.maxTokens,
            config.chunkSize,
            controller.signal
          )

          if (controller.signal.aborted) {
            event.sender.send('text:cleanComplete', { taskId, cancelled: true })
            return
          }

          event.sender.send('text:cleanComplete', {
            taskId,
            cancelled: false,
            text: result.text,
            stats: result.stats
          })
          logService.info('TextClean', `清洗完成: ${result.stats.originalLength} → ${result.stats.cleanedLength} 字, ${result.stats.chunksUsed} 块`)
        } catch (error) {
          // 因取消而中断（fetch 被 abort）：按 cancelled 处理，不报 error
          if (controller.signal.aborted) {
            event.sender.send('text:cleanComplete', { taskId, cancelled: true })
            return
          }
          const msg = error instanceof Error ? error.message : String(error)
          logService.error('TextClean', `清洗失败: ${msg}`)
          event.sender.send('text:cleanComplete', { taskId, cancelled: false, error: msg })
        } finally {
          activeTasks.delete(taskId)
        }
      })()

      return { success: true, taskId }
    }
  )

  // === 快速清洗（纯正则，秒出，不调 LLM）===
  ipcMain.handle('text:enhancedClean', async (_event, { text }: { text: string }) => {
    const cleaned = enhancedClean(text || '', settingsService.getCleanRules())
    return { success: true, text: cleaned, originalLength: (text || '').length, cleanedLength: cleaned.length }
  })

  }
