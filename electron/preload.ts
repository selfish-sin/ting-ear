import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { SubtitleStyle } from '../src/global'

// Custom APIs for renderer
const api = {
  // === File operations ===
  selectFile: () => ipcRenderer.invoke('file:select'),
  importFile: (filePath: string) => ipcRenderer.invoke('file:import', filePath),
  saveProgress: (data: unknown) => ipcRenderer.invoke('file:saveProgress', data),
  loadProgress: () => ipcRenderer.invoke('file:loadProgress'),
  loadAlbums: () => ipcRenderer.invoke('album:load'),
  saveAlbums: (albums: unknown) => ipcRenderer.invoke('album:save', albums),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('file:saveSettings', settings),
  loadSettings: () => ipcRenderer.invoke('file:loadSettings'),
  deleteBook: (bookId: string) => ipcRenderer.invoke('file:deleteBook', bookId),
  reprocessBook: (bookId: string) => ipcRenderer.invoke('book:reprocess', bookId),
  exportBookmarks: (bookId: string) => ipcRenderer.invoke('file:exportBookmarks', bookId),

  // === Cover operations ===
  saveCover: (bookId: string, dataUrl: string) => ipcRenderer.invoke('cover:save', bookId, dataUrl),
  uploadCover: (bookId: string) => ipcRenderer.invoke('cover:upload', bookId),
  getCover: (bookId: string) => ipcRenderer.invoke('cover:get', bookId),
  getCoverDataUrl: (bookId: string) => ipcRenderer.invoke('cover:getDataUrl', bookId),

  // === TTS operations ===
  ttsSynthesize: (text: string, voice: string, speed: number, volume: number, engineId?: string) =>
    ipcRenderer.invoke('tts:synthesize', text, voice, speed, volume, engineId),
  systemTTSAvailable: () => ipcRenderer.invoke('tts:systemAvailable'),
  ttsGetVoices: (engineId?: string) => ipcRenderer.invoke('tts:getVoices', engineId),
  ttsGetEngines: () => ipcRenderer.invoke('tts:getEngines'),
  ttsGetActiveEngine: () => ipcRenderer.invoke('tts:getActiveEngine'),
  ttsSetActiveEngine: (engineId: string) => ipcRenderer.invoke('tts:setActiveEngine', engineId),
  ttsTestEngine: (engineId: string) => ipcRenderer.invoke('tts:testEngine', engineId),
  ttsAddEngine: (config: unknown) => ipcRenderer.invoke('tts:addEngine', config),
  ttsUpdateEngine: (config: unknown) => ipcRenderer.invoke('tts:updateEngine', config),
  ttsDeleteEngine: (engineId: string) => ipcRenderer.invoke('tts:deleteEngine', engineId),
  /** 试听：用指定引擎+音色合成一句示例文本，返回 base64 mp3 */
  ttsPreviewVoice: (engineId: string, voiceId: string) =>
    ipcRenderer.invoke('tts:previewVoice', engineId, voiceId),
  /** 自动发现引擎音色列表 */
  ttsDiscoverVoices: (engineId: string) => ipcRenderer.invoke('tts:discoverVoices', engineId),
  /** 从未保存的引擎表单配置自动发现音色列表 */
  ttsDiscoverVoicesForConfig: (config: unknown) =>
    ipcRenderer.invoke('tts:discoverVoicesForConfig', config),
  /** 探测 API URL，返回建议名称和类型 */
  ttsProbeEngineUrl: (apiUrl: string, apiKey?: string) =>
    ipcRenderer.invoke('tts:probeEngineUrl', apiUrl, apiKey),
  /** 一键部署：从 JSON 字符串导入引擎 */
  ttsImportEngine: (jsonStr: string) => ipcRenderer.invoke('tts:importEngine', jsonStr),
  /** 导出引擎为可分享的部署 JSON */
  ttsExportEngine: (engineId: string) => ipcRenderer.invoke('tts:exportEngine', engineId),

  // === Bookmark operations ===
  saveBookmarks: (bookmarks: unknown) => ipcRenderer.invoke('bookmark:save', bookmarks),
  loadBookmarks: () => ipcRenderer.invoke('bookmark:load'),

  // === Log operations ===
  loadLogs: () => ipcRenderer.invoke('log:load'),
  clearLogs: () => ipcRenderer.invoke('log:clear'),

  // === History operations ===
  loadHistory: () => ipcRenderer.invoke('history:load'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  saveHistory: (entry: unknown) => ipcRenderer.invoke('history:save', entry),

  // === Window operations ===
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  windowSetOpacity: (opacity: number) => ipcRenderer.invoke('window:setOpacity', opacity),
  windowSetAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),

  // === Floating ball ===
  showFloatingBall: () => ipcRenderer.invoke('floatingball:show'),
  hideFloatingBall: () => ipcRenderer.invoke('floatingball:hide'),
  floatingBallSetMode: (mode: string) => ipcRenderer.invoke('floatingball:setMode', mode),
  floatingBallSetOpacity: (opacity: number) =>
    ipcRenderer.invoke('floatingball:setOpacity', opacity),
  floatingBallSetLocked: (locked: boolean) => ipcRenderer.invoke('floatingball:setLocked', locked),
  floatingBallSnapToEdge: () => ipcRenderer.invoke('floatingball:snapToEdge'),

  // === Window control ===
  windowShowMain: () => ipcRenderer.invoke('window:showMain'),
  windowHideMain: () => ipcRenderer.invoke('window:hideMain'),

  // === App ===
  appQuit: () => ipcRenderer.invoke('app:quit'),

  // === Floating ball state push (renderer → main → floating ball) ===
  updateFloatingBallState: (state: unknown) => ipcRenderer.send('floatingball:updateState', state),

  // === Log stream listener ===
  onLogEntry: (callback: (entry: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => callback(entry)
    ipcRenderer.on('log:new-entry', handler)
    return () => {
      ipcRenderer.removeListener('log:new-entry', handler)
    }
  },

  // === Screenshot OCR (in addition to floating ball right-click) ===
  startScreenshotOcr: () => ipcRenderer.invoke('ocr:startScreenshot'),

  // === Screenshot selection window renderer helpers ===
  getScreenshotDataUrl: () => ipcRenderer.invoke('ocr:getScreenshotDataUrl'),
  submitOcrSelection: (data: { dataUrl: string; x: number; y: number; w: number; h: number }) =>
    ipcRenderer.invoke('ocr:selectionComplete', data),
  cancelOcrSelection: () => ipcRenderer.invoke('ocr:cancel'),

  // === Tray events ===
  onTrayTogglePlay: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('tray:toggle-play', handler)
    return () => {
      ipcRenderer.removeListener('tray:toggle-play', handler)
    }
  },
  onTrayPrevSentence: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('tray:prev-sentence', handler)
    return () => {
      ipcRenderer.removeListener('tray:prev-sentence', handler)
    }
  },
  onTrayNextSentence: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('tray:next-sentence', handler)
    return () => {
      ipcRenderer.removeListener('tray:next-sentence', handler)
    }
  },

  // === Floating ball events (from main process) ===
  onFloatingBallPlay: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:play', handler)
    return () => {
      ipcRenderer.removeListener('fb:play', handler)
    }
  },
  onFloatingBallPause: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:pause', handler)
    return () => {
      ipcRenderer.removeListener('fb:pause', handler)
    }
  },
  onFloatingBallPrev: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:prev', handler)
    return () => {
      ipcRenderer.removeListener('fb:prev', handler)
    }
  },
  onFloatingBallNext: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:next', handler)
    return () => {
      ipcRenderer.removeListener('fb:next', handler)
    }
  },
  onFloatingBallExpand: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:expand', handler)
    return () => {
      ipcRenderer.removeListener('fb:expand', handler)
    }
  },
  onFloatingBallRequestOcr: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:request-ocr', handler)
    return () => {
      ipcRenderer.removeListener('fb:request-ocr', handler)
    }
  },
  onFloatingBallReadClipboard: (callback: (text: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => callback(text)
    ipcRenderer.on('fb:read-clipboard', handler)
    return () => {
      ipcRenderer.removeListener('fb:read-clipboard', handler)
    }
  },
  onFloatingBallPrevChapter: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:prevChapter', handler)
    return () => {
      ipcRenderer.removeListener('fb:prevChapter', handler)
    }
  },
  onFloatingBallNextChapter: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fb:nextChapter', handler)
    return () => {
      ipcRenderer.removeListener('fb:nextChapter', handler)
    }
  },
  onFloatingBallSeekTo: (callback: (index: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, index: number) => callback(index)
    ipcRenderer.on('fb:seekTo', handler)
    return () => {
      ipcRenderer.removeListener('fb:seekTo', handler)
    }
  },
  onOcrResult: (callback: (text: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => callback(text)
    ipcRenderer.on('ocr:result', handler)
    return () => {
      ipcRenderer.removeListener('ocr:result', handler)
    }
  },
  onOcrError: (callback: (msg: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => callback(msg)
    ipcRenderer.on('ocr:error', handler)
    return () => {
      ipcRenderer.removeListener('ocr:error', handler)
    }
  },

  // === Custom global shortcuts (player) ===
  applyShortcuts: (shortcuts: Record<string, string>) => {
    ipcRenderer.send('shortcuts:update', shortcuts)
  },
  onShortcut: (callback: (action: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('shortcut:action', handler)
    return () => {
      ipcRenderer.removeListener('shortcut:action', handler)
    }
  },

  // === Audio export ===
  exportAudio: (params: {
    sentences: string[]
    voiceId: string
    speed: number
    startIndex: number
    endIndex: number
    defaultName: string
  }) => ipcRenderer.invoke('export:audio', params),

  // === Export events ===
  onExportProgress: (callback: (data: { current: number; total: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { current: number; total: number }) =>
      callback(data)
    ipcRenderer.on('export:progress', handler)
    return () => {
      ipcRenderer.removeListener('export:progress', handler)
    }
  },
  onExportComplete: (callback: (data: { filePath: string; size: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { filePath: string; size: number }) =>
      callback(data)
    ipcRenderer.on('export:complete', handler)
    return () => {
      ipcRenderer.removeListener('export:complete', handler)
    }
  },
  onExportError: (callback: (data: { message: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    ipcRenderer.on('export:error', handler)
    return () => {
      ipcRenderer.removeListener('export:error', handler)
    }
  },

  // === 桌面字幕 ===
  subtitleShow: () => ipcRenderer.invoke('subtitle:show'),
  subtitleHide: () => ipcRenderer.invoke('subtitle:hide'),
  subtitleToggle: () => ipcRenderer.invoke('subtitle:toggle'),
  subtitleGetStyle: () => ipcRenderer.invoke('subtitle:getStyle'),
  subtitleSetStyle: (style: unknown) => ipcRenderer.invoke('subtitle:setStyle', style),
  subtitleSendUpdate: (data: {
    text: string
    bookTitle?: string
    chapterTitle?: string
    isPlaying?: boolean
    hasContent?: boolean
    progressPercent?: number
  }) => ipcRenderer.send('subtitle:sendUpdate', data),
  onSubtitleHidden: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('subtitle:hidden', handler)
    return () => {
      ipcRenderer.removeListener('subtitle:hidden', handler)
    }
  },
  onSubtitleStyleChanged: (callback: (style: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, style: unknown) => callback(style as SubtitleStyle)
    ipcRenderer.on('subtitle:styleChanged', handler)
    return () => {
      ipcRenderer.removeListener('subtitle:styleChanged', handler)
    }
  },
  // 字幕窗口播放控制 → 主窗口
  onSubtitlePlay: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('subtitle:play', handler)
    return () => { ipcRenderer.removeListener('subtitle:play', handler) }
  },
  onSubtitlePause: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('subtitle:pause', handler)
    return () => { ipcRenderer.removeListener('subtitle:pause', handler) }
  },
  onSubtitlePrev: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('subtitle:prev', handler)
    return () => { ipcRenderer.removeListener('subtitle:prev', handler) }
  },
  onSubtitleNext: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('subtitle:next', handler)
    return () => { ipcRenderer.removeListener('subtitle:next', handler) }
  },

  // === Text cleaning (LLM) ===
  cleanTextWithLLM: (params: { text: string; configId?: string }) =>
    ipcRenderer.invoke('text:cleanWithLLM', params),
  cancelClean: (taskId: string) => ipcRenderer.invoke('text:cancelClean', taskId),
  /** 快速清洗（纯正则，秒出，不调 LLM） */
  enhancedClean: (text: string) =>
    ipcRenderer.invoke('text:enhancedClean', { text }) as Promise<{
      success: boolean
      text: string
      originalLength: number
      cleanedLength: number
    }>,
  onCleanProgress: (callback: (p: { current: number; total: number; phase: string }) => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      p: { current: number; total: number; phase: string }
    ) => callback(p)
    ipcRenderer.on('text:cleanProgress', handler)
    return () => {
      ipcRenderer.removeListener('text:cleanProgress', handler)
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCleanComplete: (callback: (data: any) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (_e: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('text:cleanComplete', handler)
    return () => {
      ipcRenderer.removeListener('text:cleanComplete', handler)
    }
  },

  // === AI 审校（已禁用）===
  reviewWithLLM: null as unknown as any,
  cancelReview: null as unknown as any,
  onReviewProgress: null as unknown as any,
  onReviewComplete: null as unknown as any,

  // === LLM 配置管理 ===
  getLlmConfigs: () => ipcRenderer.invoke('llm:getConfigs'),
  saveLlmConfigs: (configs: unknown) => ipcRenderer.invoke('llm:saveConfigs', configs),
  getActiveLlmId: () => ipcRenderer.invoke('llm:getActiveId'),
  setActiveLlmId: (id: string) => ipcRenderer.invoke('llm:setActiveId', id),
  testLlmConnection: (configId: string) => ipcRenderer.invoke('llm:testConnection', configId),
  fetchModels: (config: unknown) => ipcRenderer.invoke('llm:fetchModels', config),
  clearCache: (type: string) => ipcRenderer.invoke('data:clearCache', type)
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error non-context-isolated fallback
  window.electron = electronAPI
  // @ts-expect-error non-context-isolated fallback
  window.api = api
}
