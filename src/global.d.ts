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
  // AI chat operations
  aiChat: (
    requestId: string,
    payload: AiChatPayload
  ) => Promise<{ success: boolean; error?: string }>
  aiCancel: (requestId: string) => Promise<{ success: boolean }>
  aiHistoryGet: (bookId: string) => Promise<AiHistoryMessage[]>
  aiHistoryClear: (bookId?: string) => Promise<{ success: boolean; error?: string }>
  aiConvList: (bookId: string) => Promise<Array<{ id: string; title: string; createdAt: string; messageCount: number }>>
  aiConvLoad: (bookId: string, convId: string) => Promise<AiHistoryMessage[]>
  aiConvCreate: (bookId: string, title?: string) => Promise<AiConversation>
  aiConvSave: (bookId: string, convId: string, messages: AiHistoryMessage[]) => Promise<{ success: boolean }>
  aiConvDelete: (bookId: string, convId: string) => Promise<{ success: boolean }>
  aiNmemStatus: (force?: boolean) => Promise<AiNmemStatus>
  aiNmemIngest: (book: BookData) => Promise<{
    success: boolean
    ingested?: number
    duplicates?: number
    skipped?: number
    error?: string
  }>
  aiNmemSyncAll: () => Promise<{
    success: boolean
    synced?: number
    failed?: number
    error?: string
  }>
  aiListModels: (config: AiLlmSettings) => Promise<{
    success: boolean
    models?: string[]
    error?: string
  }>
  aiTestModel: (config: AiLlmSettings) => Promise<{
    success: boolean
    models?: string[]
    error?: string
  }>
  aiOutlineGenerate: (request: ChapterOutlineGenerateRequest) => Promise<{
    success: boolean
    record?: ChapterOutlineRecord
    error?: string
  }>
  aiOutlineGet: (request: ChapterOutlineGenerateRequest) => Promise<{
    success: boolean
    record?: ChapterOutlineRecord
    error?: string
  }>
  aiOutlineUpdate: (record: ChapterOutlineRecord) => Promise<{
    success: boolean
    record?: ChapterOutlineRecord
    error?: string
  }>
  onAiChatChunk: (callback: (event: AiChatChunkEvent) => void) => () => void
  onAiChatSources: (callback: (event: AiChatSourcesEvent) => void) => () => void
  onAiChatDone: (callback: (event: AiChatDoneEvent) => void) => () => void
  onAiChatError: (callback: (event: AiChatErrorEvent) => void) => () => void
  onAiIngestError: (callback: (message: string) => void) => () => void
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
  getScreenshotMeta: () => Promise<{
    dataUrl: string
    cssWidth: number
    cssHeight: number
    imgWidth: number
    imgHeight: number
    scaleFactor: number
  } | null>
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

  // === 文本清洗（纯规则） ===
  /** 规则清洗：应用「设置 → 清洗」中的正则 + 结构性格式优化 */
  enhancedClean: (
    text: string
  ) => Promise<{ success: boolean; text: string; originalLength: number; cleanedLength: number; error?: string }>
  clearCache: (type: string) => Promise<{ success: boolean; error?: string }>

  // Audio export
  exportAudio: (params: {
    sentences: string[]
    voiceId: string
    speed: number
    startIndex: number
    endIndex: number
    defaultName: string
    engineId?: string
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

  // === 数据目录管理 ===
  /** 获取当前数据目录路径 */
  dataDirGet: () => Promise<string>
  /** 获取默认数据目录路径 */
  dataDirGetDefault: () => Promise<string>
  /** 在系统文件管理器中打开文件夹 */
  dataDirOpen: (dirPath?: string) => Promise<{ success: boolean; error?: string }>
  /** 选择文件夹对话框 */
  dataDirSelect: () => Promise<{ success: boolean; path?: string; error?: string }>
  /** 验证路径有效性 */
  dataDirValidate: (dirPath: string) => Promise<{ valid: boolean; error?: string; path: string }>
  /** 迁移数据到新目录 */
  dataDirMigrate: (newDir: string) => Promise<{ success: boolean; migrated?: boolean; oldPath?: string; newPath?: string; error?: string; message?: string }>
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
  originalTitle?: string
  customTitle?: string
  startIndex: number
  sentenceCount: number
}

export type ChapterOutlineStatus = 'queued' | 'generating' | 'generated' | 'short_chapter' | 'failed'

export interface ChapterOutlineSection {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  startOffset: number
}

export interface ChapterOutlineRecord {
  bookId: string
  chapterKey: string
  chapterIndex: number
  contentHash: string
  status: ChapterOutlineStatus
  minimumSections: number
  sections: ChapterOutlineSection[]
  generatedAt?: string
  error?: string
}

export interface ChapterOutlineGenerateRequest {
  bookId: string
  chapterIndex: number
  chapterKey: string
}

export interface Sentence {
  index: number
  text: string
  chapterIndex: number
}

// === 结构化阅读（切片 A）===
export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'footnote'
  | 'endnote'
  | 'quote'
  | 'list'
  | 'code'
  | 'page_break'
  | 'toc_entry'

export interface Block {
  blockId: string
  type: BlockType
  level?: number
  text: string
  ttsSkip: boolean
  sentenceRange: [number, number]
  meta?: Record<string, string>
}

export interface StructuredChapter {
  title: string
  level: number
  blocks: Block[]
  sentenceRange: [number, number]
}

export interface StructureMeta {
  schemaVersion: 1
  contentHash: string
  sourceFormat: string
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
  /** 结构化内容（MD/EPUB 解析产出，旧书 fallback 为 pseudo） */
  structure?: StructuredChapter[]
  structureMeta?: StructureMeta
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

export type AiMessageRole = 'system' | 'user' | 'assistant'

export interface AiPromptMessage {
  role: AiMessageRole
  content: string
}

export interface AiHistoryMessage extends AiPromptMessage {
  sources?: AiSourceRef[]
  retrievalStatus?: 'done' | 'offline' | 'error' | 'skipped'
  retrievalError?: string
}

export interface AiConversation {
  id: string
  title: string
  createdAt: string
  messages: AiHistoryMessage[]
}

export interface AiLlmSettings {
  baseUrl: string
  apiKey: string
  model: string
  fallbackModel: string
  temperature: number
  timeoutMs: number
}

export type AiProvider = 'openai' | 'zhipu' | 'other'

export interface AiEngine extends AiLlmSettings {
  id: string
  name: string
  provider?: AiProvider
}

export interface AiNmemSettings {
  baseUrl: string
  autoIngest: boolean
  healthTimeoutMs: number
  searchTimeoutMs: number
  ingestTimeoutMs: number
  statusCacheMs: number
}

export interface AiSettings {
  nmem: AiNmemSettings
  /** @deprecated 向后兼容，优先使用 engines */
  llm: AiLlmSettings
  engines: AiEngine[]
  taskAssignment: {
    chat: string
    outline: string
  }
  webSearch: {
    enabled: boolean
  }
  retrieval: {
    enabled: boolean
    topK: number
    maxContextChars: number
  }
  chat: {
    systemPrompt: string
    evidencePrompt: string
    readerContextPrompt: string
    selectionPrompt: string
    maxHistoryMessages: number
    greetingPatterns: string[]
    chapterPatterns: string[]
    bookWidePatterns: string[]
  }
}

export interface AiChatPayload {
  bookId: string
  bookTitle: string
  messages: AiHistoryMessage[]
  autoContext?: string
  currentChapterIndex?: number
  quotes?: string[]
}

export type AiQuestionCategory =
  | 'greeting'
  | 'selection'
  | 'current_sentence'
  | 'chapter'
  | 'book_wide'
  | 'general'

export interface AiSourceRef {
  index: number
  memoryId: string
  content: string
  source: string
  score: number
  bookId: string
  chapterIndex: number
  chapterTitle: string
}

export interface AiTextPart {
  type: 'text'
  text: string
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: AiTextPart[]
  createdAt: string
  status: 'complete' | 'streaming' | 'error'
  requestId?: string
  error?: string
  sources?: AiSourceRef[]
  retrievalStatus?: 'searching' | 'done' | 'offline' | 'error' | 'skipped'
  retrievalError?: string
}

export interface AiChatChunkEvent {
  requestId: string
  seq: number
  text: string
}

export interface AiChatDoneEvent {
  requestId: string
  cancelled: boolean
}

export interface AiChatErrorEvent {
  requestId: string
  code: string
  message: string
}

export interface AiChatSourcesEvent {
  requestId: string
  status: 'searching' | 'done' | 'offline' | 'error' | 'skipped'
  sources: AiSourceRef[]
  error?: string
}

export interface AiNmemStatus {
  status: 'online' | 'offline'
  checkedAt: string
  error?: string
}

export interface AiHistoryRepository {
  load: (bookId: string) => AiHistoryMessage[] | Promise<AiHistoryMessage[]>
  save: (bookId: string, messages: AiHistoryMessage[]) => void | Promise<void>
  clear: (bookId?: string) => void | Promise<void>
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
  /** 清洗格式正则规则（用户可在「设置 → 清洗」中编辑） */
  cleanRules?: CleanRule[]
  /** 全局快捷键映射（动作 -> Electron 加速器字符串；空串表示禁用该动作） */
  shortcuts?: ShortcutMap
  /** 自定义数据目录路径（空或不设则使用默认路径） */
  dataDir?: string
  /** 数据目录历史路径记录（用于回滚） */
  dataDirHistory?: string[]
  /** 启动时自动恢复上次阅读位置 */
  autoResume?: boolean
  /** AI 阅读助手配置 */
  ai?: AiSettings
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

/** 字幕样式配置 */
export interface SubtitleStyle {
  fontSize: number
  fontColor: string
  bgColor: string
  opacity: number
  maxWidth: number
}
