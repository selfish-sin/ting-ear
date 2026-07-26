# 听伴 (TingEar) CONTEXT

> 最近核对：2026-07-27 | 严格对照当前源码；AI 阅读 A–F、阅读交互基础、章节大纲 v3、整本 ingest 已实现

## 一分钟速览

Windows Electron 应用：导入 EPUB/TXT/PDF/DOCX/MD/HTML/MOBI(需 Calibre)，默认 AI 阅读（结构化卡片 + 当前章大纲 + 书内问答），可切听书（逐句 TTS）。渲染层 React + TS + Zustand + Tailwind；主进程负责 IPC、解析、RAG/大纲/整本 ingest、TTS 引擎。

## 文件索引

| 文件 | 核心内容 | 何时读 |
|---|---|---|
| `src/App.tsx` | 视图路由、`readerMode` 切换、沉浸开关、`AiPlaybackCapsule` / 完整底栏策略、autoResume | 改全局布局/模式入口/沉浸/启动恢复 |
| `src/components/reader/AiPlaybackCapsule.tsx` | AI 阅读可拖拽播放胶囊；`shouldShowAiPlaybackCapsule` / `shouldShowFullPlaybackBar` | 改 AI 模式播放控件 |
| `src/components/PlayerView.tsx` | 听书模式选章、句子列表、顶栏工具；沉浸时顶栏上移 | 改听书正文 UI |
| `src/components/BookShelf.tsx` | 书架网格/列表、右键菜单、专辑与批量、继续阅读卡 | 改书架/专辑 |
| `src/components/ui/ContextMenu.tsx` | Portal 右键菜单（视口钳制、键盘、焦点恢复） | 改任何右键/溢出菜单 |
| `src/components/reader/AiReaderView.tsx` | AI 阅读三栏；大纲面板、连续正文、AI 侧栏；旧书伪结构 | 改 AI 阅读布局/生命周期 |
| `src/components/reader/ContentCards.tsx` / `ContentCard.tsx` | 章节标题去重、正文右键、连续排版、当前句/raw 高亮 | 改正文/高亮/滚动 |
| `src/components/reader/ChapterOutlinePanel.tsx` | **唯一挂载**的当前章大纲 UI（生成/重试/改名） | 改大纲面板 |
| `src/components/reader/ChapterOutline.tsx` / `SectionNav.tsx` | 旧实现，**未挂载**；勿重新接回 | 清理遗留时再读 |
| `src/components/reader/ModeSwitch.tsx` / `ReaderHeader.tsx` | AI 阅读/听书切换；阅读页顶栏 | 改模式控件/页头 |
| `src/components/ai/*` | 侧栏、消息、引用、选区、检索、nmem 横幅 | 改 AI 对话交互 |
| `src/components/settings/AiSettingsPanel.tsx` / `src/aiSettings.ts` | AI 表单与默认值/深合并/路由正则 | 改 AI 配置或 prompt |
| `src/hooks/useTTS.ts` | 书籍播放、ttsSkip、唯一 Audio、`speakRaw`/`stopRaw`、系统兜底 | 改 TTS 生命周期 |
| `src/utils/audioOutput.ts` / `ttsSkip.ts` / `ttsSession.ts` / `contentHash.ts` | GainNode、跳过导航、raw 互斥、SHA-256 前 16 位 | 改音量/跳过/哈希 |
| `src/utils/bookData.ts` | 分句/章节/structure 校验/pseudo 重建/PlayPref | 改文本数据或结构一致性 |
| `src/stores/playerStore.ts` / `bookStore.ts` / `settingsStore.ts` / `aiStore.ts` | 播放、书籍、`readerMode`、AI 流状态 | 改状态默认值 |
| `src/cleanRules.ts` / `src/shortcuts.ts` | 默认清洗规则；快捷键定义 | 改规则或键位 |
| `electron/main.ts` / `preload.ts` | 启动、托盘、`window.api` | 改主进程或桥接 |
| `electron/ipc/aiHandlers.ts` | `ai:chat/*`、`ai:nmem:*`、`ai:outline:*` | 改 AI/大纲 IPC |
| `electron/ipc/fileHandlers.ts` | 导入/导出、JSON 读写、`getDataDir`、启动 ingest | 改导入/持久化 |
| `electron/services/ai/llm-caller.ts` / `ai-service.ts` | SSE、错误分类、路由、RAG 编排、代理走 axios、智谱别名 | 改模型请求/检索编排 |
| `electron/services/ai/nmem-bridge.ts` | nmem health/search/ingest HTTP | 改知识库协议 |
| `electron/services/ai/ingest-service.ts` / `ingest-scheduler.ts` | **整本**一书一源同步、`ingest-status.json`、排队重试 | 改知识库导入 |
| `electron/services/ai/outline-*.ts` | 生成规则、输入校验、FIFO 队列、v3 缓存 | 改大纲流水线 |
| `electron/services/ai/ai-history.ts` / `ai-config.ts` | `ai-history.json`；主进程 AI 配置入口 | 改历史或配置读取 |
| `electron/ipc/ttsHandlers.ts` + `tts-engines/*` | 合成/引擎 CRUD；Edge/千问/HTTP | 改 TTS |
| `electron/services/parsers/*` | 各格式解析、`structureBuilder`、`textPreprocessor`、mobi→Calibre | 改导入解析/清洗 |
| `electron/ipc/ocrHandlers.ts` + `ScreenshotOverlay.tsx` | RapidOCR 截区 | 改 OCR |

