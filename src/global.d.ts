import { ElectronAPI } from '@electron-toolkit/preload'
import type { CleanRule } from './cleanRules'

/** 音色描述（与后端 adapter.TTSVoice 对齐，仅渲染层使用） */
export interface TTSVoice {
  id: string
  name: string
  language?: string
  gender?: 'male' | 'female'
  description?: string
}

/** 引擎配置（与后端 adapter.TTSEngineConfig 对齐，仅渲染层使用） */
export interface TTSEngineConfig {
  id: string
  name: string
  type: 'qwen' | 'system' | 'edge' | 'openai' | 'http' | 'local' | 'indextts'
  enabled: boolean
  sortOrder?: number
  voices?: TTSVoice[]
  apiUrl?: string
  apiKey?: string
  requestMethod?: 'POST' | 'GET'
  requestTemplate?: Record<string, unknown>
  responseAudioField?: string
  responseFormat?: 'base64' | 'url' | 'binary'
  voiceField?: string
  maxTextLength?: number
}

export interface Api {
  selectFile: () => Promise<string[] | null>
  importFile: (filePath: string) => Promise<ImportResult>
  saveProgress: (data: BookData[]) => Promise<{ success: boolean; error?: string }>
  loadProgress: () => Promise<BookData[] | null>
  loadAlbums: () => Promise<CustomAlbum[] | null>
  saveAlbums: (albums: CustomAlbum[]) => Promise<{ success: boolean; error?: string }>
  saveSettings: (settings: AppSettings) => Promise<void>
  loadSettings: () => Promise<AppSettings | null>
  ttsSynthesize: (
    text: string,
    voice: string,
    speed: number,
    volume: number,
    engineId?: string
  ) => Promise<TTSResult>
  ttsGetVoices: (engineId?: string) => Promise<TTSVoice[]>
  ttsGetEngines: () => Promise<TTSEngineConfig[]>
  ttsGetActiveEngine: () => Promise<string>
  ttsSetActiveEngine: (engineId: string) => Promise<{ success: boolean }>
  ttsTestEngine: (engineId: string) => Promise<boolean>
  ttsPreviewVoice: (engineId: string, voiceId: string) => Promise<TTSResult>
  ttsAddEngine: (config: TTSEngineConfig) => Promise<{ success: boolean }>
  ttsUpdateEngine: (config: TTSEngineConfig) => Promise<{ success: boolean }>
  ttsDeleteEngine: (engineId: string) => Promise<{ success: boolean }>
  ttsDiscoverVoices: (engineId: string) => Promise<{ voices: TTSVoice[]; success: boolean }>
  ttsDiscoverVoicesForConfig: (
    config: Partial<TTSEngineConfig>
  ) => Promise<{ voices: TTSVoice[]; success: boolean; error?: string }>
  ttsProbeEngineUrl: (
    apiUrl: string,
    apiKey?: string
  ) => Promise<{
    suggestedName: string
    suggestedType: 'openai' | 'http'
    isOpenAICompatible: boolean
  }>
  ttsImportEngine: (jsonStr: string) => Promise<{
    success: boolean
    error?: string
    config?: TTSEngineConfig
    detectedFormat?: string
  }>
  ttsExportEngine: (engineId: string) => Promise<string | null>
  // Bookmark operations
  saveBookmarks: (bookmarks: Bookmark[]) => Promise<void>
  loadBookmarks: () => Promise<Bookmark[]>
  // Log operations
  loadLogs: () => Promise<LogEntry[]>
  clearLogs: () => Promise<void>
  // History operations
  loadHistory: () => Promise<HistoryEntry[]>
  clearHistory: () => Promise<void>
  saveHistory: (
    entry: Omit<HistoryEntry, 'id'>
  ) => Promise<{ success: boolean; entry?: HistoryEntry; error?: string }>
  // Floating ball
  showFloatingBall: () => Promise<void>
  hideFloatingBall: () => Promise<void>
  floatingBallSetMode: (mode: string) => Promise<void>
  floatingBallSetOpacity: (opacity: number) => Promise<void>
  floatingBallSetLocked: (locked: boolean) => Promise<void>
  floatingBallSnapToEdge: () => Promise<void>

