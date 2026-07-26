import { ipcMain, BrowserWindow, desktopCapturer, screen, nativeImage, app } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import type { LogService } from '../services/log-service'

let screenshotWindow: BrowserWindow | null = null
let isOCRRunning = false
/** 截图时被临时隐藏的窗口，结束后恢复 */
let hiddenForCapture: BrowserWindow[] = []

const RAPIDOCR_PYTHON = process.env.TINGEAR_PYTHON || 'python'

export type OcrScreenshotMeta = {
  dataUrl: string
  /** 覆盖层 CSS 逻辑像素宽高（与 BrowserWindow 一致） */
  cssWidth: number
  cssHeight: number
  /** 截图像素宽高 */
  imgWidth: number
  imgHeight: number
  scaleFactor: number
}

function getOcrScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ocr', 'rapidocr_runner.py')
  }
  return join(app.getAppPath(), 'electron', 'ocr', 'rapidocr_runner.py')
}

function getMainWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find((w) => {
      const url = w.webContents.getURL()
      return !url.includes('floating') && !url.includes('screenshot')
    }) ?? null
  )
}

function setOcrMeta(meta: OcrScreenshotMeta | null): void {
  ;(globalThis as unknown as { __ocrScreenshotMeta?: OcrScreenshotMeta | null }).__ocrScreenshotMeta =
    meta
}

function getOcrMeta(): OcrScreenshotMeta | null {
  return (
    (globalThis as unknown as { __ocrScreenshotMeta?: OcrScreenshotMeta | null }).__ocrScreenshotMeta ||
    null
  )
}

/** 截图前隐藏应用相关窗口，避免把自己拍进去 */
function hideAppWindows(): void {
  hiddenForCapture = []
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === screenshotWindow) continue
    if (w.isVisible()) {
      hiddenForCapture.push(w)
      w.hide()
    }
  }
}

function restoreAppWindows(): void {
  for (const w of hiddenForCapture) {
    try {
      if (!w.isDestroyed()) w.show()
    } catch {
      /* ignore */
    }
  }
  hiddenForCapture = []
}

export function registerOcrHandlers(logService: LogService): void {
  ipcMain.handle('ocr:startScreenshot', async () => {
    if (screenshotWindow) {
      screenshotWindow.close()
      screenshotWindow = null
    }
    if (isOCRRunning) {
      logService.warn('OCR', '已有 OCR 任务进行中')
      return
    }
    await startScreenshotFlow(logService)
  })

  ipcMain.handle(
    'ocr:selectionComplete',
    async (
      _event,
      payload: { dataUrl: string; x: number; y: number; w: number; h: number }
    ) => {
      screenshotWindow?.close()
      screenshotWindow = null
      restoreAppWindows()
      await runOcr(logService, payload)
    }
  )

  ipcMain.handle('ocr:cancel', async () => {
    screenshotWindow?.close()
    screenshotWindow = null
    setOcrMeta(null)
    restoreAppWindows()
    logService.info('OCR', '截图取消')
  })
}

