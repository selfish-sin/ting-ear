# 听伴 (TingEar) CONTEXT

> 最近核对：2026-07-30 | 严格对照当前源码；设置 4Tab 定高、healBookLayout 打开热路径、大纲 repository v4、原子写/日志批量、openExternal 白名单、设置导入导出

## 一分钟速览

Windows Electron 应用：导入 EPUB/TXT/PDF/DOCX/MD/HTML/MOBI(需 Calibre)，默认 AI 阅读（结构化卡片 + 当前章大纲 + 书内问答），可切听书（逐句 TTS）。渲染层 React + TS + Zustand + Tailwind；主进程负责 IPC、解析、RAG/大纲/整本 ingest、TTS 引擎。

## 文件索引

| 文件 | 核心内容 | 何时读 |
|---|---|---|
| `src/App.tsx` | 视图路由、`readerMode` 切换、沉浸开关、`AiPlaybackCapsule` / 完整底栏策略、autoResume | 改全局布局/模式入口/沉浸/启动恢复 |
| `src/components/reader/AiPlaybackCapsule.tsx` | AI 阅读可拖拽播放胶囊；`shouldShowAiPlaybackCapsule` / `shouldShowFullPlaybackBar` | 改 AI 模式播放控件 |
| `src/components/PlayerView.tsx` | 听书模式选章、句子列表、顶栏工具；沉浸时顶栏上移 | 改听书正文 UI |
| `src/components/BookShelf.tsx` | 书架编排：状态/批量/专辑/右键；卡片 UI 在 `bookshelf/` | 改书架流程 |
| `src/components/bookshelf/*` | 缩放常量、网格/列表卡、继续阅读、批量栏 | 改书架卡片 UI |
| `src/components/SettingsModal.tsx` | 设置弹窗壳（4 tabs：常规/朗读/AI/清洗），`h-[80vh]` 定高 | 改设置入口 |
| `src/components/settings/*` | General/TTS/Ai 分面板（Appearance/Shortcuts/About 已删） | 改各设置页 |
| `src/components/ui/ContextMenu.tsx` | Portal 右键菜单（视口钳制、键盘、焦点恢复） | 改任何右键/溢出菜单 |
| `src/components/reader/AiReaderView.tsx` | AI 阅读三栏；大纲面板、连续正文、AI 侧栏；旧书伪结构 | 改 AI 阅读布局/生命周期 |
| `src/components/reader/ContentCards.tsx` / `ContentCard.tsx` | 章节标题去重、正文右键、连续排版、当前句/raw 高亮 | 改正文/高亮/滚动 |
| `src/components/reader/ChapterOutlinePanel.tsx` | **唯一挂载**的当前章大纲 UI（生成/重试/改名） | 改大纲面板 |
| `src/components/reader/ChapterOutline.tsx` / `SectionNav.tsx` | **已删除**（曾未挂载） | — |
| `src/components/reader/ModeSwitch.tsx` / `ReaderHeader.tsx` | AI 阅读/听书切换；阅读页顶栏 | 改模式控件/页头 |
| `src/components/ai/*` | 侧栏、消息、引用、选区、检索、nmem 横幅、`KnowledgeBaseButton`（每书本地知识库入口：未建/建中/已建+重建·删除） | 改 AI 对话交互 |
| `src/components/settings/AiSettingsPanel.tsx` / `src/aiSettings.ts` | AI 表单与默认值/深合并/路由正则 | 改 AI 配置或 prompt |
| `src/hooks/useTTS.ts` | 书籍播放、ttsSkip、唯一 Audio、`speakRaw`/`stopRaw`、系统兜底 | 改 TTS 生命周期 |
| `src/utils/audioOutput.ts` / `ttsSkip.ts` / `ttsSession.ts` / `contentHash.ts` / `uiReady.ts` | GainNode、跳过导航、raw 互斥、SHA-256 前 16 位、`waitForReaderReady` | 改音量/跳过/哈希/打开就绪 |
| `src/utils/bookData.ts` | 分句/章节/structure 校验/pseudo 重建/PlayPref/`healBookLayoutForReading`/`normalizeAndHealBook` | 改文本数据或结构一致性 |
| `src/stores/playerStore.ts` / `bookStore.ts` / `settingsStore.ts` / `aiStore.ts` | 播放（`prepareForBook`）、书籍（`enterPlayerSession`）、`readerMode`、AI 流状态 | 改状态默认值 |
| `src/cleanRules.ts` / `src/shortcuts.ts` | 默认清洗规则；快捷键定义 | 改规则或键位 |
| `electron/main.ts` / `preload.ts` | 启动、托盘、`window.api` | 改主进程或桥接 |
| `electron/ipc/aiHandlers.ts` | `ai:chat/*`、`ai:nmem:*`、`ai:outline:*` | 改 AI/大纲 IPC |
| `electron/ipc/fileHandlers.ts` | 导入/导出、JSON 读写、`getDataDir`、启动 ingest | 改导入/持久化 |
| `electron/services/ai/llm-caller.ts` / `ai-service.ts` | SSE、错误分类、路由、RAG 编排、代理走 axios、智谱别名 | 改模型请求/检索编排 |
| `electron/services/ai/nmem-bridge.ts` | nmem health/search/ingest HTTP | 改知识库协议 |
| `electron/services/ai/local-ingest.ts` / `vector-store.ts` / `embedding-caller.ts` | **本地向量知识库**：按章分块(≤800字+2句重叠+章名拼进 embedding)→OpenAI 兼容 embedding→`vectors/{bookId}.json`(base64 Float32)；检索=进程内缓存(mtime 失效)+cosine+章节过滤+相对分数阈值 | 改本地索引/分块/检索 |
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
- **打开缓冲**：`isLoading` 时全局 `LoadingOverlay` 盖住；**禁止**卸载 `ContentCards`。就绪用 `waitForReaderReady`（等 `[data-content-cards]` 有高度），不是只等 rAF
- **布局关口（防「修完又盖回去」）**：`isUnhealthyBookLayout` / `healBookLayoutForReading` / `normalizeAndHealBook`。读盘(`loadBookFile`)、导入、reparse、`loadFullBook`、进入阅读**同一把尺子**；导入时病态旧 structure **不得**因 contentHash 未变而沿用
- **打开热路径**：heal → `enterPlayerSession` 一次写 store → `prepareForBook`；主文本治愈后后台 persist 瘦身
- 无 `structure` / 巨书：章骨架（`blocks:[]`）+ 当前章 `ensureChapterBlocks` 懒建；`generatePseudoStructure` 对超大书也改骨架
- 接受 structure：trusted 打开只做章级轻量检查；完整 block 校验留给非 trusted。structure 若单章超长**不得**覆盖已切开的 `chapters`
- 分章（`buildChaptersByMode`）：`original` 保留书签并**切开 >400**；`merged` 套 35~400。`regroupStructuredChapters` **单章巨 blob 也必须切**（旧 early-return 是事故根因）。`refineChapters` 默认 `skipOversizedSplit=true` 仅兼容旧调用
- 兜底标题 `第N部分`（`toChineseNumber` 支持到千）；无标题 MD 文集走伪分章，不造 `第N章`
- `structureMeta.contentHash`：句子换行拼接后 UTF-8 SHA-256 **前 16 位**（`contentHash.ts`）

