import { ipcMain, BrowserWindow, desktopCapturer, screen, nativeImage, app } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import type { LogService } from '../services/log-service'

let screenshotWindow: BrowserWindow | null = null
let isOCRRunning = false

// RapidOCR 可执行 python 路径
// v5: 从环境变量读取，缺省 'python'（走 PATH 解析）
const RAPIDOCR_PYTHON = process.env.TINGEAR_PYTHON || 'python'

/** 获取 rapidocr_runner.py 路径：dev 用 app.getAppPath()，prod 用 process.resourcesPath + extraResources */
function getOcrScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ocr', 'rapidocr_runner.py')
  }
  return join(app.getAppPath(), 'electron', 'ocr', 'rapidocr_runner.py')
}

export function registerOcrHandlers(logService: LogService): void {
  ipcMain.handle('ocr:startScreenshot', async () => {
    if (screenshotWindow) {
      // 旧窗口还在就关了重建（确保拿到新截图）
      screenshotWindow.close()
      screenshotWindow = null
    }
    if (isOCRRunning) {
      logService.warn('OCR', '已有 OCR 任务进行中')
      return
    }
    const main = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('floating') && !w.webContents.getURL().includes('screenshot')
    )
    main?.show()
    main?.focus()
    await startScreenshotFlow(logService)
  })

  // Renderer → main: user confirmed selection
  ipcMain.handle(
    'ocr:selectionComplete',
    async (_event, payload: { dataUrl: string; x: number; y: number; w: number; h: number }) => {
      screenshotWindow?.close()
      screenshotWindow = null
      await runOcr(logService, payload.dataUrl, payload.x, payload.y, payload.w, payload.h)
    }
  )

  ipcMain.handle('ocr:cancel', async () => {
    screenshotWindow?.close()
    screenshotWindow = null
    logService.info('OCR', '截图取消')
  })
}

async function startScreenshotFlow(logService: LogService): Promise<void> {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size

  // 1. 先截屏（不依赖窗口存在）
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  const primarySource = sources[0]
  if (!primarySource) {
    logService.error('OCR', '未找到可用屏幕源')
    return
  }
  const fullDataUrl = primarySource.thumbnail.toDataURL()

  // 2. 缓存截图数据到 globalThis（渲染进程通过 IPC 读取）
  ;(globalThis as unknown as { __ocrScreenshot?: string }).__ocrScreenshot = fullDataUrl

  // 3. 创建全屏 overlay 窗口（show: false → ready-to-show 再显示，消除白屏）
  screenshotWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    fullscreen: true,
    frame: false,
    movable: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  screenshotWindow.on('ready-to-show', () => {
    screenshotWindow?.show()
    logService.info('OCR', '截图窗口已显示，等待用户框选')
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

// IPC to expose the cached screenshot data URL to the screenshot renderer
ipcMain.handle('ocr:getScreenshotDataUrl', () => {
  return (globalThis as unknown as { __ocrScreenshot?: string }).__ocrScreenshot || ''
})

async function runOcr(
  logService: LogService,
  fullDataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  isOCRRunning = true
  let tempPath = ''
  try {
    // Crop the data URL to the selected region
    const base64 = fullDataUrl.replace(/^data:image\/png;base64,/, '')
    const buf = Buffer.from(base64, 'base64')
    const fullImg = nativeImage.createFromBuffer(buf)
    const cropped = fullImg.crop({ x, y, width: w, height: h })
    const pngBuf = cropped.toPNG()

    tempPath = join(tmpdir(), `tingear_ocr_${Date.now()}.png`)
    writeFileSync(tempPath, pngBuf)
    logService.info('OCR', `截图区域已保存: ${tempPath} (${w}x${h})`)

    // Spawn Python child process running RapidOCR
    const text = await new Promise<string>((resolve, reject) => {
      const scriptPath = getOcrScriptPath()
      logService.info('OCR', `启动 OCR 脚本: ${RAPIDOCR_PYTHON} ${scriptPath}`)
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
    // Send to main window
    const main = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('floating') && !w.webContents.getURL().includes('screenshot')
    )
    main?.webContents.send('ocr:result', text)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logService.error('OCR', `OCR 失败: ${msg}`)
    const main = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('floating') && !w.webContents.getURL().includes('screenshot')
    )
    main?.webContents.send('ocr:error', msg)
  } finally {
    if (tempPath && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
      } catch {
        // ignore
      }
    }
    isOCRRunning = false
  }
}

// ==== OCR 预热：启动时后台加载模型到 OS 磁盘缓存，首用从 4-6s 降到 1-2s ====
let preheated = false

export function preheatOcr(logService: LogService): void {
  if (preheated) return
  preheated = true
  const py = RAPIDOCR_PYTHON
  const script = getOcrScriptPath()
  logService.info('OCR', '预热模型加载中...')

  const proc = spawn(py, [script, '--preheat'], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    timeout: 30000
  })

  const timer = setTimeout(() => {
    proc.kill()
    logService.warn('OCR', '预热超时（30s）')
  }, 30000)

  proc.on('close', (code) => {
    clearTimeout(timer)
    if (code === 0) {
      logService.info('OCR', '预热完成')
    } else {
      logService.warn('OCR', `预热退出码 ${code}（不影响正常使用）`)
    }
  })

  proc.on('error', (err) => {
    clearTimeout(timer)
    logService.warn('OCR', `预热失败: ${err.message}（不影响正常使用）`)
  })
}