## TTS 调用链

```text
useTTS.playSentence
 -> 内存 prefetchCache 命中? → base64
 -> 未命中 → window.api.ttsSynthesize(..., volume=1.0, engineId)
    -> EngineManager → Edge / Qwen / HttpAdapter
 -> base64 → 复用 Audio + GainNode（响度只在渲染层）
```

- `AudioContext({ latencyHint: 'playback' })` + `getReusableAudio()`：减颤音、避免重复建 MediaElementSource
- `PREFETCH_CONCURRENCY=2`；预取失败不影响当前句
- 在线失败：`playWithSystemTTS()` **临时**兜底，不改 `settings.ttsEngine`
- `EngineManager` **不**在 Edge/千问/HTTP 之间自动切换；查 `logs.json` 的 `source=TTS`

## 文本清洗

已移除内置清洗 LLM（无 `electron/services/llm`、无 text-reviewer）。

```text
导入 / 手动清洗
 -> enhancedClean / preprocessText
 -> removeCJKSpaceGaps → mergeBrokenLines → collapseBlankLines
 → normalizePunctuation → 页码/页眉清理
 -> splitSentences（约 20 字最短可读）
```

历史 `llmConfigs` / `cleanPrompt` 读设置时丢弃。规则可可视化编辑；AI 生成规则仅支持「粘贴导入」。

## 播放器 UI 约定

| 区域 | 内容 |
|---|---|
| TitleBar | 拖拽 + 主题 + 窗控；沉浸时细条仅窗控 |
| 播放器顶栏 | 章节/版本/搜索/字幕等；**无**沉浸按钮 |
| 沉浸开关 | 仅 `App.tsx`：`fixed top-24 right-4 z-[60]` |
| AI 阅读底栏 | `AiPlaybackCapsule`（可拖拽）；隐藏完整 ProgressBar+ControlBar |
| 听书底栏 | 左倍速/音量 · 中播放包绕 · 右音色/在线离线 |

沉浸：侧栏/顶栏/底栏隐藏；离开 `player` 视图自动退出。改位置只改 `App.tsx` 的 fixed 坐标。

## AI 阅读与结构

- 打开书时 `readerMode` 默认 `ai-reading`；模式切换**不**重置播放索引
- 三栏：`ChapterOutlinePanel` + `ContentCards` + `AiChatPanel`；沉浸时隐藏 chrome，AI 面板稳定挂载以免取消流式回答
- 无 `structure` 的旧书：前端伪结构（章标题 heading + 每 5 句一段），**不写回**
- 接受 structure 条件：`schemaVersion=1`、形状/类型/唯一 blockId、range 连续且在 sentences 边界内；否则 `generatePseudoStructure` 重建并重派生 `chapters`
- `structureMeta.contentHash`：句子换行拼接后 UTF-8 SHA-256 **前 16 位**（`contentHash.ts`）

## AI 对话 / RAG / 引用 / raw 朗读

```text
aiStore.sendMessage
 -> ai:chat → AiService.chat
 -> classifyQuestion(selection→greeting→book_wide→chapter→current_sentence→general)
 -> nmem.search（按 bookId/路由/当前章硬过滤）
 -> sources 事件 → streamChat SSE chunks → done/error
```

