import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Custom flag on the app instance to track quit intent
interface AppWithQuitFlag {
  isQuitting?: boolean
}
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerTtsHandlers } from './ipc/ttsHandlers'
import { registerWindowHandlers } from './ipc/windowHandlers'
import { registerBookmarkHandlers } from './ipc/bookmarkHandlers'
import { registerLogHandlers } from './ipc/logHandlers'
import { registerHistoryHandlers } from './ipc/historyHandlers'
import { registerFloatingBallHandlers, sendToMainWindow, showFloatingBallWindow, showMainWindow } from './ipc/floatingBallHandlers'
import { LogService } from './services/log-service'
import { SettingsService } from './services/settings-service'
import { EngineManager } from './services/tts-engines/engine-manager'
import { QwenAdapter } from './services/tts-engines/qwen-adapter'
import { registerOcrHandlers, preheatOcr } from './ipc/ocrHandlers'
import { registerTextCleanHandlers } from './ipc/textCleanHandlers'
import { registerSubtitleHandlers } from './ipc/subtitleHandlers'
import { SHORTCUT_ACTION_LIST, normalizeShortcuts } from '../src/shortcuts'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let logService: LogService | null = null
let settingsService: SettingsService | null = null
let engineManager: EngineManager | null = null

function createWindow(): BrowserWindow {
  const iconPath = is.dev
    ? join(__dirname, '../../icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: false,
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    logService?.info('System', '应用窗口已显示')
  })

  // Close window -> minimize to tray
  mainWindow.on('close', (event) => {
    if (mainWindow && !(app as AppWithQuitFlag).isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      if (settingsService?.get().floatingBallEnabled && logService) {
        showFloatingBallWindow(logService)
      }
      logService?.info('UI', '窗口最小化到托盘')
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function createTray(): Tray {
  // 使用项目根目录的 icon.ico
  const iconPath = is.dev
    ? join(__dirname, '../../icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    logService?.warn('UI', 'Tray 图标加载失败，使用空图标')
  }

  tray = new Tray(icon)
  tray.setToolTip('听伴 - 智能有声读物助手')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📖 显示主窗口',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    { label: '⏯️  暂停/播放', click: () => sendToMainWindow('tray:toggle-play') },
    { label: '⏮️  上一句', click: () => sendToMainWindow('tray:prev-sentence') },
    { label: '⏭️  下一句', click: () => sendToMainWindow('tray:next-sentence') },
    { type: 'separator' },
    {
      label: '⚙️  设置',
      click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('tray:open-settings')
      }
    },
    { type: 'separator' },
    {
      label: '❌ 退出听伴',
      click: () => {
        logService?.info('System', '应用退出')
        ;(app as AppWithQuitFlag).isQuitting = true
        mainWindow?.destroy()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  tray.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  return tray
}

// 自定义全局快捷键（播放器控制），可运行时更新
const registeredShortcuts: string[] = []

function clearCustomShortcuts(): void {
  for (const acc of registeredShortcuts) {
    globalShortcut.unregister(acc)
  }
  registeredShortcuts.length = 0
}

function registerCustomShortcuts(shortcuts?: Record<string, string>): void {
  clearCustomShortcuts()
  if (!shortcuts) return
  for (const item of SHORTCUT_ACTION_LIST) {
    const accelerator = shortcuts[item.key]
    if (!accelerator) continue // 空串 = 禁用该动作
    try {
      const ok = globalShortcut.register(accelerator, () => {
        logService?.debug('Hotkey', `自定义全局快捷键触发：${item.key}`)
        sendToMainWindow('shortcut:action', item.key)
      })
      if (ok) {
        registeredShortcuts.push(accelerator)
      } else {
        logService?.warn('Hotkey', `快捷键注册失败（可能冲突）：${item.key} -> ${accelerator}`)
      }
    } catch {
      logService?.warn('Hotkey', `快捷键格式无效：${item.key} -> ${accelerator}`)
    }
  }
}

// 注册自定义播放控制全局快捷键（读取已持久化的设置）
function registerGlobalHotkeys(): void {
  registerCustomShortcuts(normalizeShortcuts(settingsService?.get().shortcuts))
}

// 单实例锁：再次启动时不新开进程，而是聚焦已有窗口
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

app.whenReady().then(async () => {
  if (!gotTheLock) return
  electronApp.setAppUserModelId('com.tingear.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize services
  logService = new LogService()
  settingsService = new SettingsService()
  await settingsService.load()

  logService.info('System', `听伴 v3.0 启动 | Electron ${process.versions.electron} | Node ${process.versions.node}`)

  createWindow()
  LogService.setMainWindow(mainWindow)  // 实时推送日志到渲染进程
  createTray()

  // Create EngineManager synchronously first so all IPC handlers can reference it,
  // then register ALL handlers before the async init — this ensures window controls
  // and other handlers are available immediately when the renderer loads.
  engineManager = new EngineManager()
  registerFileHandlers(logService, settingsService, engineManager)
  registerTtsHandlers(logService, engineManager)
  registerWindowHandlers(logService, mainWindow)
  registerBookmarkHandlers(logService)
  registerLogHandlers(logService)
  registerHistoryHandlers(logService)
  registerFloatingBallHandlers(logService)
  registerOcrHandlers(logService)
  registerTextCleanHandlers(settingsService, engineManager, logService)
  registerSubtitleHandlers(logService)

  // NOW initialize the TTS engine (async — does not block IPC handler registration)
  const settings = settingsService.get()
  try {
    await engineManager.init(settings.qwenApiKey, settings.qwenEndpoint)
    console.info('[Main] EngineManager initialized successfully')
  } catch (e) {
    console.error('[Main] EngineManager init failed:', e)
    logService.error('System', `TTS 引擎初始化失败: ${e instanceof Error ? e.message : String(e)}`)
    // 即使 TTS 失败也要继续启动 — 用户还能用其他功能
  }
  // 活动引擎以用户设置为准（默认 'edge' 免费可用；用户在设置里可改）
  engineManager.setActiveEngine(settings.ttsEngine || 'edge')
  QwenAdapter.cleanupCache()  // 清除超过 10 天的音频缓存

  preheatOcr(logService)  // 后台异步预热，不阻塞启动

  // 运行时更新自定义全局快捷键（来自设置页）
  ipcMain.on('shortcuts:update', (_event, shortcuts: Record<string, string>) => {
    registerCustomShortcuts(shortcuts)
  })

  // Register global hotkeys
  registerGlobalHotkeys()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Keep running in tray; uncomment to quit:
  // if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ;(app as AppWithQuitFlag).isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

process.on('uncaughtException', (error) => {
  logService?.error('System', `未捕获异常: ${error.message}`, error.stack)
})
