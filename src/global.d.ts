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
  /** 仅写进度（轻量字段数组），高频路径用，避免整本 sentences 过 IPC */
  saveProgressOnly: (
    data: Array<{
      id: string
      currentSentenceIndex?: number
      currentChapterIndex?: number
      progressPercent?: number
      lastReadAt?: string
      isCompleted?: boolean
      timeMap?: number[]
    }>
  ) => Promise<{ success: boolean; error?: string }>
  loadProgress: () => Promise<BookData[] | null>
  /** 轻量书架：仅 index+progress，无全文 */
  loadShelf: () => Promise<ShelfBook[] | null>
  /** 按需加载单书完整数据 */
  loadBookData: (bookId: string) => Promise<BookData | null>
  loadAlbums: () => Promise<CustomAlbum[] | null>
  saveAlbums: (albums: CustomAlbum[]) => Promise<{ success: boolean; error?: string }>
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean; error?: string } | void>
  loadSettings: () => Promise<AppSettings | null>
  /** 导出设置 JSON（含 API Key，用户自行保管） */
  exportSettings: () => Promise<{ success: boolean; filePath?: string; error?: string }>
  /** 从 JSON 导入设置（不切换 dataDir） */
  importSettings: () => Promise<{ success: boolean; error?: string }>
  /** 导入进度（解析/结构化/写盘） */
  onImportProgress: (
    callback: (data: { filePath: string; phase: string; detail?: string; format?: string }) => void
  ) => () => void
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
  aiConvList: (bookId: string) => Promise<{
    activeId: string | null
    conversations: Array<{ id: string; title: string; createdAt: string; messageCount: number }>
  }>
  aiConvLoad: (bookId: string, convId: string) => Promise<AiHistoryMessage[]>
  aiConvCreate: (bookId: string, title?: string) => Promise<AiConversation>
  /** 恢复该书上次会话；没有才新建 */
  aiConvEnsure: (bookId: string) => Promise<AiConversation>
  aiMcpListTools: () => Promise<{
    success: boolean
    tools: Array<{
      exposedName: string
      name: string
      serverId: string
      serverName: string
      description: string
    }>
    error?: string
    message?: string
    /** 分服务错误（部分失败时仍可能有 tools） */
    errors?: string[]
  }>
  aiMcpProbe: (server: AiMcpServerConfig) => Promise<{
    success: boolean
    ok: boolean
    toolCount: number
    tools: string[]
    error?: string
  }>
  aiConvSave: (bookId: string, convId: string, messages: AiHistoryMessage[]) => Promise<{ success: boolean }>
  aiConvDelete: (bookId: string, convId: string) => Promise<{ success: boolean }>
  aiConvRename: (bookId: string, convId: string, title: string) => Promise<{ success: boolean; error?: string }>
  aiConvSetActive: (bookId: string, convId: string) => Promise<{ success: boolean }>
  aiNmemStatus: (force?: boolean) => Promise<AiNmemStatus>
  /** 本书知识库同步状态（本地记录） */
  aiNmemBookStatus: (bookId: string) => Promise<AiBookIngestStatus>
  aiNmemIngest: (book: BookData) => Promise<{
    success: boolean
    ingested?: number
    duplicates?: number
    skipped?: number
    error?: string
  }>
  aiNmemSyncAll: (force?: boolean) => Promise<{
    success: boolean
    synced?: number
    failed?: number
    skipped?: number
    error?: string
  }>
  aiNmemDedupe: () => Promise<{
    success: boolean
    removed?: number
    kept?: number
    groups?: number
    scanned?: number
    error?: string
  }>
  aiVecStatus: (bookId: string) => Promise<{ exists: boolean; running: boolean }>
  aiVecIngest: (book: BookData) => Promise<{ success: boolean; error?: string }>
  aiVecDelete: (bookId: string) => Promise<{ success: boolean }>
  aiVecCancel: (bookId: string) => Promise<{ success: boolean; error?: string }>
  aiVecSearch: (
    bookId: string,
    query: string,
    topK?: number,
    maxChars?: number
  ) => Promise<{ results: Array<{ text: string; chapter: number; score: number }> }>
  onVecProgress: (callback: (progress: {
    bookId: string
    phase: 'chunking' | 'embedding' | 'saving' | 'done' | 'error'
    current: number
    total: number
    totalChunks: number
    error?: string
  }) => void) => () => void
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
  /** 一键为全部书更新大纲（后台运行，通过 onOutlineBatchProgress 推送进度） */
  aiOutlineRegenerateAll: (payload?: { force?: boolean }) => Promise<{
    accepted: boolean
    bookTotal?: number
    reason?: string
  }>
  /** 取消正在进行的批量大纲任务 */
  aiOutlineCancelBatch: () => Promise<{ cancelled: boolean }>
  /** 订阅批量大纲进度；返回取消订阅函数 */
  onOutlineBatchProgress: (callback: (progress: OutlineBatchProgress) => void) => () => void
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
  reparseBook: (
    bookId: string,
    options?: { mode?: 'original' | 'merged' }
  ) => Promise<{
    success: boolean
    book?: BookData
    error?: string
  }>
  /** 一键迁移：全部旧书按 original 模式重切入库 */
  migrateAllChapters: () => Promise<{
    success: boolean
    done?: number
    failed?: number
    total?: number
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
  // === 背景图 ===
  /** 列出内置预设（id+name），文件名不暴露给渲染进程 */
  backgroundList: () => Promise<Array<{ id: string; name: string }>>
  /** 上传自定义背景图：弹文件选择框，复制到数据目录，返回相对路径 */
  backgroundAdd: () => Promise<{ success: boolean; customPath?: string; error?: string }>
  /** 解析图源为 data URL；文件缺失返回 null */
  backgroundResolve: (source: 'preset' | 'custom', key: string | null) => Promise<string | null>
  /** 删除自定义背景图文件 */
  backgroundRemove: (customPath: string) => Promise<{ success: boolean; error?: string }>
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

/** 阿基米德支点：本章中「一处理解关键」的句偏移 + 为何是支点 */
export interface ChapterHinge {
  /** 句偏移（相对章首） */
  at: number
  /** 为何这是支点：一句话说明思想张力或认知转折 */
  insight: string
}

export interface ChapterOutlineSection {
  id: string
  originalTitle: string
  customTitle?: string
  point?: string
  summary?: string
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
  /**
   * 产物形态版本（软标记）。
   * 1/缺省 = 旧目录式；2 = ChapterBrief（thesis/whyItMatters/hinges）。
   * 旧 schema 仍算缓存命中，禁止因此强制重算 LLM。
   */
  schemaVersion?: number
  /** schema=2：本章一句话主张 */
  thesis?: string
  /** schema=2：读懂本章差在哪（为何重要） */
  whyItMatters?: string
  /** schema=2：1～3 个阿基米德支点 */
  hinges?: ChapterHinge[]
  generatedAt?: string
  error?: string
}

export interface ChapterOutlineGenerateRequest {
  bookId: string
  chapterIndex: number
  chapterKey: string
  /** true = 忽略已有缓存，强制重新生成 */
  force?: boolean
}

/** 批量大纲生成进度事件（与 electron/services/ai/outline-batch.ts 保持一致） */
export interface OutlineBatchProgress {
  /** 'book' = 处理中，'done' = 全部结束（含被取消） */
  phase: 'book' | 'done'
  bookIndex: number
  bookTotal: number
  bookTitle: string
  chapterIndex: number
  chapterTotal: number
  succeeded: number
  failed: number
  skipped: number
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

/** 书架卡片展示所需的最小子集（不含 sentences/chapters/structure 等重数据） */
export interface ShelfBook {
  id: string
  title: string
  author: string
  coverPath?: string
  coverSource?: 'auto' | 'custom'
  filePath: string
  format: string
  sentenceCount: number
  chapterCount: number
  addedAt: string
  lastReadAt: string
  progressPercent: number
  isCompleted: boolean
  currentSentenceIndex: number
  currentChapterIndex: number
}

/** 预选页分章模式：原始=书签边界(+超长切段)；合并=35~400 */
export type ChapterMode = 'original' | 'merged'

/** 导入时读到的书签/目录分界点（原料，切换原始/合并时共用） */
export interface ChapterBoundary {
  title: string
  sentenceIndex: number
  depth?: number
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
  /** 句子总数（启动时从 index 读取，无需加载完整 sentences 数组） */
  sentenceCount?: number
  chapters: Chapter[]
  /**
   * 书签/目录原料边界。预选页「原始/合并」都从此派生；
   * 缺省时用当前 chapters 反推（旧书迁移）。
   */
  sourceBoundaries?: ChapterBoundary[]
  /** 当前 chapters 对应的分章模式；确认阅读时写库 */
  chapterMode?: ChapterMode
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

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** OpenAI 兼容 tool call（agent 循环用，一般不落盘历史） */
export interface AiToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface AiPromptMessage {
  role: AiMessageRole
  content: string
  /** role=tool 时关联的 call id */
  tool_call_id?: string
  /** 可选函数名 */
  name?: string
  /** role=assistant 且请求工具时 */
  tool_calls?: AiToolCall[]
}

/** MCP 外部工具服务配置 */
export interface AiMcpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  /** stdio：可执行文件（如 uvx / npx / python） */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /** http：JSON-RPC 端点 */
  url?: string
  headers?: Record<string, string>
  timeoutMs?: number
  description?: string
}

export interface AiMcpSettings {
  /** 总开关：关闭则不拉起任何 MCP 进程 */
  enabled: boolean
  servers: AiMcpServerConfig[]
}

export interface AiAgentSettings {
  /**
   * auto：有可用工具则走 tool-calling agent；否则旧预检索
   * tools：强制 agent（无工具则纯对话）
   * prefetch：旧行为，宿主先查再答、不下发 tools
   */
  mode: 'auto' | 'tools' | 'prefetch'
  /** agent 最大工具轮数 */
  maxToolRounds: number
}

/** 落盘历史：不含 tool 轮中间消息 */
export interface AiHistoryMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 稳定消息 ID；旧历史可能缺失，加载时会补齐 */
  id?: string
  sources?: AiSourceRef[]
  /** 联网搜索结果（与书内 sources 分离，刷新后仍保留） */
  webSources?: AiWebSourceRef[]
  /** 本轮是否启用了联网搜索 */
  webSearchUsed?: boolean
  /** 本轮工具调用痕迹（含 MCP） */
  toolTraces?: AiToolTrace[]
  /** 模型原生思考链（DeepSeek-R1 等 reasoning_content） */
  reasoning?: string
  /** @deprecated 旧伪思考模式字段，加载时忽略 */
  thinkingMode?: boolean
  retrievalStatus?: 'done' | 'offline' | 'error' | 'skipped'
  retrievalError?: string
}

export interface AiConversation {
  id: string
  title: string
  createdAt: string
  updatedAt?: string
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

export type AiProvider = 'openai' | 'zhipu' | 'volcengine' | 'deepseek' | 'siliconflow' | 'dashscope' | 'moonshot' | 'spark' | 'other'

export interface AiEngine extends AiLlmSettings {
  id: string
  name: string
  provider?: AiProvider
}

export interface AiNmemSettings {
  enabled: boolean
  baseUrl: string
  autoIngest: boolean
  healthTimeoutMs: number
  searchTimeoutMs: number
  ingestTimeoutMs: number
  statusCacheMs: number
}

export interface AiEmbeddingSettings {
  baseUrl: string
  apiKey: string
  model: string
  /** 向量维度，0 = 使用模型默认 */
  dimension: number
  /** 批量 ingest 每批条数 */
  batchSize: number
}

export interface AiSettings {
  nmem: AiNmemSettings
  embedding: AiEmbeddingSettings
  /** @deprecated 向后兼容，优先使用 engines */
  llm: AiLlmSettings
  engines: AiEngine[]
  taskAssignment: {
    chat: string
    outline: string
  }
  /** 真 MCP 宿主（stdio/HTTP） */
  mcp: AiMcpSettings
  /** 工具调用 agent */
  agent: AiAgentSettings
  webSearch: {
    enabled: boolean
    /** 联网搜索系统提示词（可在高级设置编辑） */
    prompt: string
    /**
     * 搜索后端：与对话模型完全解耦。
     * - auto：按可用 Key 自动切换（Ollama → 智谱 → DuckDuckGo）
     * - ollama / zhipu / ddg：强制指定
     * - zhipu-native：旧兼容（对话引擎为智谱时下发 tool）
     * - none：不发起真实搜索
     */
    backend?: 'auto' | 'ollama' | 'zhipu' | 'zhipu-native' | 'ddg' | 'none'
    /** 每次搜索最多返回条数 1–10 */
    maxResults?: number
    /** Ollama Cloud API Key（https://ollama.com/settings/keys） */
    ollamaApiKey?: string
    /** 默认 https://ollama.com */
    ollamaBaseUrl?: string
    /**
     * 智谱独立搜索 Key（可选）。
     * 不填则回退到「引擎列表里第一个智谱引擎」的 Key。
     * 可与对话模型完全无关。
     */
    zhipuApiKey?: string
    /** 智谱 API 地址，默认 open.bigmodel.cn */
    zhipuBaseUrl?: string
    /**
     * 用户自定义外部源（URL 白名单 / 偏好展示名）。
     * 本地桌面端：status 默认 approved。
     */
    customSources?: AiExternalSourceConfig[]
    /**
     * Semantic Scholar 学术论文检索（免费，社科/理工通用）。
     * 可与普通联网并行；无需 Key，可选填 Key 提高配额。
     */
    academicEnabled?: boolean
    semanticScholarApiKey?: string
    /**
     * SciVerse（sciverse.space）学术元搜索。
     * 需 Bearer Token；免费起步配额。与 Semantic Scholar 可并行。
     */
    sciverseEnabled?: boolean
    sciverseApiKey?: string
    /** 默认 https://api.sciverse.space */
    sciverseBaseUrl?: string
  }
  retrieval: {
    enabled: boolean
    /** 本轮最多引用几条书内记忆（检索 topK） */
    topK: number
    /** 注入模型的书内证据总字符上限 */
    maxContextChars: number
  }
  chat: {
    systemPrompt: string
    evidencePrompt: string
    readerContextPrompt: string
    selectionPrompt: string
    /** 「当前章」注入提示词（本章 ≤ fullTextMaxChars 时每轮可注入） */
    fullTextInjectPrompt: string
    /** 本章注入字数上限（默认 50000，按当前章计，非全书） */
    fullTextMaxChars: number
    /** 大纲生成 system 提示词 */
    outlineSystemPrompt: string
    maxHistoryMessages: number
    greetingPatterns: string[]
    chapterPatterns: string[]
    bookWidePatterns: string[]
  }
}

export interface AiChatPayload {
  bookId: string
  bookTitle: string
  /** 目标会话；缺失时后端写入该书 active 会话（兼容旧调用） */
  conversationId?: string
  messages: AiHistoryMessage[]
  autoContext?: string
  currentChapterIndex?: number
  quotes?: string[]
  /**
   * 本轮是否注入「当前章节」正文（本章字数 ≤ fullTextMaxChars 时每轮可注入，保证追问仍有上下文）。
   * 注入后仍会做知识库检索。
   */
  injectFullText?: boolean
  /** 待注入的当前章正文 */
  fullText?: string
  /** 本轮是否开启思考模式（分步推理提示） */
  thinkingMode?: boolean
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

/** 联网 / 外部信息源条目（挂在助手消息上，可点击展开） */
export interface AiWebSourceRef {
  index: number
  title: string
  url: string
  snippet: string
  /** ollama | zhipu | ddg | custom */
  provider: string
  /** 权威新闻 / 学术数据库 / 网页 等 */
  sourceType: string
  fetchedAt: string
}

/** 本轮工具调用痕迹（内置 + MCP），给 UI 展示「到底调了什么」 */
export interface AiToolTrace {
  /** 工具名，如 search_book / web_search / mcp_zotero_xxx */
  name: string
  ok: boolean
  durationMs?: number
  /** 一行摘要，如「命中 3 条」「失败: 超时」 */
  summary?: string
}

/** 用户可配置的外部源偏好项 */
export interface AiExternalSourceConfig {
  id: string
  name: string
  /** 域名或完整 URL */
  url: string
  sourceType: string
  /** approved | pending | rejected — 本地默认 approved */
  status: 'approved' | 'pending' | 'rejected'
  /** 可选权重 0–100，仅影响展示排序，不改检索算法 */
  weight?: number
  createdAt: string
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
  webSources?: AiWebSourceRef[]
  webSearchUsed?: boolean
  /** 本轮工具调用痕迹（含 MCP） */
  toolTraces?: AiToolTrace[]
  /** 模型原生思考过程全文 */
  reasoning?: string
  thinkingMode?: boolean
  retrievalStatus?: 'searching' | 'done' | 'offline' | 'error' | 'skipped'
  retrievalError?: string
}

export interface AiChatChunkEvent {
  requestId: string
  seq: number
  /** 回答正文增量 */
  text?: string
  /** 原生思考链增量 */
  reasoning?: string
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
  /** 本轮联网结果（可与书内检索并行到达） */
  webSources?: AiWebSourceRef[]
  webSearchUsed?: boolean
  /** 本轮已执行的工具（逐步推送） */
  toolTraces?: AiToolTrace[]
  error?: string
}

export interface AiNmemStatus {
  status: 'online' | 'offline'
  checkedAt: string
  error?: string
}

/** 单本书在知识库中的本地同步状态 */
export interface AiBookIngestStatus {
  status: 'none' | 'submitting' | 'indexing' | 'searchable' | 'failed'
  sourceId?: string
  error?: string
  updatedAt?: string
}

export interface AiHistoryRepository {
  load: (bookId: string) => AiHistoryMessage[] | Promise<AiHistoryMessage[]>
  /** conversationId 指定写入会话；缺省写 active / 第一个会话 */
  save: (
    bookId: string,
    messages: AiHistoryMessage[],
    conversationId?: string
  ) => void | Promise<void>
  clear: (bookId?: string) => void | Promise<void>
}

export interface ImportResult {
  success: boolean
  book?: BookData
  error?: string
  /** 非致命提示，如 PDF 仅文字层 */
  warning?: string
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

/**
 * 应用背景（三层：底层纯色 → 可选底图 → 组件半透明）。
 * 设置页只暴露精简项；下列带 ? 的旧字段读入时兼容，写入时可不带。
 */
export interface BackgroundSettings {
  /** 是否启用背景图（关则只显示底层纯色） */
  enabled: boolean
  /** 用内置预设还是用户上传 */
  source: 'preset' | 'custom'
  /** 预设 id；source=preset 时生效 */
  presetId: string | null
  /** 自定义图相对路径；source=custom 时生效 */
  customPath: string | null
  /** 背景图模糊 px，0–20 */
  blur: number
  /**
   * 底图压暗程度 0–1（遮罩不透明度）。
   * 遮罩色固定跟日夜：浅色白罩 / 深色黑罩。
   */
  overlayOpacity: number
  /**
   * 最底层纯色：auto=跟日夜；fromImage=从底图取样；或 #RRGGBB
   */
  baseColor?: 'auto' | 'fromImage' | string
  /** fromImage 取样缓存 */
  baseColorCached?: string | null
  /** 侧栏/工具条等组件不透明度 0.15–1，默认 0.72 */
  panelOpacity?: number
  /**
   * 阅读正文遮罩浓度 0.5–1，默认 0.9。
   * AI 阅读 + 听书共用 .reader-stage
   */
  contentOpacity?: number
  /** 组件/正文毛玻璃（更强模糊） */
  glass?: boolean

  /** 兼容旧配置：frost 开关读入用（旧 settings.json 可能带 panelEffect=frost） */
  panelEffect?: string
}

export interface AppSettings {
  ttsEngine: string // 引擎ID，内置: edge/qwen/system，也支持自定义引擎ID
  qwenApiKey: string
  qwenEndpoint: string
  voiceId: string
  defaultSpeed: number
  defaultVolume: number
  /** 主窗口是否置顶；默认 false，避免抢焦点 */
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
  /** 应用背景图配置 */
  background?: BackgroundSettings
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