- 200 响应中的 error envelope 或空正文算失败；主模型失败可试一次备用模型
- nmem 断线只降级当前请求；面板横幅 + `statusCacheMs` 轮询
- **ingest：整本一书一源**（`IngestService` + `IngestScheduler`），状态在 `ingest-status.json`；旧按章状态会触发整本重传。自动 ingest 不阻塞导入
- 选区：去空白 >2 字显示 `SelectionPopup`；引用最多 5 条；「问 AI」持久请求展开侧栏并聚焦
- 历史：`ai-history.json` 每书最多 200 条；损坏文件整体抛错，禁止静默覆盖
- `speakRaw`：卡片/回答朗读，不写 `currentSentenceIndex`/历史/字幕；`rawSpeechActive` 隔离书籍会话

## 章节大纲（v3）

| 模块 | 作用 |
|---|---|
| `outline-input.ts` | 从 `books.json` 重载当前章，校验 chapterKey，不信任 renderer 正文 |
| `outline-generator.ts` | 短章策略、比例最低节数、偏移校验 |
| `outline-queue.ts` | 进程级 FIFO 单飞行 |
| `outline-repository.ts` | `outlines/<bookId>.json`，`OUTLINE_CACHE_VERSION=3`，原子写 |
| IPC | `ai:outline:get/generate/update`（另有 legacy-generate 兼容） |

切章只读缓存，不自动生成。缓存键：`bookId + chapterKey + sentenceContentHash`。

## 音量注意

- `setVolume`：`v===0` 静音，`v>0` 取消静音；静音时保留记忆音量
- 步进用记忆音量，**不要**用 `displayVolume` 再 `toggleMute`
- 合成侧 `volume=1.0`；显示增益只走 GainNode

## 启动与数据

```powershell
.\start.bat          # 可见控制台 → npm run dev
npm run dev          # Vite 默认 5191
npm run build / typecheck / lint / test
```

数据目录 `%APPDATA%/ting-ear/听伴/`（或自定义）：`books.json`、`ai-history.json`、`settings.json`、`engines.json`、`bookmarks.json`、`history.json`、`albums.json`、`logs.json`、`ingest-status.json`、`outlines/`、`covers/`、`cache/`。路径统一 `getDataDir()`。启动时主进程同步活动 TTS 引擎为 `settings.ttsEngine`。

## 断点恢复（autoResume）

1. **启动**：`lastReadAt` 最近且未完成、进度>0 → `handleOpenBook`（`autoResumedRef` 一次）
2. **书架「继续阅读」**：全部书籍视图顶部卡片
3. **历史**：`HistoryView` 跳到 `endSentenceIndex`

`AppSettings.autoResume` 默认 true；`=== false` 才关闭。

## 测试（`npm test` 串联）

清洗/数据：`textPreprocessor`、`bookData`、`bookStore`、`albumUtils`  
解析/结构：`parserCompatibility`、`epubParserStructure`、`mdParserStructure`、`structureBuilder`、`structureVersionMismatch`  
阅读 UI：`readerComponents`、`contextMenuComponents`、`modeSwitchPlayback`、`chapterTitleEditing`  
AI/RAG：`llmCaller`、`ipcStreaming`、`settingsDeepMerge`、`aiHistory`、`aiStore`、`aiComponents`、`aiSettingsPanel`、`nmemBridge`、`nmemContract`、`spoilerFilter`、`ragOrchestration`、`ragComponents`、`selectionQuoteComponents`、`fullTextInject`  
大纲：`outlineGenerator`、`outlineRepository`、`outlineQueue`、`outlineIntegration`、`outlineIpc`  
ingest：`ingestWholeBook`  
TTS：`ttsSkip`、`ttsSession`、`engineImport`

改清洗/分句后务必 `npm test`；改 IPC 后 `npm run typecheck`。

## 当前状态与边界

- 在线 Edge/千问/HTTP + 系统 Web Speech 临时兜底；引擎管理与导入导出可用
- 清洗纯规则；音量 0~200%；封面 `COVER_STYLE_VERSION=v2-light`
- AI 阅读 A–F、共享右键菜单、连续阅读排版、章节标题去重、全局 focus-visible 已完成
- 大纲按当前章按需生成，缓存 v3；`ChapterOutlinePanel` 为唯一大纲 UI
- 知识库 **整本**同步（非按章）；nmem 默认 `127.0.0.1:14242`
- Electron 主进程 `fetch` 不读代理环境变量；检测到代理时模型请求走 axios（见 `llm-caller.ts`）
- 智谱旧别名 `GLM-4.7-Flash` → 请求层映射 `glm-4.7`
- MOBI 依赖本机 Calibre；PDF 仅文字层；不要把书籍/API Key/日志/缓存提交 Git