## AI 对话 / RAG / 引用 / raw 朗读

```text
aiStore.sendMessage
 -> ai:chat → AiService.chat
 -> classifyQuestion(selection→greeting→book_wide→chapter→current_sentence→general)
 -> combinedRetrieve：nmem.search ‖ 本地向量(searchBookVectors) 并行
    -> chapter 类问题：本地向量只在该章算 cosine（下推过滤，避免 topK 槽位被别章占满）
    -> 双源 RRF 倒数排名融合 + 前 100 字去重（nmem Rust 分数与本地 cosine 0..1 尺度不可比，不比绝对分数只比排名）
 -> buildSourceRefs（按 bookId/路由/当前章硬过滤）→ sources 事件 → streamChat SSE chunks → done/error
```

- 200 响应中的 error envelope 或空正文算失败；主模型失败可试一次备用模型
- nmem 断线只降级当前请求；面板横幅 + `statusCacheMs` 轮询
- **本地向量知识库**（`local-ingest`/`vector-store`/`embedding-caller`）：
  - 分块：按章→句子边界对齐，≤800 字，**块间 2 句重叠**，**章名拼进 embedding 文本**（存储 `text` 仍是纯正文）；`VectorChunk` 带 `chapterTitle`（旧文件缺省回退「第 N 章」）
  - 存储：`vectors/{bookId}.json`，向量 base64 Float32（**注意 `decodeVec` 必须用 `buf.buffer.slice(byteOffset,…)` 而非 `new Float32Array(buf.buffer)`——Buffer 走共享内存池，`.buffer` 比实际大，直接用会读出垃圾**）
  - embedding 请求：**单批指数退避重试**（5xx/429/网络错误 4 次，800ms→1.6s→3.2s，4xx 不重试直接抛）；单批重试耗尽后 `ingestBookLocal` **降级跳过该批**保留已成功向量（按 chunk 索引收集，跳过批次不写入避免错位），全书所有批次失败才抛错。`IngestProgress.skipped` 报告跳过块数
  - 检索：**进程内缓存**（`getCachedVectors`，按文件 mtime 失效，一次性解码全部 Float32Array，热路径跳过逐块 base64）；cosine topK + **相对分数阈值**（默认保留 ≥0.5×最高分，绝对地板 0.3，`minScoreRatio:0` 关闭→旧行为）
  - **坑：embedding 模型/维度变更后必须重建知识库**——`assertVectorCompat` 校验维度与模型名，不一致抛 `VectorCompatError`（绝不截断维度照算 cosine 得垃圾分）；`combinedRetrieve`/`ai:vec:search` catch 后降级为空结果并 warn
  - **坑（已修）**：本地向量结果 source 必须是 `[bookId=..][ch=..] 章名` 格式才能被 `parseSourceMetadata`/`buildSourceRefs` 保留；旧格式「本地向量·第X章」会被全量静默丢弃
  - **入口**：`KnowledgeBaseButton`（AI 助手头部，每书常驻）→ `aiVecIngest`/`aiVecCancel`/`aiVecDelete`；已建点开给「重建/删除」。进度仍由 `NmemBanner` 渲染
  - **坑（已修）**：`NmemBanner`「进行中」分支必须在 `offline`/`none`/`failed` 之前——否则未同步到 nmem 的书做本地向量化时进度条被「none」分支截胡永不显示
  - **坑（已修）**：`ai:nmem:ingest` 不再自动连带 `ingestBookLocal`——本地向量化只由 `KnowledgeBaseButton` 的 `ai:vec:ingest` 发起。否则未点按钮也会发 `ai:vec:progress`，`KnowledgeBaseButton` 假显 building、`NmemBanner` 假显进度，无法辨识是否真正向量化过
