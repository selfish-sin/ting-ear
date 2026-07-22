import { ipcMain, BrowserWindow, screen, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { LogService } from '../services/log-service'

let subtitleWindow: BrowserWindow | null = null

export interface SubtitleStyle {
  fontSize: number
  fontColor: string
  bgColor: string
  opacity: number
  maxWidth: number
}

const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 20,
  fontColor: '#FFFFFF',
  bgColor: 'rgba(0, 0, 0, 0.80)',
  opacity: 0.95,
  maxWidth: 960
}

/** 缓存最后一次字幕数据 */
let lastSubtitleText = ''
let lastBookTitle = ''
let lastChapterTitle = ''
let lastPlaying = false
let lastHasContent = false
let lastProgress = 0

let currentStyle: SubtitleStyle = { ...DEFAULT_STYLE }

/** 获取主窗口（排除悬浮球、字幕、截图窗口） */
function getMainWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find((w) => {
      const url = w.webContents.getURL()
      return !url.includes('floating') && !url.includes('subtitle') && !url.includes('screenshot')
    }) ?? null
  )
}

/** 向字幕窗口发送消息 */
function sendToSubtitle(channel: string, ...args: unknown[]): void {
  subtitleWindow?.webContents.send(channel, ...args)
}

/** 向主窗口发送消息 */
function sendToMain(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args)
}

/** 获取字幕窗口所在显示器 */
function getDisplayForWindow(win: BrowserWindow): Electron.Display {
  const bounds = win.getBounds()
  return (
    screen.getDisplayMatching({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }) ??
    screen.getPrimaryDisplay()
  )
}

/** 创建字幕窗口 */
function createSubtitleWindow(logService: LogService): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea

  const defaultWidth = 820
  const defaultHeight = 170
  const defaultX = Math.round(workArea.x + (workArea.width - defaultWidth) / 2)
  const defaultY = Math.round(workArea.y + workArea.height - defaultHeight - 40)

  subtitleWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 420,
    minHeight: 130,
    x: defaultX,
    y: defaultY,
    icon: is.dev ? join(__dirname, '../../icon.ico') : join(process.resourcesPath, 'icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
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

  subtitleWindow.setAlwaysOnTop(true, 'screen-saver')

  subtitleWindow.on('closed', () => {
    subtitleWindow = null
  })

  subtitleWindow.on('ready-to-show', () => {
    subtitleWindow?.show()
    // 推送缓存的状态
    sendToSubtitle('subtitle:update', {
      text: lastSubtitleText,
      bookTitle: lastBookTitle,
      chapterTitle: lastChapterTitle,
      style: currentStyle
    })
    sendToSubtitle('subtitle:state', {
      isPlaying: lastPlaying,
      hasContent: lastHasContent,
      progressPercent: lastProgress
    })
    logService.info('UI', '字幕窗口已显示')
  })

  if (is.dev) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      subtitleWindow.loadURL(`${devUrl}#/subtitle`)
    } else {
      subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/subtitle' })
    }
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/subtitle' })
  }

  return subtitleWindow
}

/** 显示字幕窗口 */
export function showSubtitleWindow(logService: LogService): void {
  try {
    if (!subtitleWindow) {
      createSubtitleWindow(logService)
    } else {
      subtitleWindow.show()
      sendToSubtitle('subtitle:update', {
        text: lastSubtitleText,
        bookTitle: lastBookTitle,
        chapterTitle: lastChapterTitle,
        style: currentStyle
      })
      sendToSubtitle('subtitle:state', {
        isPlaying: lastPlaying,
        hasContent: lastHasContent,
        progressPercent: lastProgress
      })
    }
    logService.info('UI', '字幕窗口已打开')
  } catch (error) {
    logService.error('UI', `显示字幕窗口失败: ${String(error)}`)
  }
}

/** 隐藏字幕窗口 */
export function hideSubtitleWindow(): void {
  subtitleWindow?.hide()
}

/** 字幕窗口是否存在且可见 */
export function isSubtitleWindowVisible(): boolean {
  return subtitleWindow !== null && subtitleWindow.isVisible()
}

