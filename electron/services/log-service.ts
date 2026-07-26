import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../ipc/fileHandlers'

export interface LogEntry {
  id: string
  timestamp: string
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  source: string
  message: string
  details: string | null
  context: Record<string, unknown>
}

const MAX_LOG_ENTRIES = 5000
const TRIM_TO = 2500

export class LogService {
  private static mainWindow: BrowserWindow | null = null

  /** 注册主窗口引用，用于实时推送日志到渲染进程 */
  static setMainWindow(win: BrowserWindow | null): void {
    LogService.mainWindow = win
  }

  private logs: LogEntry[] = []

  constructor() {
    this.load()
  }

  private getLogFile(): string {
    return join(getDataDir(), 'logs.json')
  }

  private ensureDir(): void {
    const dir = getDataDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private load(): void {
    try {
      this.ensureDir()
      const logFile = this.getLogFile()
      if (existsSync(logFile)) {
        const data = readFileSync(logFile, 'utf-8')
        this.logs = JSON.parse(data)
      }
    } catch {
      this.logs = []
    }
  }

  /** 数据目录切换后重新从新路径加载 */
  reloadFromDisk(): void {
    try {
      this.ensureDir()
      const logFile = this.getLogFile()
      if (existsSync(logFile)) {
        const data = readFileSync(logFile, 'utf-8')
        this.logs = JSON.parse(data)
      }
    } catch {
      /* keep in-memory */
    }
  }

  private save(): void {
    try {
      this.ensureDir()
      // Trim logs if exceeding max
      if (this.logs.length > MAX_LOG_ENTRIES) {
        this.logs = this.logs.slice(this.logs.length - TRIM_TO)
      }
      const logFile = this.getLogFile()
      const tmpPath = `${logFile}.tmp`
      writeFileSync(tmpPath, JSON.stringify(this.logs, null, 2), 'utf-8')
      renameSync(tmpPath, logFile)
    } catch (error) {
      console.error('Failed to save logs:', error)
    }
  }

  private addLog(
    level: LogEntry['level'],
    source: string,
    message: string,
    details: string | null = null,
    context: Record<string, unknown> = {}
  ): void {
    const entry: LogEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details,
      context
    }
    this.logs.push(entry)
    this.save()

    // Push to renderer for real-time log view
    LogService.mainWindow?.webContents.send('log:new-entry', entry)

    // Print to console (short format like batch_ocr)
    const ts = new Date(entry.timestamp)
    const hh = String(ts.getHours()).padStart(2, '0')
    const mm = String(ts.getMinutes()).padStart(2, '0')
    const ss = String(ts.getSeconds()).padStart(2, '0')
    const prefix = `${hh}:${mm}:${ss} [${level}] ${source}:`
    if (level === 'ERROR') {
      console.error(prefix, message, details || '')
    } else if (level === 'WARN') {
      console.warn(prefix, message, details || '')
    } else {
      console.log(prefix, message)
    }
  }

  info(source: string, message: string, context?: Record<string, unknown>): void {
    this.addLog('INFO', source, message, null, context)
  }

  warn(source: string, message: string, details?: string, context?: Record<string, unknown>): void {
    this.addLog('WARN', source, message, details || null, context)
  }

  error(source: string, message: string, details?: string, context?: Record<string, unknown>): void {
    this.addLog('ERROR', source, message, details || null, context)
  }

  debug(source: string, message: string, context?: Record<string, unknown>): void {
    this.addLog('DEBUG', source, message, null, context)
  }

  getLogs(): LogEntry[] {
    return this.logs
  }

  clearLogs(): void {
    this.logs = []
    this.save()
  }

  /** 当前日志目录（随 getDataDir 变化） */
  getLogDir(): string {
    return getDataDir()
  }
}