  // Window control
  windowShowMain: () => Promise<void>
  windowHideMain: () => Promise<void>

  // App
  appQuit: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  windowSetOpacity: (opacity: number) => Promise<void>
  windowSetAlwaysOnTop: (flag: boolean) => Promise<void>
  systemTTSAvailable: () => Promise<boolean>

  // Tray events
  onTrayTogglePlay: (callback: () => void) => () => void
  onTrayPrevSentence: (callback: () => void) => () => void
  onTrayNextSentence: (callback: () => void) => () => void

  // Floating ball events
  onFloatingBallPlay: (callback: () => void) => () => void
  onFloatingBallPause: (callback: () => void) => () => void
  onFloatingBallPrev: (callback: () => void) => () => void
  onFloatingBallNext: (callback: () => void) => () => void
  onFloatingBallExpand: (callback: () => void) => () => void
  onFloatingBallRequestOcr: (callback: () => void) => () => void
  onFloatingBallReadClipboard: (callback: (text: string) => void) => () => void
  onFloatingBallPrevChapter: (callback: () => void) => () => void
  onFloatingBallNextChapter: (callback: () => void) => () => void
  onFloatingBallSeekTo: (callback: (index: number) => void) => () => void
  onOcrResult: (callback: (text: string) => void) => () => void
  onOcrError: (callback: (msg: string) => void) => () => void

  // === Floating ball state push ===
  updateFloatingBallState: (state: PlayerSnapshot) => void

  // === Log stream listener ===
  onLogEntry: (callback: (entry: LogEntry) => void) => () => void

  // Screenshot OCR
  startScreenshotOcr: () => Promise<void>
  getScreenshotDataUrl: () => Promise<string>
  submitOcrSelection: (data: {
    dataUrl: string
    x: number
    y: number
    w: number
    h: number
  }) => Promise<void>
  cancelOcrSelection: () => Promise<void>

  // === Custom global shortcuts (player) ===
  /** 运行时更新主进程注册的全局快捷键 */
  applyShortcuts: (shortcuts: Record<string, string>) => void
  /** 监听主进程触发的自定义快捷键动作（回调参数为动作名） */
  onShortcut: (callback: (action: ShortcutAction) => void) => () => void

  // Clipboard
  // === 文本清洗（LLM） ===
  /** 发起 LLM 清洗。返回 taskId，进度通过 onCleanProgress 回调推送 */
  cleanTextWithLLM: (params: {
    text: string
    configId?: string
  }) => Promise<{ success: boolean; taskId?: string; error?: string }>
  /** 取消当前清洗任务 */
  cancelClean: (taskId: string) => Promise<void>
  /** 快速清洗（纯正则，秒出，不调 LLM）：返回清洗后文本与长度统计 */
  enhancedClean: (
    text: string
  ) => Promise<{ success: boolean; text: string; originalLength: number; cleanedLength: number }>
  /** 清洗进度回调 */
  onCleanProgress: (
    callback: (p: { current: number; total: number; phase: string }) => void
  ) => () => void
  /** 清洗完成回调 */
  onCleanComplete: (
    callback: (data: {
      taskId: string
      cancelled: boolean
      error?: string
      text?: string
      stats?: {
        originalLength: number
        cleanedLength: number
        chunksUsed: number
        anomalyChunks: number
        regexChunks: number
      }
    }) => void
  ) => () => void

  // === LLM 配置管理 ===
  getLlmConfigs: () => Promise<LLMConfig[]>
  saveLlmConfigs: (configs: LLMConfig[]) => Promise<void>
  getActiveLlmId: () => Promise<string>
  setActiveLlmId: (id: string) => Promise<void>
  testLlmConnection: (config: unknown) => Promise<{ success: boolean; error?: string }>
  fetchModels: (config: unknown) => Promise<{ success: boolean; models: string[]; error?: string }>

