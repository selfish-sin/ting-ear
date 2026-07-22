import { ipcMain } from 'electron'
import type { LogService } from '../services/log-service'
import type { EngineManager } from '../services/tts-engines/engine-manager'

export function registerTtsHandlers(
  logService: LogService,
  engineManager: EngineManager
): void {
  // Synthesize text using the active TTS engine (with fallback chain)
  // 第 5 个可选参数 engineId 用于显式指定引擎（音色试听 / 渲染层匹配音色所属引擎）
  ipcMain.handle(
    'tts:synthesize',
    async (_event, text: string, voice: string, speed: number, volume: number, engineId?: string) => {
      try {
        const result = await engineManager.synthesize(text, voice, speed, volume, engineId)
        if (result.fallback && result.error) {
          logService.warn('TTS', `合成失败/降级: ${result.error}`, undefined, {
            engineId: engineId || engineManager.getActiveEngineId(),
            voice,
            textLength: text.length,
            engineUsed: result.engineUsed
          })
        } else if (!result.success) {
          logService.warn('TTS', `合成失败: ${result.error || '未知错误'}`, undefined, {
            engineId: engineId || engineManager.getActiveEngineId(),
            voice,
            textLength: text.length
          })
        } else {
          logService.debug('TTS', `合成成功: ${result.engineUsed}`, {
            engineId: engineId || engineManager.getActiveEngineId(),
            voice,
            textLength: text.length,
            audioFormat: result.audioFormat
          })
        }
        return result
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logService.error('TTS', '合成请求异常', msg, {
          engineId: engineId || engineManager.getActiveEngineId(),
          voice,
          textLength: text.length
        })
        return { success: false, error: msg, fallback: true }
      }
    }
  )

  // 试听某引擎+音色：合成一句固定的中文示例文本，返回 base64 音频
  ipcMain.handle('tts:previewVoice', async (_event, engineId: string, voiceId: string) => {
    const sampleText = '你好，这是听伴的音色试听示例。'
    try {
      const result = await engineManager.synthesize(sampleText, voiceId, 1.0, 1.0, engineId)
      if (result.success) {
        logService.debug('TTS', '音色试听成功', { engineId, voiceId, audioFormat: result.audioFormat })
      } else {
        logService.warn('TTS', `音色试听失败: ${result.error || '未知错误'}`, undefined, { engineId, voiceId })
      }
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logService.error('TTS', '音色试听异常', msg, { engineId, voiceId })
      return { success: false, error: msg, fallback: true }
    }
  })

  // Get available voices for an engine
  ipcMain.handle('tts:getVoices', async (_event, engineId?: string) => {
    return engineManager.fetchVoices(engineId)
  })

  // Get all engine configs (for settings UI)
  ipcMain.handle('tts:getEngines', async () => {
    return engineManager.getEngineConfigs()
  })

  // Set active engine
  ipcMain.handle('tts:setActiveEngine', async (_event, engineId: string) => {
    engineManager.setActiveEngine(engineId)
    logService.info('TTS', `切换引擎: ${engineId}`)
    return { success: true }
  })

  // Get active engine ID
  ipcMain.handle('tts:getActiveEngine', async () => {
    return engineManager.getActiveEngineId()
  })

  // Test engine connection
  ipcMain.handle('tts:testEngine', async (_event, engineId: string) => {
    return engineManager.testConnection(engineId)
  })

  // Update Qwen credentials
  ipcMain.handle('tts:updateQwenCredentials', async (_event, apiKey: string, endpoint: string) => {
    engineManager.updateQwenCredentials(apiKey, endpoint)
    return { success: true }
  })

  // Add custom engine
  ipcMain.handle('tts:addEngine', async (_event, config: unknown) => {
    engineManager.addCustomEngine(config as Parameters<EngineManager['addCustomEngine']>[0])
    return { success: true }
  })

  // Update custom engine
  ipcMain.handle('tts:updateEngine', async (_event, config: unknown) => {
    engineManager.updateCustomEngine(config as Parameters<EngineManager['updateCustomEngine']>[0])
    return { success: true }
  })

  // Delete custom engine
  ipcMain.handle('tts:deleteEngine', async (_event, engineId: string) => {
    engineManager.deleteCustomEngine(engineId)
    return { success: true }
  })

  // Discover voices for an engine (auto-fetch from API)
  ipcMain.handle('tts:discoverVoices', async (_event, engineId: string) => {
    return engineManager.discoverVoices(engineId)
  })

  // Discover voices from an unsaved engine form without persisting a temporary engine
  ipcMain.handle('tts:discoverVoicesForConfig', async (_event, config: unknown) => {
    return engineManager.discoverVoicesForConfig(config as Parameters<EngineManager['discoverVoicesForConfig']>[0])
  })

  // Probe a URL to auto-detect engine type and name
  ipcMain.handle('tts:probeEngineUrl', async (_event, apiUrl: string, apiKey?: string) => {
    return engineManager.probeEngineUrl(apiUrl, apiKey)
  })

  // 一键部署：从 JSON 字符串导入引擎配置
  ipcMain.handle('tts:importEngine', async (_event, jsonStr: string) => {
    try {
      return engineManager.importEngine(jsonStr)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logService.error('TTS', '一键部署导入失败', msg)
      return { success: false, error: `部署解析失败：${msg}` }
    }
  })

  // 导出引擎配置为可分享的部署 JSON
  ipcMain.handle('tts:exportEngine', async (_event, engineId: string) => {
    return engineManager.exportEngine(engineId)
  })

  ipcMain.handle('tts:systemAvailable', async () => true)
}