/** 向字幕窗口发送字幕更新（由主窗口 App.tsx 调用） */
export function sendSubtitleUpdate(data: {
  text: string
  bookTitle?: string
  chapterTitle?: string
  isPlaying?: boolean
  hasContent?: boolean
  progressPercent?: number
  style?: Partial<SubtitleStyle>
}): void {
  if (data.text) lastSubtitleText = data.text
  if (data.bookTitle !== undefined) lastBookTitle = data.bookTitle
  if (data.chapterTitle !== undefined) lastChapterTitle = data.chapterTitle
  if (data.isPlaying !== undefined) lastPlaying = data.isPlaying
  if (data.hasContent !== undefined) lastHasContent = data.hasContent
  if (data.progressPercent !== undefined) lastProgress = data.progressPercent

  // 发送文本+样式
  sendToSubtitle('subtitle:update', {
    text: data.text,
    bookTitle: data.bookTitle,
    chapterTitle: data.chapterTitle,
    style: data.style ? { ...currentStyle, ...data.style } : currentStyle
  })
  // 发送播放状态
  sendToSubtitle('subtitle:state', {
    isPlaying: lastPlaying,
    hasContent: lastHasContent,
    progressPercent: lastProgress
  })
}

function updateStyle(partial: Partial<SubtitleStyle>): void {
  currentStyle = { ...currentStyle, ...partial }
  sendToSubtitle('subtitle:update', {
    text: lastSubtitleText,
    bookTitle: lastBookTitle,
    chapterTitle: lastChapterTitle,
    style: currentStyle
  })
  sendToMain('subtitle:styleChanged', currentStyle)
}

export function getSubtitleStyle(): SubtitleStyle {
  return currentStyle
}

/** 右键菜单 */
function buildContextMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: '📖 打开主窗口',
      click: () => { getMainWindow()?.show(); getMainWindow()?.focus() }
    },
    { type: 'separator' },
    {
      label: '🔤 字体大小',
      submenu: [
        { label: '小 (14px)', click: () => updateStyle({ fontSize: 14 }) },
        { label: '中 (18px)', click: () => updateStyle({ fontSize: 18 }) },
        { label: '大 (24px)', click: () => updateStyle({ fontSize: 24 }) },
        { label: '特大 (32px)', click: () => updateStyle({ fontSize: 32 }) }
      ]
    },
    {
      label: '🎨 文字颜色',
      submenu: [
        { label: '白色', click: () => updateStyle({ fontColor: '#FFFFFF' }) },
        { label: '黄色', click: () => updateStyle({ fontColor: '#FFEB3B' }) },
        { label: '青色', click: () => updateStyle({ fontColor: '#00E5FF' }) },
        { label: '绿色', click: () => updateStyle({ fontColor: '#4CAF50' }) }
      ]
    },
    {
      label: '👁 透明度',
      submenu: [
        { label: '100%', click: () => updateStyle({ opacity: 1.0 }) },
        { label: '90%', click: () => updateStyle({ opacity: 0.9 }) },
        { label: '70%', click: () => updateStyle({ opacity: 0.7 }) },
        { label: '50%', click: () => updateStyle({ opacity: 0.5 }) }
      ]
    },
    { type: 'separator' },
    {
      label: '❌ 关闭字幕',
      click: () => {
        subtitleWindow?.hide()
        sendToMain('subtitle:hidden')
      }
    }
  ])
}

export function registerSubtitleHandlers(logService: LogService): void {
  // === 窗口控制 ===
  ipcMain.handle('subtitle:show', async () => { showSubtitleWindow(logService) })
  ipcMain.handle('subtitle:hide', async () => { hideSubtitleWindow() })
  ipcMain.handle('subtitle:toggle', async () => {
    if (isSubtitleWindowVisible()) {
      hideSubtitleWindow()
      sendToMain('subtitle:hidden')
    } else {
      showSubtitleWindow(logService)
    }
  })

  // === 样式 ===
  ipcMain.handle('subtitle:getStyle', async () => currentStyle)
  ipcMain.handle('subtitle:setStyle', async (_e, style: Partial<SubtitleStyle>) => { updateStyle(style) })

  // === 右键菜单 ===
  ipcMain.handle('subtitle:showContextMenu', async () => {
    if (subtitleWindow) buildContextMenu().popup({ window: subtitleWindow })
  })

  // === 播放控制（字幕窗口 → 主窗口转发） ===
  ipcMain.handle('subtitle:play', async () => { sendToMain('subtitle:play') })
  ipcMain.handle('subtitle:pause', async () => { sendToMain('subtitle:pause') })
  ipcMain.handle('subtitle:prev', async () => { sendToMain('subtitle:prev') })
  ipcMain.handle('subtitle:next', async () => { sendToMain('subtitle:next') })
  ipcMain.handle('subtitle:openMain', async () => {
    getMainWindow()?.show()
    getMainWindow()?.focus()
  })

  // === 主窗口 → 字幕窗口的转发 ===
  ipcMain.on('subtitle:sendUpdate', (_event, data: {
    text: string
    bookTitle?: string
    chapterTitle?: string
    isPlaying?: boolean
    hasContent?: boolean
    progressPercent?: number
  }) => {
    sendSubtitleUpdate(data)
  })
}