  // Audio export
  exportAudio: (params: {
    sentences: string[]
    voiceId: string
    speed: number
    startIndex: number
    endIndex: number
    defaultName: string
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  onExportProgress: (callback: (data: { current: number; total: number }) => void) => () => void
  onExportComplete: (callback: (data: { filePath: string; size: number }) => void) => () => void
  onExportError: (callback: (data: { message: string }) => void) => () => void

  // Book operations
  deleteBook: (bookId: string) => Promise<{ success: boolean; error?: string }>
  reprocessBook: (bookId: string) => Promise<{
    success: boolean
    book?: BookData
    stats?: Record<string, number>
    error?: string
  }>
  exportBookmarks: (bookId: string) => Promise<{ success: boolean; error?: string }>

  // Cover operations
  saveCover: (
    bookId: string,
    dataUrl: string
  ) => Promise<{ success: boolean; coverPath?: string; error?: string }>
  uploadCover: (bookId: string) => Promise<{ success: boolean; coverPath?: string; error?: string }>
  getCover: (bookId: string) => Promise<string | null>
  getCoverDataUrl: (bookId: string) => Promise<string | null>

  // === 桌面字幕 ===
  /** 显示字幕窗口 */
  subtitleShow: () => Promise<void>
  /** 隐藏字幕窗口 */
  subtitleHide: () => Promise<void>
  /** 切换字幕窗口显示/隐藏 */
  subtitleToggle: () => Promise<void>
  /** 获取字幕样式 */
  subtitleGetStyle: () => Promise<SubtitleStyle>
  /** 设置字幕样式 */
  subtitleSetStyle: (style: Partial<SubtitleStyle>) => Promise<void>
  /** 发送字幕更新（主窗口 → 字幕窗口） */
  subtitleSendUpdate: (data: {
    text: string
    bookTitle?: string
    chapterTitle?: string
    isPlaying?: boolean
    hasContent?: boolean
    progressPercent?: number
  }) => void
  /** 监听字幕隐藏事件 */
  onSubtitleHidden: (callback: () => void) => () => void
  /** 监听字幕样式变更事件 */
  onSubtitleStyleChanged: (callback: (style: SubtitleStyle) => void) => () => void
  /** 字幕窗口播放控制 → 主窗口 */
  onSubtitlePlay: (callback: () => void) => () => void
  onSubtitlePause: (callback: () => void) => () => void
  onSubtitlePrev: (callback: () => void) => () => void
  onSubtitleNext: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

// Data types
export interface Chapter {
  title: string
  startIndex: number
  sentenceCount: number
}

export interface Sentence {
  index: number
  text: string
  chapterIndex: number
}

export interface BookData {
  id: string
  title: string
  /** 最近一次文件解析得到的标题；用户修改 title 后重处理仍保留自定义标题 */
  originalTitle?: string
  author: string
  coverPath?: string
  /** auto=自动生成(随生成器升级自动更新), custom=用户手动上传 */
  coverSource?: 'auto' | 'custom'
  filePath: string
  format: string
  sentences: string[]
  chapters: Chapter[]
  currentChapterIndex: number
  currentSentenceIndex: number
  currentTimeOffset?: number
  progressPercent: number
  timeMap?: number[] // timeMap[i] = cumulative ms at start of sentence i; -1 = estimated from char count
  isCompleted: boolean
  addedAt: string
  lastReadAt: string
  bookmarks?: Bookmark[]
  /** 导入时的原始解析文本（真·原文，清洗/版本切换/自动保存均不覆盖） */
  originalSentences?: string[]
  /** 编辑记录：文本处理的历史版本 */
  editHistory?: EditRecord[]
}

export interface AlbumItem {
  resourceType: 'book' | 'audio'
  resourceId: string
}

export interface CustomAlbum {
  id: string
  title: string
  parentId: string | null
  items: AlbumItem[]
  createdAt: string
  updatedAt: string
}

export interface EditRecord {
  id: string
  type: 'trim-spaces' | 'ai-clean' | 'manual'
  label: string
  timestamp: string
  sentenceCount: number
  sentences: string[]
}

export interface Bookmark {
  id: string
  bookId: string
  bookTitle?: string
  sentenceIndex: number
  chapterIndex: number
  content: string
  note: string
  createdAt: string
}

export interface LogEntry {
  id: string
  timestamp: string
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  source: string
  message: string
  details: string | null
  context: Record<string, unknown>
}

export interface HistoryEntry {
  id: string
  bookId: string
  bookTitle: string
  chapterIndex: number
  chapterTitle: string
  startSentenceIndex: number
  endSentenceIndex?: number
  startTime: string
  endTime: string
  durationSeconds: number
  contentPreview: string
  isCompleted: boolean
  engineUsed?: string
  sentenceRange?: { start: number; end: number } | null
}

export interface ImportResult {
  success: boolean
  book?: BookData
  error?: string
}

export interface TTSResult {
  success: boolean
  audio?: string // base64-encoded MP3 or WAV
  audioFormat?: 'mp3' | 'wav' // v5: for correct MIME type selection
  error?: string
  fallback?: boolean // whether renderer should fall back to system TTS
}

export interface FloatingBallSettings {
  enabled: boolean
  alwaysOnTop: boolean
  opacity: number
  locked: boolean
  autoSnap: boolean
  showHoverCard: boolean
  hoverDelayMs: number
  hideWhenMainWindowOpen: boolean
  showWhenMainWindowMinimized: boolean
  position: {
    x: number | null
    y: number | null
    edge: 'left' | 'right'
  }
  mode: 'ball' | 'hover' | 'mini'
}

export interface AppSettings {
  ttsEngine: string // 引擎ID，内置: edge/qwen/system，也支持自定义引擎ID
  qwenApiKey: string
  qwenEndpoint: string
  voiceId: string
  defaultSpeed: number
  defaultVolume: number
  windowAlwaysOnTop: boolean
  windowOpacity: number
  floatingBallEnabled: boolean
  floatingBall: FloatingBallSettings
  theme: 'light' | 'dark' | 'system'
  fontSize: {
    body: number
    title: number
  }
  /** LLM 清洗配置 */
  activeLlmId: string
  llmConfigs: LLMConfig[]
  /** 自定义清洗提示词 */
  cleanPrompt: string
  /** 清洗格式正则规则（用户可在「设置 → 清洗」中编辑） */
  cleanRules?: CleanRule[]
  /** 全局快捷键映射（动作 -> Electron 加速器字符串；空串表示禁用该动作） */
  shortcuts?: ShortcutMap
}

/** 全局快捷键动作 */
export type ShortcutAction =
  | 'toggle'
  | 'stop'
  | 'prevSentence'
  | 'nextSentence'
  | 'prevChapter'
  | 'nextChapter'
  | 'speedUp'
  | 'speedDown'
  | 'volumeUp'
  | 'volumeDown'
  | 'resetDefaults'

/** 快捷键映射：动作 -> 加速器字符串（可选，缺失时使用默认） */
export type ShortcutMap = Partial<Record<ShortcutAction, string>>

/** LLM 模型配置 */
export interface LLMConfig {
  id: string
  provider: 'ollama' | 'openai'
  name: string
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxTokens: number
  temperature: number
  /** 用户自定义单块字符上限。留空则自动按 contextWindow + maxTokens 计算 */
  chunkSize?: number
}

export type PlayState = 'idle' | 'playing' | 'paused' | 'stopped'

/** 播放器快照：主窗口→悬浮球的状态同步数据 */
export interface PlayerSnapshot {
  hasContent: boolean
  isPlaying: boolean
  isLoading: boolean
  error: string | null
  bookTitle: string
  chapterTitle: string
  currentSentenceText: string
  progressPercent: number
}

export interface ToastItem {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

/** AI 审校疑点（与后端 text-reviewer.ts ReviewIssue 对齐，当前禁用LLM审校，暂保留类型定义） */
export interface ReviewIssue {
  paraIndex: number
  sentence: string
  type: 'suspect-deleted' | 'suspect-missed' | 'suspect-break' | 'other'
  reason: string
  suggestion?: string
}

/** 字幕样式配置 */
export interface SubtitleStyle {
  fontSize: number
  fontColor: string
  bgColor: string
  opacity: number
  maxWidth: number
}