- **prompt 9 层组装**（`buildPromptMessages`）：system→webSearch→readerContext→chapterFullText→bookEvidence→webResults→selectedQuotes→history；**总字符预算 60000 守卫**，超限按优先级丢 chapterFullText→webResults→readerContext（证据/历史始终保留）
- **ingest：整本一书一源**（`IngestService` + `IngestScheduler`），状态在 `ingest-status.json`；旧按章状态会触发整本重传。自动 ingest 不阻塞导入。**本地 contentHash 是唯一重传依据**：hash 匹配且状态正常 → 直接信任本地、不查远程、不重传（绝不因 nmem 抖动/重启而每次打开全量重导）。`IngestScheduler` 有 **per-book in-flight 锁** + **status 串行写队列**（防批量并行 tryIngest 覆盖 `ingest-status.json` 丢状态→探针再传升 nmem v2）。`ai:nmem:ingest` 统一走共享 scheduler。**坑：nmem 不按 name 去重，重传会升 version(v1/v2/v3) 或新建 src_***；上传成功后按 bookId 扫远程删兄弟源。`listSources` 必须读 `original_name`+`lifecycle_state` 并用 `offset/limit` 翻页（默认只 50 条）。`dedupeSources`/`ai:nmem:dedupe`（设置页，**纯手动**）按 `[bookId=]` 分组，保留 ready→高 version，删多余；会修正本地 sourceId 指向保留源。已废弃 `verifyExisting`
- 选区：去空白 >2 字显示 `SelectionPopup`；引用最多 5 条；「问 AI」持久请求展开侧栏并聚焦
- 历史：`ai-history.json` 每书最多 200 条；损坏文件整体抛错，禁止静默覆盖
- `speakRaw`：卡片/回答朗读，不写 `currentSentenceIndex`/历史/字幕；`rawSpeechActive` 隔离书籍会话

## 章节大纲（repository v4）

| 模块 | 作用 |
|---|---|
| `outline-input.ts` | 从分片库重载当前章，校验 chapterKey，不信任 renderer 正文；`sentences: string[]` |
| `outline-generator.ts` | 纯 LLM 生成（短章策略、分块、偏移校验）；**不落盘** |
| `outline-queue.ts` | 进程级 FIFO 单飞行 |
| `outline-batch.ts` | 单章/批量生成编排，`generateChapterOutlineRecord` 写 repository |
| `outline-repository.ts` | `outlines/<bookId>.json`，`OUTLINE_CACHE_VERSION=4`，原子写 |
| IPC | `ai:outline:get/generate/update`（另有 legacy-generate 兼容） |

