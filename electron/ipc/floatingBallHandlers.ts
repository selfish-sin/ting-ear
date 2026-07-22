import { ipcMain, BrowserWindow, screen, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { LogService } from '../services/log-service'

let floatingBallWindow: BrowserWindow | null = null

// ====== 模式尺寸常量 ======
// v3 方案：默认胶囊态 260×56；mini 为 320×140
const MODE_SIZES = {
  ball: { width: 260, height: 56 },
  mini: { width: 320, height: 140 }
} as const

// ====== 通信工具 ======

/** 获取主窗口（排除悬浮球窗口） */
function getMainWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('floating')
    ) ?? null
  )
}

/** 向主窗口发送消息 */
export function sendToMainWindow(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args)
}

/** 向悬浮球窗口发送消息 */
export function sendToFloatingBall(channel: string, ...args: unknown[]): void {
  floatingBallWindow?.webContents.send(channel, ...args)
}

/** 获取悬浮球窗口所在显示器 */
function getDisplayForWindow(win: BrowserWindow): Electron.Display {
  const bounds = win.getBounds()
  const { x, y } = bounds
  return (
    screen.getDisplayMatching({ x, y, width: bounds.width, height: bounds.height }) ??
    screen.getPrimaryDisplay()
  )
}

/** 吸附到最近的屏幕边缘 */
function snapToEdge(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const display = getDisplayForWindow(win)
  const workArea = display.workArea
  const centerX = bounds.x + bounds.width / 2

  // 判断更靠近左边还是右边
  const snapLeft = centerX < workArea.x + workArea.width / 2
  const targetX = snapLeft ? workArea.x + 12 : workArea.x + workArea.width - bounds.width - 12

  // Y 轴限制
  const clampedY = Math.max(workArea.y + 40, Math.min(workArea.y + workArea.height - bounds.height - 40, bounds.y))

  // 150ms 平滑吸附
  const steps = 6
  const stepDuration = 25 // 6 * 25 = 150ms
  const startX = bounds.x
  const startY = bounds.y
  const dx = (targetX - startX) / steps
  const dy = (clampedY - startY) / steps

  let step = 0
  const animate = () => {
    step++
    if (step <= steps) {
      win.setPosition(
        Math.round(startX + dx * step),
        Math.round(startY + dy * step)
      )
      setTimeout(animate, stepDuration)
    }
  }
  animate()
}

/** 边缘隐藏：拖到距边缘 < 15px 时隐藏大部分，只留 12px 小把手 */
function handleEdgeHide(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const display = getDisplayForWindow(win)
  const workArea = display.workArea

  if (bounds.x <= workArea.x + 15) {
    // 贴左边缘隐藏：留 12px 把手（仅露出右侧 12px）
    win.setPosition(workArea.x - bounds.width + 12, bounds.y)
  } else if (bounds.x + bounds.width >= workArea.x + workArea.width - 15) {
    // 贴右边缘隐藏：留 12px 把手（仅露出左侧 12px）
    win.setPosition(workArea.x + workArea.width - 12, bounds.y)
  }
}

// ====== 右键菜单构建 ======
function buildContextMenu(options: {
  hasContent: boolean
  isPlaying: boolean
  locked: boolean
}): Electron.Menu {
  const { hasContent, isPlaying, locked } = options

  return Menu.buildFromTemplate([
    {
      label: '📖 打开主窗口',
      click: () => {
        showMainWindow()
      }
    },
    {
      label: '🎵 打开迷你播放器',
      click: () => {
        sendToFloatingBall('fb:command', 'openMiniPlayer')
      }
    },
    {
      label: '📷 截图朗读',
      click: () => {
        showMainWindow()
        sendToMainWindow('fb:request-ocr')
      }
    },
    { type: 'separator' },
    {
      label: isPlaying ? '⏸ 暂停' : '▶ 播放',
      enabled: hasContent,
      click: () => {
        if (isPlaying) {
          sendToMainWindow('fb:pause')
        } else {
          sendToMainWindow('fb:play')
        }
      }
    },
    {
      label: '⏮ 上一句',
      enabled: hasContent,
      click: () => {
        sendToMainWindow('fb:prev')
      }
    },
    {
      label: '⏭ 下一句',
      enabled: hasContent,
      click: () => {
        sendToMainWindow('fb:next')
      }
    },
    { type: 'separator' },
    {
      label: locked ? '📌 解除锁定位置' : '📍 锁定位置',
      click: () => {
        sendToFloatingBall('fb:command', 'toggleLock')
      }
    },
    {
      label: '🧲 吸附屏幕边缘',
      click: () => {
        if (floatingBallWindow) snapToEdge(floatingBallWindow)
      }
    },
    {
      label: '调节透明度',
      submenu: [
        { label: '100%', click: () => setOpacity(1.0) },
        { label: '80%', click: () => setOpacity(0.8) },
        { label: '50%', click: () => setOpacity(0.5) },
        { label: '30%', click: () => setOpacity(0.3) }
      ]
    },
    { type: 'separator' },
    {
      label: '👁 隐藏悬浮球',
      click: () => {
        floatingBallWindow?.hide()
      }
    },
    {
      label: '❌ 退出听伴',
      click: () => {
        const { app } = require('electron')
        ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
        app.quit()
      }
    }
  ])
}

