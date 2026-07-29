import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, protocol, net } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// 开发模式下开启远程调试，便于性能排查（生产环境无 effect）
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 封面自定义协议：渲染层用 ting-cover://x/{bookId} 直接读盘，避免启动时把 PNG 全转 base64 过 IPC
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ting-cover',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true
    }
  }
])

// Custom flag on the app instance to track quit intent
interface AppWithQuitFlag {
  isQuitting?: boolean
}
import { registerFileHandlers, setCustomDataDir, flushLibraryProgressOnQuit, getDataDir } from './ipc/fileHandlers'
import { registerTtsHandlers } from './ipc/ttsHandlers'
import { registerWindowHandlers } from './ipc/windowHandlers'
import { registerBookmarkHandlers } from './ipc/bookmarkHandlers'
import { registerLogHandlers } from './ipc/logHandlers'
import { registerHistoryHandlers } from './ipc/historyHandlers'
import { registerAiHandlers } from './ipc/aiHandlers'
import { registerFloatingBallHandlers, sendToMainWindow, showFloatingBallWindow, showMainWindow } from './ipc/floatingBallHandlers'
import { LogService } from './services/log-service'
import { SettingsService } from './services/settings-service'
import { EngineManager } from './services/tts-engines/engine-manager'
import { QwenAdapter } from './services/tts-engines/qwen-adapter'
import { EdgeAdapter } from './services/tts-engines/edge-adapter'
import { registerOcrHandlers, preheatOcr } from './ipc/ocrHandlers'
import { registerTextCleanHandlers } from './ipc/textCleanHandlers'
import { registerSubtitleHandlers } from './ipc/subtitleHandlers'
import { SHORTCUT_ACTION_LIST, normalizeShortcuts } from '../src/shortcuts'
import { safeOpenExternal } from './utils/safeOpenExternal'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let logService: LogService | null = null
let settingsService: SettingsService | null = null
let engineManager: EngineManager | null = null

function createWindow(): BrowserWindow {
  const iconPath = is.dev
    ? join(__dirname, '../../icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  const preferAlwaysOnTop = settingsService?.get().windowAlwaysOnTop ?? false

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: false,
    alwaysOnTop: preferAlwaysOnTop,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true
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
    void safeOpenExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL()
    if (currentUrl && url !== currentUrl) event.preventDefault()
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

  // Initialize services（先加载 settings，再 createWindow，以便 alwaysOnTop 默认值生效）
  logService = new LogService()
  settingsService = new SettingsService()
  await settingsService.load()

  // 应用自定义数据目录（settings.json 始终在默认位置）
  const customDir = (settingsService.get() as { dataDir?: string }).dataDir
  if (customDir) {
    setCustomDataDir(customDir)
    // 日志目录随 dataDir 切换，重新加载目标目录中的日志
    logService.reloadFromDisk()
    logService.info('System', `使用自定义数据目录: ${customDir}`)
  }

  // 封面协议：ting-cover://x/{bookId} → covers/{bookId}.png（零 base64、零 IPC）
  protocol.handle('ting-cover', (request) => {
    try {
      const u = new URL(request.url)
      // pathname 形如 /{bookId} 或 /{bookId}.png
      const raw = decodeURIComponent(u.pathname.replace(/^\//, '')).replace(/\.png$/i, '')
      const bookId = raw || u.hostname
      if (!bookId || bookId === 'x') {
        return new Response('missing id', { status: 400 })
      }
      const coverPath = join(getDataDir(), 'covers', `${bookId}.png`)
      if (!existsSync(coverPath)) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(coverPath).href)
    } catch {
      return new Response('error', { status: 500 })
    }
  })

  logService.info('System', `听伴 v1.0 启动 | Electron ${process.versions.electron} | Node ${process.versions.node}`)

  createWindow()
  LogService.setMainWindow(mainWindow)  // 实时推送日志到渲染进程
  createTray()

  // 退出前强制刷日志，避免批量缓冲丢失
  app.on('before-quit', () => {
    logService?.flushSync()
  })

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
  registerAiHandlers(settingsService, logService)
  registerFloatingBallHandlers(logService)
  registerOcrHandlers(logService)
  registerTextCleanHandlers(settingsService, logService)
  registerSubtitleHandlers(logService)

  // NOW initialize the TTS engine — 不阻塞启动，后台并行初始化
  const settings = settingsService.get()
  void engineManager!.init(settings.qwenApiKey, settings.qwenEndpoint)
    .then(() => {
      console.info('[Main] EngineManager initialized successfully')
      engineManager!.setActiveEngine(settings.ttsEngine || 'edge')
      // 缓存清理延后到空闲，避免启动时扫盘抢 I/O
      setTimeout(() => {
        try {
          QwenAdapter.cleanupCache()
          EdgeAdapter.cleanupCache()
        } catch {
          /* ignore */
        }
      }, 15000)
    })
    .catch((e) => {
      console.error('[Main] EngineManager init failed:', e)
      logService!.error('System', `TTS 引擎初始化失败: ${e instanceof Error ? e.message : String(e)}`)
    })
  // 活动引擎以用户设置为准（默认 'edge' 免费可用；用户在设置里可改）
  // engineManager.setActiveEngine 已移到 init 回调中

  // OCR 预热延后：Python 冷启动很重，用户截图前再热也能接受
  setTimeout(() => {
    if (logService) preheatOcr(logService)
  }, 8000)

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
  flushLibraryProgressOnQuit()
  globalShortcut.unregisterAll()
})

process.on('uncaughtException', (error) => {
  logService?.error('System', `未捕获异常: ${error.message}`, error.stack)
})