切章只读缓存，不自动生成。缓存键：`bookId + chapterKey + sentenceContentHash`。  
旧 generator 内整书 CACHE_VERSION=2 已移除，避免双缓存。

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

数据目录 `%APPDATA%/ting-ear/听伴/`（或自定义）：分片书架 `library/index.json` + `library/books/{id}.json` + `progress.json`（进度高频小文件；旧 `books.json` 启动时自动迁移）；另有 `ai-history.json`、`settings.json`、`engines.json`、`bookmarks.json`、`history.json`、`albums.json`、`logs.json`、`ingest-status.json`、`outlines/`、`covers/`、`cache/`。路径统一 `getDataDir()`。写盘有空数组覆盖保护与 `.bak`；`settings.json` / logs 用原子写（tmp+rename）；日志批量 flush（约 1.5s 或 20 条）。启动时主进程同步活动 TTS 引擎为 `settings.ttsEngine`。默认 `windowAlwaysOnTop=false`。

## 断点恢复（autoResume）

1. **启动**：`lastReadAt` 最近且未完成、进度>0 → `handleOpenBook`（`autoResumedRef` 一次）
2. **书架「继续阅读」**：全部书籍视图顶部卡片
3. **历史**：`HistoryView` 跳到 `endSentenceIndex`

`AppSettings.autoResume` 默认 true；`=== false` 才关闭。

## 测试（`npm test`）

`scripts/run-tests.mjs` 串行跑 `tests/*.test.ts`，**单文件失败不短路后续**。单文件：`npm run test:one -- tests/foo.test.ts`。

清洗/数据：`textPreprocessor`、`bookData`、`bookStore`、`albumUtils`  
解析/结构：`parserCompatibility`、`epubParserStructure`、`mdParserStructure`、`structureBuilder`、`structureVersionMismatch`、`chapterBuilderModes`  
布局/分章：`healBookLayout`、`regroupSingleChapter`  
阅读 UI：`readerComponents`、`contextMenuComponents`、`modeSwitchPlayback`、`chapterTitleEditing`  
AI/RAG：`llmCaller`、`ipcStreaming`、`settingsDeepMerge`、`aiHistory`、`aiStore`、`aiComponents`、`aiSettingsPanel`、`nmemBridge`、`nmemContract`、`spoilerFilter`、`ragOrchestration`、`ragComponents`、`selectionQuoteComponents`、`fullTextInject`、`vectorStore`  
大纲：`outlineGenerator`、`outlineRepository`、`outlineQueue`、`outlineIntegration`、`outlineIpc`  
ingest：`ingestWholeBook`  
TTS：`ttsSkip`、`ttsSession`、`engineImport`  
安全/校验：`safeOpenExternal`、`ipcValidate`

改清洗/分句后务必 `npm test`；改 IPC 后 `npm run typecheck`。

## 安全与 IPC 注意

- `shell.openExternal` 仅允许 `http:`/`https:`（`electron/utils/safeOpenExternal.ts`）
- 关键书/删书 ID 走 `isBookId`；settings 保存要求 plain object
- 设置导出/导入：`settings:export` / `settings:import`（**含 API Key**，不切换 dataDir）

## 当前状态与边界

- 在线 Edge/千问/HTTP + 系统 Web Speech 临时兜底；引擎管理与导入导出可用
- 清洗纯规则；音量 0~200%；封面 `COVER_STYLE_VERSION=v2-light`
- AI 阅读 A–F、共享右键菜单、连续阅读排版、章节标题去重、全局 focus-visible 已完成
- 大纲按当前章按需生成，缓存 **v4**；`ChapterOutlinePanel` 为唯一大纲 UI（旧 `ChapterOutline`/`SectionNav` 已删）
- TTS 内存预取缓存 LRU 上限 50 句；听书大章仅渲染当前句附近窗口
- 知识库 **整本**同步（非按章）；源名 `书名 [bookId=id]`（`parseSourceMetadata` 同时兼容旧前缀格式）；nmem 默认 `127.0.0.1:14242`
- 本地向量检索：双源 nmem‖local 并行 → **RRF 融合**（不比绝对分数，只比排名）；本地有进程内缓存、章节过滤、相对分数阈值；embedding 模型/维度变更须重建知识库（`VectorCompatError`）
- Electron 主进程 `fetch` 不读代理环境变量；检测到代理时模型请求走 axios（见 `llm-caller.ts`）
- 智谱旧别名 `GLM-4.7-Flash` → 请求层映射 `glm-4.7`
- MOBI 依赖本机 Calibre；**PDF 仅文字层**（扫描版需 OCR，导入会提示）；不要把书籍/API Key/日志/缓存提交 Git