function setOpacity(opacity: number): void {
  if (floatingBallWindow) {
    const clamped = Math.max(0.3, Math.min(1.0, opacity))
    floatingBallWindow.setOpacity(clamped)
    sendToFloatingBall('fb:command', 'opacityChanged', clamped)
  }
}

export function showMainWindow(): void {
  const main = getMainWindow()
  main?.show()
  main?.focus()
  // 展开主窗口时，根据设置决定是否隐藏悬浮球
  const settings = getFloatingBallSettings()
  if (settings.hideWhenMainWindowOpen) {
    floatingBallWindow?.hide()
  }
}

/** 获取悬浮球设置（简化版，从主窗口同步过来） */
function getFloatingBallSettings(): {
  hideWhenMainWindowOpen: boolean
  autoSnap: boolean
} {
  // 默认值，实际由主窗口 renderer 通过 IPC 传入
  return { hideWhenMainWindowOpen: true, autoSnap: true }
}

// ====== 窗口创建 ======
function createFloatingBallWindow(logService: LogService): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea

  // 默认位置：屏幕右侧，距右边 16px，距底部 180px（胶囊宽 260）
  const defaultX = workArea.x + workArea.width - 260 - 16
  const defaultY = workArea.y + workArea.height - 56 - 180

  floatingBallWindow = new BrowserWindow({
    width: 260,
    height: 56,
    x: defaultX,
    y: defaultY,
    icon: is.dev ? join(__dirname, '../../icon.ico') : join(process.resourcesPath, 'icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  floatingBallWindow.on('closed', () => {
    floatingBallWindow = null
  })

  floatingBallWindow.on('ready-to-show', () => {
    floatingBallWindow?.show()
    logService.info('UI', '悬浮球已显示')
  })

  // 监听窗口移动完成事件（用于吸附）。
  // 注意：`moved` 在系统原生 drag 过程中会持续触发，不能在拖拽中途做吸附/边缘隐藏，
  // 否则窗口会被瞬间推到屏外导致"飞走"。只在松手后（(bounds 稳定）再处理。
  let lastMovedAt = 0
  let moveDebounce: NodeJS.Timeout | null = null
  floatingBallWindow.on('moved', () => {
    if (!floatingBallWindow) return
    lastMovedAt = Date.now()
    // 200ms 内没有新的 moved 事件，说明用户已松手，再做边缘判断
    if (moveDebounce) clearTimeout(moveDebounce)
    moveDebounce = setTimeout(() => {
      if (!floatingBallWindow) return
      const bounds = floatingBallWindow.getBounds()
      const display = getDisplayForWindow(floatingBallWindow)
      const workArea = display.workArea

      // 检测边缘隐藏（仅在真正贴边时触发）
      if (bounds.x <= workArea.x + 15 || bounds.x + bounds.width >= workArea.x + workArea.width - 15) {
        handleEdgeHide(floatingBallWindow)
      }
      void lastMovedAt
    }, 200)
  })

  if (is.dev) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      floatingBallWindow.loadURL(`${devUrl}#/floating`)
    } else {
      floatingBallWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/floating' })
    }
  } else {
    floatingBallWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/floating' })
  }

  return floatingBallWindow
}

// ====== 注册 IPC 处理器 ======
/** 显示悬浮球；窗口不存在时按需创建，重复调用不会创建多个窗口。 */
export function showFloatingBallWindow(logService: LogService): void {
  try {
    if (!floatingBallWindow) {
      createFloatingBallWindow(logService)
    } else {
      floatingBallWindow.show()
      floatingBallWindow.focus()
    }
    logService.info('UI', '切换至悬浮球模式')
  } catch (error) {
    logService.error('UI', `显示悬浮球失败: ${String(error)}`)
  }
}

