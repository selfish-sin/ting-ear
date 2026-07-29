import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../ipc/fileHandlers'
import { atomicWriteFile } from '../utils/atomicWrite'

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
/** 批量写盘：攒条数或到时 flush，避免每条日志全量 stringify */
const FLUSH_INTERVAL_MS = 1500
const FLUSH_EVERY_N = 20

export class LogService {
  private static mainWindow: BrowserWindow | null = null

  /** 注册主窗口引用，用于实时推送日志到渲染进程 */
  static setMainWindow(win: BrowserWindow | null): void {
    LogService.mainWindow = win
  }

  private logs: LogEntry[] = []
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSinceFlush = 0

  constructor() {
    // 延迟加载：不阻塞启动关键路径
    // logs.json 只在第一次写入或 getLogs() 调用时按需加载
  }

  private ensureLoaded(): void {
    if (this._loaded) return
    this._loaded = true
    this.load()
  }
  private _loaded = false

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
    this._loaded = true // 标记已加载，跳过懒加载
    this.flushSync()
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

  private scheduleFlush(): void {
    this.dirty = true
    this.pendingSinceFlush += 1
    if (this.pendingSinceFlush >= FLUSH_EVERY_N) {
      this.flushSync()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushSync()
    }, FLUSH_INTERVAL_MS)
  }

  /** 立即落盘（退出/切目录/清空时调用） */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.dirty && this.pendingSinceFlush === 0) {
      // 仍允许强制写空列表等场景：clear 会先改 logs 再 flush
    }
    try {
      this.ensureDir()
      if (this.logs.length > MAX_LOG_ENTRIES) {
        this.logs = this.logs.slice(this.logs.length - TRIM_TO)
      }
      const logFile = this.getLogFile()
      atomicWriteFile(logFile, JSON.stringify(this.logs))
      this.dirty = false
      this.pendingSinceFlush = 0
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
    this.ensureLoaded()
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
    this.scheduleFlush()

    // DEBUG 不推渲染进程：TTS 合成等高频 debug 会刷 IPC，导致界面卡顿/未响应
    if (level !== 'DEBUG') {
      LogService.mainWindow?.webContents.send('log:new-entry', entry)
    }

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
    this.ensureLoaded()
    return this.logs
  }

  clearLogs(): void {
    this.logs = []
    this.dirty = true
    this.flushSync()
  }

  /** 当前日志目录（随 getDataDir 变化） */
  getLogDir(): string {
    return getDataDir()
  }
}