async function startScreenshotFlow(logService: LogService): Promise<void> {
  const cursor = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursor)
  const { width: cssWidth, height: cssHeight } = targetDisplay.size
  const { x: displayX, y: displayY } = targetDisplay.bounds
  const scaleFactor = targetDisplay.scaleFactor || 1
  const thumbW = Math.round(cssWidth * scaleFactor)
  const thumbH = Math.round(cssHeight * scaleFactor)

  // 先藏窗口再截，避免把听伴拍进画面
  hideAppWindows()
  // 给合成器一帧时间收起窗口
  await new Promise((r) => setTimeout(r, 80))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH }
  })
  const displayId = String(targetDisplay.id)
  const matched =
    sources.find((s) => s.display_id === displayId) ||
    sources.find((s) => s.id.includes(displayId)) ||
    sources[0]
  if (!matched) {
    restoreAppWindows()
    logService.error('OCR', '未找到可用屏幕源')
    return
  }

  const thumb = matched.thumbnail
  const imgSize = thumb.getSize()
  const fullDataUrl = thumb.toDataURL()
  logService.info(
    'OCR',
    `截取显示器 id=${displayId} css=${cssWidth}x${cssHeight} img=${imgSize.width}x${imgSize.height} @${scaleFactor}x`
  )

  setOcrMeta({
    dataUrl: fullDataUrl,
    cssWidth,
    cssHeight,
    imgWidth: imgSize.width,
    imgHeight: imgSize.height,
    scaleFactor
  })

  screenshotWindow = new BrowserWindow({
    width: cssWidth,
    height: cssHeight,
    x: displayX,
    y: displayY,
    fullscreen: true,
    frame: false,
    movable: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  screenshotWindow.setAlwaysOnTop(true, 'screen-saver')
  screenshotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  screenshotWindow.on('ready-to-show', () => {
    screenshotWindow?.show()
    screenshotWindow?.focus()
    logService.info('OCR', '截图窗口已显示，等待框选')
  })

  screenshotWindow.on('closed', () => {
    screenshotWindow = null
  })

  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  if (isDev) {
    screenshotWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/screenshot`)
  } else {
    screenshotWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/screenshot' })
  }
}

ipcMain.handle('ocr:getScreenshotDataUrl', () => {
  const meta = getOcrMeta()
  return meta?.dataUrl || ''
})

/** 返回截图元数据（含 DPI 缩放，供前端坐标换算） */
ipcMain.handle('ocr:getScreenshotMeta', () => {
  return getOcrMeta()
})

async function runOcr(
  logService: LogService,
  payload: { dataUrl: string; x: number; y: number; w: number; h: number }
): Promise<void> {
  isOCRRunning = true
  let tempPath = ''
  const meta = getOcrMeta()
  try {
    const base64 = payload.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(base64, 'base64')
    const fullImg = nativeImage.createFromBuffer(buf)
    const imgSize = fullImg.getSize()

    // CSS 逻辑坐标 → 截图像素坐标（修高 DPI 错位）
    const cssW = meta?.cssWidth || imgSize.width
    const cssH = meta?.cssHeight || imgSize.height
    const scaleX = imgSize.width / cssW
    const scaleY = imgSize.height / cssH

    let x = Math.round(payload.x * scaleX)
    let y = Math.round(payload.y * scaleY)
    let w = Math.round(payload.w * scaleX)
    let h = Math.round(payload.h * scaleY)

    // 钳制在图内
    x = Math.max(0, Math.min(x, imgSize.width - 1))
    y = Math.max(0, Math.min(y, imgSize.height - 1))
    w = Math.max(1, Math.min(w, imgSize.width - x))
    h = Math.max(1, Math.min(h, imgSize.height - y))

    const cropped = fullImg.crop({ x, y, width: w, height: h })
    const pngBuf = cropped.toPNG()

    tempPath = join(tmpdir(), `tingear_ocr_${Date.now()}.png`)
    writeFileSync(tempPath, pngBuf)
    logService.info('OCR', `截图区域已保存: ${tempPath} (${w}x${h}px from css ${payload.w}x${payload.h})`)

    const text = await new Promise<string>((resolve, reject) => {
      const scriptPath = getOcrScriptPath()
      logService.info('OCR', `启动 OCR: ${RAPIDOCR_PYTHON} ${scriptPath}`)
      const proc = spawn(RAPIDOCR_PYTHON, [scriptPath, tempPath], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      proc.stdout.on('data', (d: Buffer) => stdoutChunks.push(d))
      proc.stderr.on('data', (d: Buffer) => stderrChunks.push(d))

      const timer = setTimeout(() => {
        proc.kill()
        reject(new Error('OCR 超时（60s）'))
      }, 60000)

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        const out = Buffer.concat(stdoutChunks).toString('utf-8').trim()
        const errOut = Buffer.concat(stderrChunks).toString('utf-8').trim()
        if (code === 0) {
          resolve(out)
        } else if (out.startsWith('ERROR:')) {
          reject(new Error(out.replace(/^ERROR:\s*/, '')))
        } else {
          reject(new Error(errOut || `OCR 进程退出码 ${code}`))
        }
      })
    })

    logService.info('OCR', `识别成功，共 ${text.length} 字`)
    const main = getMainWindow()
    main?.show()
    main?.focus()
    main?.webContents.send('ocr:result', text)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logService.error('OCR', `OCR 失败: ${msg}`)
    const main = getMainWindow()
    main?.show()
    main?.focus()
    main?.webContents.send('ocr:error', msg)
  } finally {
    setOcrMeta(null)
    if (tempPath && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
      } catch {
        /* ignore */
      }
    }
    isOCRRunning = false
  }
}

let preheated = false

export function preheatOcr(logService: LogService): void {
  if (preheated) return
  preheated = true
  const py = RAPIDOCR_PYTHON
  const script = getOcrScriptPath()
  logService.info('OCR', '预热模型加载中...')

  const proc = spawn(py, [script, '--preheat'], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
  })
  proc.on('close', (code) => {
    if (code === 0) logService.info('OCR', '模型预热完成')
    else logService.warn('OCR', `模型预热退出码 ${code}（OCR 功能可能不可用）`)
  })
  proc.on('error', (err) => {
    logService.warn('OCR', `模型预热失败: ${err.message}`)
  })
}