export function registerFloatingBallHandlers(logService: LogService): void {
  ipcMain.handle('floatingball:show', async () => {
    showFloatingBallWindow(logService)
  })

  ipcMain.handle('floatingball:hide', async () => {
    floatingBallWindow?.hide()
    logService.info('UI', '悬浮球已隐藏')
  })

  ipcMain.handle('floatingball:setOpacity', async (_e, opacity: number) => {
    setOpacity(opacity)
  })

  ipcMain.handle('floatingball:setLocked', async (_e, locked: boolean) => {
    // 锁定状态由 renderer 管理，这里可以持久化
    logService.info('UI', `悬浮球位置${locked ? '锁定' : '解锁'}`)
  })

  ipcMain.handle('floatingball:snapToEdge', async () => {
    if (floatingBallWindow) {
      snapToEdge(floatingBallWindow)
    }
  })

  // === 窗口几何控制 ===
  ipcMain.handle('floatingball:getBounds', async () => {
    if (!floatingBallWindow) return null
    const bounds = floatingBallWindow.getBounds()
    return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }
  })

  ipcMain.handle('floatingball:setPosition', async (_e, x: number, y: number) => {
    if (!floatingBallWindow) return
    const display = getDisplayForWindow(floatingBallWindow)
    const workArea = display.workArea
    const h = floatingBallWindow.getBounds().height
    // Y 轴限制
    const clampedY = Math.max(workArea.y + 40, Math.min(workArea.y + workArea.height - h - 40, y))
    floatingBallWindow.setPosition(Math.round(x), Math.round(clampedY))
  })

  ipcMain.handle('floatingball:resize', async (_e, mode: string) => {
    if (!floatingBallWindow) return
    const size = MODE_SIZES[mode as keyof typeof MODE_SIZES] ?? MODE_SIZES.ball
    const bounds = floatingBallWindow.getBounds()
    // 保持右边缘锚定
    const newX = bounds.x + bounds.width - size.width
    floatingBallWindow.setBounds({
      x: newX,
      y: bounds.y,
      width: size.width,
      height: size.height
    })
  })

  ipcMain.handle('floatingball:setMode', async (_e, mode: string) => {
    // 模式切换由 renderer 触发 resize
    if (!floatingBallWindow) return
    const size = MODE_SIZES[mode as keyof typeof MODE_SIZES] ?? MODE_SIZES.ball
    const bounds = floatingBallWindow.getBounds()
    const newX = bounds.x + bounds.width - size.width
    floatingBallWindow.setBounds({
      x: newX,
      y: bounds.y,
      width: size.width,
      height: size.height
    })
  })

  // === 播放控制（转发到主窗口） ===
  ipcMain.handle('floatingball:play', async () => {
    sendToMainWindow('fb:play')
  })
  ipcMain.handle('floatingball:pause', async () => {
    sendToMainWindow('fb:pause')
  })
  ipcMain.handle('floatingball:togglePlay', async () => {
    sendToMainWindow('fb:toggle-play')
  })
  ipcMain.handle('floatingball:prev', async () => {
    sendToMainWindow('fb:prev')
  })
  ipcMain.handle('floatingball:next', async () => {
    sendToMainWindow('fb:next')
  })
  ipcMain.handle('floatingball:seekTo', async (_e, sentenceIndex: number) => {
    sendToMainWindow('fb:seekTo', sentenceIndex)
  })

  // === 展开主窗口 ===
  ipcMain.handle('floatingball:expand', async () => {
    showMainWindow()
  })

  // === 右键菜单 ===
  ipcMain.handle('floatingball:showContextMenu', async (_e, state: unknown) => {
    if (!floatingBallWindow) return
    const s = state as { hasContent?: boolean; isPlaying?: boolean; locked?: boolean }
    const menu = buildContextMenu({
      hasContent: s?.hasContent ?? false,
      isPlaying: s?.isPlaying ?? false,
      locked: s?.locked ?? false
    })
    menu.popup({ window: floatingBallWindow })
  })

  // === 状态转发（主窗口 → 悬浮球） ===
  ipcMain.on('floatingball:updateState', (_event, state: unknown) => {
    sendToFloatingBall('fb:update-state', state)
  })
  ipcMain.handle('floatingball:updateStateSync', async (_event, state: unknown) => {
    sendToFloatingBall('fb:update-state', state)
  })

  // === 获取播放器快照 ===
  ipcMain.handle('player:getSnapshot', async () => {
    // 主进程不直接持有播放状态，转发给主窗口
    const main = getMainWindow()
    if (!main) return null
    // 通过 webContents.executeJavaScript 获取 snapshot
    try {
      return await main.webContents.executeJavaScript(`
        (() => {
          // 此函数在主窗口的 renderer context 中执行
          if (typeof window === 'undefined' || !window.__zingo_getSnapshot) return null;
          return window.__zingo_getSnapshot();
        })()
      `)
    } catch {
      return null
    }
  })

  // === 窗口显示/隐藏主窗口 ===
  ipcMain.handle('window:showMain', async () => {
    showMainWindow()
  })
  ipcMain.handle('window:hideMain', async () => {
    getMainWindow()?.hide()
  })

  // === 退出应用 ===
  ipcMain.handle('app:quit', async () => {
    const { app } = require('electron')
    ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
    app.quit()
  })
}

/** 检查悬浮球窗口是否存在 */
export function getFloatingBallWindow(): BrowserWindow | null {
  return floatingBallWindow
}
