# 听伴 (TingEar) — 项目上下文

> 更新日期: 2026-07-22 | 功能集: v3.7 | ~90 源码文件
>
> 开发者向文档：文件索引 + 数据流 + 设计速查 + 坑点 + 修改指南。所有行号/函数均经实际代码核对。
> 用户向说明见 `README.md`。原 `DESIGN.md` / `OPTIMIZATION_SUMMARY.md` / `TEST_CHECKLIST.md` 已合并进本文并删除。

## 一分钟速览

Electron 28 桌面应用，Windows TTS 听书伴侣。左边书架管理 EPUB/TXT/PDF/DOCX/MD/HTML，右边播放器逐句朗读。支持 Edge（免费）、千问（阿里云 API）、系统离线三种 TTS 引擎。截图 OCR 带放大镜和确认工具栏。文本清洗（纯正则规则）+ 手动逐句编辑 + 编辑记录版本管理。LLM 清洗 / AI 审校功能后端代码保留，但 v3.3 起**前端入口已关闭、相关 IPC 未注册**（见"已禁用功能"）。

```
React 18 + TypeScript + Tailwind + Zustand (前端)
Electron 28 + electron-vite 2 (桌面壳)
msedge-tts / 千问 API / Web Speech API (TTS)
mammoth / adm-zip / pdf-parse v1 / iconv-lite (文档解析)
RapidOCR Python 子进程 (OCR)
```

---

## 文件索引表

> 行号基于 2026-07-11 实际代码。`.bak-*` 备份文件与 `.workbuddy/` 不计入。

### 前端组件（渲染进程 src/）

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `src/App.tsx` | `handleOpenBook()` L640（先 `validatePlayPref(loadPlayPref(id))` 校验本书 PlayPref 缓存，有效→跳过预选页直接进播放器；`forceSelector` 强制走预选页）, `handleChapterConfirm()` L596 支持 recordId/activeChapters/range, `activateReadingBook()` L134, `startReadingText()` L195 剪贴板朗读；`onShortcut` 分发全部全局快捷键动作（含 speedUp/Down、volumeUp/Down、resetDefaults，调 `playerStore` + `osdStore.show()`）；L808 渲染 `<SubtitleWindow />`（hash=#/subtitle）+ `<PlayerOSD />` | 改导入流程、书架交互、版本切换、预选页跳过逻辑、全局快捷键分发 |
| `src/components/BookShelf.tsx` | 封面点击换封面, 信息区点击开预选页, 右键菜单(清洗格式) | 改书架交互、右键菜单 |
| `src/components/RangeSelector.tsx` | 两步流程: page 0 编辑记录列表, page 1 章节选择；`mergeSmallChapters` 现从 `utils/bookData` 导入；PlayPref 完整缓存（`loadPlayPref` L43 / `validatePlayPref` L57,L105 / `chaptersInRange` L108 恢复勾选 / `savePlayPref` L136 在 `handleConfirm` L124 写入），按书 id 持久化「合并/版本/范围/句数快照」，下次打开自动沿用 | 改预选页、编辑记录集成、合并/版本/范围偏好记忆 |
| `src/components/TextCleanerView.tsx` | `handleQuickClean()` L123, `handleApply()` L153, `handleUndo()` L243, `handleToggleManual()` L256 初始化句子数组, `handleSentenceEdit()` L275 单句修改, `handleManualSave()` L317 持久化到 editHistory；分句改用 `utils/bookData#splitReadableSentences` | 改清洗流程、手动编辑、撤销、编辑历史 |
| `src/components/EditHistoryDialog.tsx` | 编辑记录翻页浏览器, 三种徽章 L52-59：`ai-clean`(紫)/`manual`(蓝)/`trim-spaces`(绿) | 改编辑记录 UI |
| `src/components/ScreenshotOverlay.tsx` | 镂空选区+放大镜+8点把手+确认工具栏 | **改截图 OCR 交互** |
| `src/components/PlayerView.tsx` | 章节下拉 L361-385（`chapters.map`，越界章节禁用）；**「重选章节」按钮 L390-400**（v3.7：调 `onReselectRange` 重新打开预选页修改范围/版本，下次打开自动沿用）；版本下拉 L402-450（原始/各编辑记录切换，调 `onSelectVersion`）；**书签图标（v3.5）**：未加书签点击→弹出备注输入框（Enter 确定），已加书签点击→`toggleBookmark` L593 直接取消（toast「书签已取消」） | 改播放器版本选择、章节范围重选、书签切换 |
| `src/components/SubtitleWindow.tsx` | `SubtitleWindow()` L13 桌面字幕条（hash=#/subtitle 独立窗口）：上方书名·章节+当前句子，下方播放/暂停/上下句/打开主窗口/关闭，可拖拽拉伸；样式由 `subtitle:setStyle` 控制 | 改桌面字幕窗口 |
| `src/components/SettingsModal.tsx` | 常规/TTS/外观/清洗/**快捷键**/关于 六个 tab（LLM tab 已删, v3.3）；快捷键 tab 遍历 `SHORTCUT_ACTION_LIST` 渲染，键位用 `acceleratorToKeys()` 拆成 kbd chip 展示（v3.4）；点击条目进入捕获态：捕获期间先 `applyShortcuts({})` 停用全部全局键避免误触，结束再恢复。**捕获顺滑交互（v3.5）**：按住修饰键时实时预览（`previewAcc` + `acceleratorPreview`），再次点击正在捕获的条目或 Esc 取消，双击已设置条目清空；捕获态按钮加 `animate-capture` 柔和脉冲动画 + hover 微缩放。**新增引擎 v3.6**：URL 自动检测(`🔍 检测`按钮调用 `tts:probeEngineUrl` 自动推断名称+类型)、音色自动发现(`🔍 自动发现`按钮调用 `tts:discoverVoicesForConfig` 用未保存表单配置探测，不再临时写入 engines.json)、自适应表单(OpenAI兼容/通用HTTP)、一键部署(curl/Python/JSON) | 改设置面板、快捷键捕获、引擎管理 |
| `src/components/CleanRulesSettings.tsx` | 清洗格式正则规则编辑：列表 + 增/删/改 + 校验 + 实时预览 + 诊断（**可编辑测试文本 / 单条匹配次数+未匹配警告 / 「试跑全部规则」逐条追踪：停用·匹配数·改没改**）+ **「从 AI 导入」**（粘贴 AI 返回的 CleanRule JSON，设置页「清洗」tab）| 改清洗规则 UI |
| `prompts/clean-rule-import.md` | 自然语言→规则 JSON 的提示词模板（含 I/O 规范、示例、导入步骤）| 改/扩展 AI 生成规则提示词 |
| `src/cleanRulePrompt.ts` | 内嵌同一份提示词文本，供「从 AI 导入」窗口的「复制提示词」按钮一键复制到剪贴板（与上面 md 保持一致）| 改提示词内容（需同步 md 与常量） |
| `src/components/SideNav.tsx` | 「清洗格式」导航项 | 改导航 |
| `src/components/ControlBar.tsx` | `handleTogglePlay()`；布局=左播放控制(章/句/播放/停止)+弹性留白+右调节区(倍速stepper±0.25/音量stepper±10%/音色/工具)；无书名(桌面字幕已覆盖)；与ProgressBar统一底色`bg-white dark:bg-dark-surface` | 改控制栏 UI、倍速/音量交互 |
| `src/components/ProgressBar.tsx` | `xToTime()` L89, `timeToSentence()` L100 | 改进度跳转 |
| `src/components/VoiceSelector.tsx` | 音色选择 / 试听 | 改音色选择 |
| `src/components/QuickTextPanel.tsx` | 快速文本（OCR 结果落此处） | 改快速文本 |
| `src/components/ErrorBoundary.tsx` | `ErrorBoundary` class | React 错误边界 |
| `src/components/BookmarksView.tsx` | 书签管理 | 改书签 |
| `src/components/HistoryView.tsx` | `fmtTime()` (HH:MM:SS), `handleContinue()` | 改历史恢复、时间格式 |
| `src/components/LogsView.tsx` | 日志展示 | 改日志面板 |
| `src/components/FloatingBall.tsx` | 悬浮球窗口（独立 transparent 窗口） | 改悬浮球 |
| `src/components/TitleBar.tsx` | 自定义标题栏 | 改窗口标题栏 |
| `src/components/Toast.tsx` | Toast 通知 | 改通知样式 |
| `src/components/PlayerOSD.tsx` | 全局快捷键调节倍速/音量时的居中 OSD 反馈（图标+数值+进度条，`osd-enter` 动画，挂在 `App.tsx`）；受 `osdStore` 控制显隐 | 改倍速/音量 OSD 反馈 |

### 前端工具 / 入口

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `src/utils/timeFormat.ts` | `formatFullTime()` → `YYYY-MM-DD HH:MM:SS`, `formatHMS()` → `HH:MM:SS` | 任何需要显示完整时间的组件 |
| `src/utils/bookData.ts` | **核心数据规范化 + PlayPref 缓存**：`splitReadableSentences()` L130（基于 Intl.Segmenter 的中英文分句）, `normalizeChapters()` L148, `buildPseudoChapters()` L174, `mergeSmallChapters()` L189（200~500 句合并）, **PlayPref 缓存（v3.7）**：`PlayPref` 接口 L247（merged/recordId/range/ver）, `loadPlayPref`/`savePlayPref` L260/L270（localStorage 键 `ting-ear-playpref-<bookId>`）, `versionSentenceCount()` L280, `validatePlayPref()` L295（句数变化→作废）, `chaptersInRange()` L308（range 反查章节勾选）, `normalizeSentenceRange()` L316, `clampSentenceIndex()` L327, `findChapterIndex()` L339, `normalizeBookData()` L375（导入书籍规范化入口）, `normalizeBookCollection()` L418 | 改书籍规范化、分句、章节合并、预选页偏好缓存、进度恢复 |
| `src/utils/albumUtils.ts` | `validateAlbums()` L9, `normalizeAlbumTitle()`, `ALBUM_TITLE_MAX_LENGTH=40` | 改专辑数据校验 |
| `src/cleanRules.ts` | `CleanRule` 类型 + `DEFAULT_CLEAN_RULES`（12 条默认规则：去页码 + 半角转全角）| 改清洗规则默认值/类型 |
| `src/shortcuts.ts` | `SHORTCUT_ACTION_LIST` L4（11 动作：播放/停止/上下句/上下章 + 倍速±/音量±/恢复默认）, `DEFAULT_SHORTCUTS` L23（均带 Ctrl+Alt 前缀）, `keyToAccelerator()` L59 捕获转加速器, `acceleratorPreview()` L98 修饰键单独按下时返回已按组合（供实时预览）, `acceleratorToKeys()` L132 加速器→简短键帽文案（Ctrl/Win/←→↑↓/␣ 等，供设置页 kbd chip 展示）| 改快捷键动作/默认键位/键帽展示/捕获预览 |
| `src/utils/coverGenerator.ts` | `generateCoverDataUrl()` 自动生成封面占位图（被 App.tsx 引用） | 改封面占位样式 |
| `src/main.tsx` | React 18 入口 | 改挂载/Provider |

### 前端 Hooks + Store

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `src/hooks/useTTS.ts` | `playSentence()` L163, 预缓存并发池 `PREFETCH_CONCURRENCY=1` L79-89, `playWithSystemTTS()` L334（Web Speech API）, `TTSError` 枚举 | 改 TTS 播放流程、预缓存 |
| `src/hooks/useKeyboard.ts` | `useKeyboard()` 应用内快捷键（窗口聚焦且非输入框时 **仅** Space 播放/暂停 + Esc 停止；**方向键已移除**，`v3.5` 起「上一句/下一句」改由全局快捷键统一接管，避免一次按键同时触发内部与全局两份逻辑）；`useClipboardHotkey()` 仅保留 Ctrl+V 粘贴检测 | 改快捷键 |
| `src/stores/playerStore.ts` | `ttsEngine: 'edge'` 默认 L60, `timeMap` 真实时长缓存 L30/L94 `updateTimeMapEntry`；导出 `SPEED_MIN=0.5` L113 /`SPEED_MAX=3.0`/`SPEED_STEP=0.1`(v3.5 由 0.25 调细)、`VOLUME_STEP=0.05` L117、`DEFAULT_SPEED/VOLUME` 常量；`setVolume` 音量归 0 自动静音、回升取消静音，并即时写到正在播放的 audio | 改播放器状态、倍速/音量范围 |
| `src/stores/albumStore.ts` | `useAlbumStore` 自定义专辑 CRUD：`loadAlbums`/`createAlbum`/`renameAlbum`/`deleteAlbum`/`addItem`/`removeItem`/`moveItem`/`persistAlbums`，走 `album:load`/`album:save` IPC | 改专辑（自定义合集） |
| `src/stores/bookStore.ts` | `setCurrentView` L208（含 `'textclean'`）, `updateBook()` L80 auto-persist, `updateBookAndPersist()` L90, `persistBooks()` L55 | 改书籍管理 |
| `src/stores/settingsStore.ts` | `llmConfigs` 预设, `cleanPrompt`, `setSettings()` 自动 `saveSettings()` L115 | 改设置持久化 |
| `src/stores/textCleanStore.ts` | `openBookAfterApply` 应用后自动开预选页 | 改清洗流程 |
| `src/stores/quickTextStore.ts` | 快速文本 | 改剪贴板文本 |
| `src/stores/bookmarkStore.ts` | 书签 CRUD；`toggleBookmark()`（v3.5 新增）按 bookId+sentenceIndex 定位，有则删、无则加，供播放器书签图标「再点取消」 | 改书签 |
| `src/stores/historyStore.ts` | 收听历史 | 改历史 |
| `src/stores/logStore.ts` | 日志管理 | 改日志 |
| `src/stores/floatingBallStore.ts` | 悬浮球状态 | 改悬浮球 |
| `src/stores/osdStore.ts` | `show(kind: 'speed'\|'volume'\|'reset')` 触发居中 OSD，1.2s 自动隐藏（`PlayerOSD` 消费）| 改倍速/音量 OSD 显隐 |
| `src/global.d.ts` | `EditRecord.type` = `'trim-spaces' \| 'ai-clean' \| 'manual'`, `LLMConfig`, `BookData.editHistory`, `AppSettings.llmConfigs/cleanPrompt` | 查类型、加新 API |

### Electron 主进程

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `electron/main.ts` | `registerTextCleanHandlers()` 调用 L214（统一注册各 ipc handler，含 window/bookmark/log/history/floatingBall/subtitle）；`registerCustomShortcuts()` L157 / `registerGlobalHotkeys()` L180 现只注册播放器自定义全局快捷键，`shortcuts:update` IPC 运行时改键；Ctrl+Shift+R 选中朗读全局热键 + `clipboard:read` 已于 v3.4 移除 | 改启动流程、加 IPC、全局快捷键 |
| `electron/preload.ts` | 所有 `on*` listener 均返回 cleanup 函数；审校 API（`reviewWithLLM` 等）已置 `null`（L351-354）；`onReadSelected`/`readClipboardText` 已于 v3.4 移除；v3.6 新增 `ttsDiscoverVoices`/`ttsProbeEngineUrl` 桥接；`loadAlbums`/`saveAlbums` 专辑桥接 | 加新 IPC API |

### IPC Handlers（`electron/ipc/`）

| 文件 | 注册的核心 channel | 何时读 |
|------|------|--------|
| `fileHandlers.ts` | `file:import` L95, `album:save` L234 / `album:load` L245（自定义专辑持久化）, `book:reprocess` L342, `export:audio` L498, `saveJsonFile`/`loadJsonFile` | 改导入/导出、专辑存储 |
| `ttsHandlers.ts` | `tts:synthesize` L11, `tts:previewVoice` L51, `tts:discoverVoices` L120 / `tts:discoverVoicesForConfig` L125 / `tts:probeEngineUrl` L130（v3.6）, `tts:importEngine` L135；`tts:synthesize`/`tts:previewVoice` 都会写应用日志（成功/失败/异常，含 engineId/voice/audioFormat），便于排查“连接成功但合成失败”；`tts:importEngine` 捕获异常并返回业务错误，避免前端只显示“部署请求失败” | 改 TTS IPC |
| `subtitleHandlers.ts` | `registerSubtitleHandlers()` L261；`subtitle:show`/`hide`/`toggle` L263-265, `subtitle:getStyle`/`setStyle` L275-276, `subtitle:showContextMenu` L279, `subtitle:play/pause/prev/next` L284+ 转发到主窗口 | 改桌面字幕窗口 IPC |
| `textCleanHandlers.ts` | `text:cleanWithLLM` L23（后端保留但 UI 不调用）, `text:enhancedClean` L97（纯正则清洗） | 改文本清洗 IPC |
| `ocrHandlers.ts` | `show:false` L91 + `ready-to-show` L99 消除黑屏, `ScreenshotOverlay` | 改截图 OCR |
| `floatingBallHandlers.ts` | `createFloatingBallWindow()` | 改悬浮球 |
| `windowHandlers.ts` | 窗口控制 | 改窗口 |
| `bookmarkHandlers.ts` | 书签读写 | 改书签 |
| `logHandlers.ts` | 日志读写 | 改日志 |
| `historyHandlers.ts` | 历史读写 | 改历史 |

> 注：旧文档提到的 `llm:testConnection` **当前不存在**（主进程未注册，仅 `.bak` 备份里有）。`text:cleanProgress` / `text:cleanComplete` 事件仍在 `text:cleanWithLLM` 流程中使用。

### 服务（`electron/services/`）

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `settings-service.ts` | LLM 默认配置, `mergeLlmConfigs()`, `getCleanPrompt()` | 改默认配置 |
| `text-cleaner.ts` | `cleanTextWithLLM()` L220（已退化为只跑 `enhancedClean` 正则，不真正调 LLM）, `DEFAULT_CLEAN_PROMPT` L17 | 改文本清洗核心（后端保留） |
| `text-reviewer.ts` | `reviewTextWithLLM()` L121, `DEFAULT_REVIEW_PROMPT` L50, `ReviewIssue` 类型 L18 — **AI 审校服务，当前未接入任何 IPC（已禁用）** | 改审校逻辑（如需恢复） |
| `log-service.ts` | `LogService` 类 | 改日志 |
| `llm/adapter.ts` | `ILLMAdapter`, `LLMConfig`, `LLM_PRESETS`(3预设) | 改 LLM 接口（后端保留） |
| `llm/ollama-adapter.ts` | Ollama `POST /api/chat` | 改 Ollama 适配（后端保留） |
| `llm/openai-adapter.ts` | OpenAI 兼容 `POST /v1/chat/completions` | 改云端适配（后端保留） |
| `llm/adapter-factory.ts` | `createAdapter()` | 改适配器工厂（后端保留） |

### TTS 引擎（`electron/services/tts-engines/`）

| 文件 | 核心函数+行号 | 何时读 |
|------|-------------|--------|
| `engine-manager.ts` | `synthesize()` L109（不回退）, `init()` L60 为自定义引擎注册 `HttpAdapter`, `addCustomEngine()`/`deleteCustomEngine()` 同步维护适配器, `discoverVoices()` L224 / `discoverVoicesForConfig()` L258 / `probeEngineUrl()` L690 自动发现音色和探测引擎类型；`importEngine()` L306 支持 curl/Python/JSON，一键部署会校验 URL、保留 response/voices 字段、把常见示例 body 归一为 `{text}`/`{voice}` 模板，并返回业务错误而不是抛出 IPC 异常；支持 `/v1/chat/completions` + `audio.voice` 形态，自动生成下拉音色并推断 `choices.0.message.audio.data`；识别 `xiaomimimo.com` / `mimo-*` 模型时自动合并 MiMo 预置音色，老配置无需重导入 | 改引擎调度、新增自定义引擎、一键部署 |
| `http-adapter.ts` | **v3.6 新增** 通用 HTTP TTS 适配器；支持 OpenAI 兼容(`POST /v1/audio/speech`)和通用 HTTP(可配置 `requestTemplate`/`responseAudioField`/`responseFormat`); 合成时递归替换 `{text}`/`{voice}`/`{speed}` 模板; 自动从 requestTemplate 推断 `audio.format`（mp3/wav）并返回正确 `audioFormat`，小米 MiMo `audio.format: "wav"` 不再被误标成 mp3；HTTP 错误会带状态码和响应片段; `discoverVoices()` 自动探测 Kokoro/OpenAI 等已知音色端点，按输入 URL 推导 origin/v1/api/v1 候选路径；厂商预置音色统一走 `provider-voices.ts` | 改自定义引擎合成、音色自动发现、日志 |
| `provider-voices.ts` | 厂商音色预置注册表：`PROVIDER_VOICE_PRESETS` 按 `apiUrl` / `requestTemplate.model` / `type` 匹配，当前内置 OpenAI 与小米 MiMo；导出 `getProviderVoices()` + `mergeVoices()` 供 import/discover/getEngines 统一自动合并。未来新增厂商只加 preset，不改业务链路 | 改厂商音色预置、自动注入 |
| `adapter.ts` | `TTSEngineConfig`/`TTSVoice` 类型定义 | 改 TTS 类型 |
| `edge-adapter.ts` | voice 白名单校验 `EDGE_VOICES.some` L110（无效回退 XiaoxiaoNeural）, 超时 8s + 重试 L133/L147 | 改 Edge TTS |
| `qwen-adapter.ts` | voice 白名单校验 `QWEN_VOICES.some` L74（无效回退 Cherry）, `synthesize()` | 改千问 TTS |

### 文档解析器（`electron/services/parsers/`）

| 文件 | 导出函数+行号 | 何时读 |
|------|---------|--------|
| `txtParser.ts` | `parseTxt()` L66 | 改 TXT 解析 |
| `epubParser.ts` | `parseEpub()` L151, `extractCover()` 4级策略提取内嵌封面(meta[name=cover]→properties=cover-image→id/href含cover→常见文件名) | 改 EPUB 解析、封面提取 |
| `pdfParser.ts` | `parsePdf()` L18 | 改 PDF 解析 |
| `docxParser.ts` | `parseDocx()` L13 | 改 DOCX 解析 |
| `mdParser.ts` | `parseMarkdown()` L47 | 改 MD 解析 |
| `htmlParser.ts` | `parseHtml()` L22 | 改 HTML 解析 |
| `textPreprocessor.ts` | `applyRegexRules()` L300 + `enhancedClean(raw, rules?)` L330（应用用户规则，结构性清洗仍始终执行）, `preprocessText()` L207, `splitSentences()` L354 | 改预处理、清洗正则 |

> `electron/types/` 目录**存在但为空**（0 文件）；全局类型集中在 `src/global.d.ts`。
> `electron/ocr/rapidocr_runner.py`：`main()` 入口，RapidOCR 子进程。

---

## 数据库 Schema

无数据库。JSON 文件存储在 `%APPDATA%/ting-ear/听伴/`：

| 文件 | 内容 | 关键字段 |
|------|------|-------------|
| `books.json` | `BookData[]` | `editHistory: EditRecord[]`（manual/trim-spaces/ai-clean）、`timeMap: number[]` 真实音频时长缓存 |
| `settings.json` | `AppSettings` | `activeLlmId, llmConfigs[], cleanPrompt`（LLM 配置保留，UI 不可见）；`ttsEngine: string` v3.6 起支持自定义引擎 ID |
| `engines.json` | `TTSEngineConfig[]` | **v3.6** 自定义引擎配置（id/name/type/apiUrl/apiKey/voices/requestTemplate/responseAudioField/responseFormat 等） |
| `logs.json` | 平台日志 | 最多 5000 条，超出自动裁剪 |

---

## 核心数据流

### 预选页两步流程（v3.7 加 PlayPref 缓存）

```
点击书 → App.handleOpenBook(L640):
  validatePlayPref(loadPlayPref(bookId))
   ├─ 缓存有效（版本句数未变 + 范围合法）→ 跳过预选页，
   │   按缓存的 merged/recordId/range 直接 handleChapterConfirm 进播放器
   └─ 缓存无效 / forceSelector → RangeSelector:
       ┌─ 缓存仍部分有效 → 自动恢复版本(L57)/合并(L97)/勾选(chaptersInRange L108)
       └─ 完全无缓存 → 默认最新编辑记录 + 不合并

RangeSelector step 0:
  ┌─ 编辑记录列表（radio 单选）
  │   原始版本 · 清洗 · 手动编辑
  │   [取消]  [下一页 →]
  └─ 点下一页 → step 1:
  ┌─ 章节选择（选处理版本→自动生成伪章节）
  │   [合并章节]  [全选]
  │   [← 上一页]  [开始阅读]
  └─ → handleConfirm(L124): savePlayPref 写入 {merged,recordId,range,ver}
       → onConfirm(range, chapters, recordId) → handleChapterConfirm
       → 用 record.sentences 替换 book.sentences → 进播放器

播放器「重选章节」按钮(PlayerView L390) → onReselectRange → 重新打开预选页
```
注：PlayPref 缓存按书 id 持久化（`localStorage` 键 `ting-ear-playpref-<bookId>`），记录「合并/版本/范围/句数快照(ver)」；只要所选版本句数变了（如刚清洗完）`validatePlayPref` 就作废缓存，重新走预选页。

### 文本清洗流程（v3.3 现状）

```
书架右键 → 清洗格式 → TextCleanerView
  左栏: 原始文本（只读）
  右栏: 清洗结果（逐句编号卡片）
  工具栏: [快速清洗] [手动编辑] [撤销(Ctrl+Z)] [应用(A→book.editHistory)]

快速清洗(handleQuickClean L93):
  enhancedClean (textPreprocessor L262) → regex 去页码/页眉/空格/合断行 → setCleanedText
  （对应 IPC text:enhancedClean，纯正则秒出，不调 LLM）

手动编辑(handleToggleManual L214):
  进入: splitSentences → manualSentences[] → 每句卡片变 textarea
  工具栏: [保存] [编辑历史]
  单句改: handleSentenceEdit(index, val) → 实时更新 manualSentences
  保存: handleManualSave() → join → setCleanedText → 写 book.editHistory(type='manual')
  编辑历史: 过滤 book.editHistory 中的 manual 记录 → EditHistoryDialog

应用(handleApply L120): saveProgress → editHistory 追加 → 自动返回书架预选页
撤销(Ctrl+Z L201): undoStack pop → setCleanedText
```

### 截图 OCR 流程

```
点击截图 → desktopCapturer 截屏 → 缓存 globalThis
  → new BrowserWindow(show:false, bg:#000) → loadURL
  → ready-to-show(L99) → show() ← 无白屏
  → ScreenshotOverlay: 镂空选区(4块蒙版) + 放大镜(3x) + 十字准星
  → 拖拽框选 → 松手 → 确认模式: 8点把手 + ✓✗工具栏
  → ✓ → submitOcrSelection → RapidOCR → ocr:result → 快速文本
```

### TTS 预缓存流程

```
playSentence → 播放当前句 → prefetchQueue 预取后续5句
  → 并发池=1 (PREFETCH_CONCURRENCY=1, 避免 Edge TTS WebSocket 雪崩超时)
  → edge-adapter: voice白名单校验 + 8s 超时重试(1次)
  → 缓存 MD5 磁盘(10天) → 切句命中秒出
```

### 全局快捷键流程（v3.4）

```
启动 main.ts registerGlobalHotkeys()
  → registerCustomShortcuts(已持久化 settings.shortcuts)
  → 触发 → webContents.send → App.tsx onShortcut(action)

onShortcut 分发（App.tsx）:
  toggle/stop/prev*·next* → 播放控制
  speedUp/Down  → playerStore.setSpeed(±0.25，钳 0.5~3.0x) + osdStore.show('speed')
  volumeUp/Down → playerStore.setVolume(±0.05，钳 0~1；0 自动静音) + osd.show('volume')
  resetDefaults → setSpeed(1.0)+setVolume(0.8) + osd.show('reset')

设置页改键: 捕获前 applyShortcuts({}) 停用全部 → 捕获 keyToAccelerator → 保存
  → shortcuts:update IPC → 主进程重注册；捕获结束按当前设置恢复
顺滑捕获交互(v3.5): 按住修饰键即实时预览已按组合(acceleratorPreview)；再次点击 / Esc 取消；
  双击已设置条目清空；捕获态按钮 animate-capture 脉冲 + hover 微缩放
反馈: PlayerOSD 居中浮层显示 1.25x / 75%，进度条按比例，1.2s 自动隐藏
```
注：倍速在合成时烘焙进音频，改倍速对下一句生效（store/OSD 即时更新）；音量即时生效（直接写正在播放的 audio.volume）。

### timeMap 持久化（进度条时间估算）

```
播放音频 → audio.onended 记录真实时长
  ↓
playerStore.updateTimeMapEntry(index, durationMs)  (L84)
  ↓
异步触发 bookStore.updateBook({ ...book, timeMap })  (L54)
  ↓
持久化到 %APPDATA%/ting-ear/听伴/books.json
```
时间估算公式：`(中文字数 × 250ms + 标点 × 150ms + 其他 × 100ms) / 语速`，进度条精度约 ±15%。已播放段落显示 "● 实时" 标记。

---

## 设计系统速查（源自 DESIGN.md，设计令牌以 `tailwind.config.js` 为准）

- **主色** `#3B82F6`（按钮/链接/高亮/进度条），hover `rgba(59,130,246,0.9)`。
- **亮色**：canvas `#FFFFFF`、surface `#F9FAFB`、border `#E5E7EB`、text `#1F2937`/`#6B7280`、句子高亮 `#FFF3CD`。
- **深色**：canvas `#1F2937`、surface `#374151`、text `#F3F4F6`/`#D1D5DB`、高亮 `rgba(253,224,71,0.15)`。
- **语义色**：success `#10B981`、warning `#F59E0B`、error `#EF4444`、info `#3B82F6`。
- **字体**：`"Microsoft YaHei", "PingFang SC", sans-serif`。
- **字号**：title 20/600、body 16/400（行高1.8）、body-sm 14、caption 12、micro 10。
- **圆角**：button 8 / card 12 / input 8 / pill 9999。
- **固定尺寸**：控制栏 64px(`h-16`)、侧导航 64px(`w-16`)、播放键 48px、悬浮球 260×56 / mini 320×140。
- **Tailwind 约定**：所有颜色用 `dark:` 变体；自定义色 `dark-bg`/`dark-surface`/`dark-border`（在 tailwind.config.js 定义）；勿硬编码颜色（悬浮球、截图选区除外，它们用内联 style + 独立透明窗口）。`tailwind.config.js` 另含 `animate-capture`（capture-pulse 柔和脉冲，蓝环扩散，1.4s，用于快捷键捕获态按钮）。

---

## 已禁用功能（v3.3 起）

LLM 清洗 UI 与 AI 审校在 v3.3 关闭入口，相关代码**保留但未接线**：

- 前端：`SettingsModal` 已删除 LLM tab；`TextCleanerView` 未暴露审校/AI 按钮。
- IPC：仅 `text:cleanWithLLM`（保留）与 `text:enhancedClean`（纯正则）注册；无 `llm:testConnection`、无 `*review*` channel。
- 后端：`text-cleaner.ts#cleanTextWithLLM` 已退化为只跑 `enhancedClean`；`text-reviewer.ts#reviewTextWithLLM` 存在但**无调用方**；`preload.ts` 审校 API 全部置 `null`（L234-238）。
- `settings.json` 仍保留 `llmConfigs` / `cleanPrompt`，供将来恢复使用。

---

## 当前状态（2026-07-22）

- **已完成（v3.7）**：PlayPref 预选页偏好缓存（按书记忆合并/版本/范围，句数变化自动作废）+ 缓存有效时跳过预选页直达播放器；播放器「重选章节」按钮；桌面字幕窗口（SubtitleWindow + subtitleHandlers）；自定义专辑（albumStore + album:load/save IPC）；桌面启动器 `启动听伴.vbs`（隐藏黑窗）。
- **已完成（v3.6）**：自定义 TTS 引擎（HttpAdapter：OpenAI 兼容 + 通用 HTTP）、一键部署（curl/Python/JSON）、URL 类型探测、音色自动发现、厂商音色预置（OpenAI/MiMo）。
- **正在做**：无活跃任务（功能稳定期）。
- **近期调整**：ControlBar 排版优化（去书名、slider→stepper、统一底色、弹性布局）；EPUB 导入自动提取内嵌封面（优先于生成封面）。
- **下一步候选**：恢复 LLM 清洗 / AI 审校前端入口（后端已就绪，见「常见修改指南 §3」）。

---

## 所有坑点

| # | 严重度 | 位置 | 表现 | 根因 |
|---|--------|------|------|------|
| **25** | **已修** | `edge-adapter.ts` | Edge TTS 被喂千问音色名 Cherry→msedge-tts 报错 | 默认配置 voiceId/ttsEngine 跨引擎不匹配。已加白名单校验 |
| **26** | **已修** | `edge-adapter.ts` | 并发请求导致超时雪崩 | 预取并发池=1 + 超时重试 |
| **27** | **已修** | `preload.ts` 全部 listener | MaxListenersExceeded 警告 | onXxx 不返回 cleanup，React re-render 叠加监听器 |
| **28** | **已修** | `settingsStore.ts` | setSettings 改完不存盘 | setSettings 只改 Zustand 不写磁盘。已加 auto saveSettings |
| **29** | **已修** | `RangeSelector.tsx` | 点取消却跳播放器 | onCancel 错误调用 handleChapterConfirm |
| **30** | **已修** | `ocrHandlers.ts` | 截图黑屏闪烁 | BrowserWindow show:true 先于页面就绪。改 show:false+ready-to-show |
| **31** | **已修** | `ScreenshotOverlay.tsx` | 全屏半透明蒙版看不清选区 | 改为4块镂空蒙版+放大镜+8点把手+✓✗工具栏 |
| **32** | **已修** | `ScreenshotOverlay.tsx` | 点 ✓✗ 按钮选区消失 | 工具栏按钮无 stopPropagation |
| **33** | **已修** | `preload.ts` | 构建报错 "Expected '{' but found '=>'" | 审校 API stub 后有孤立 `return () => {...}` 残留。已删 (2026-07-07) |
| **34** | **已修** | `SettingsModal.tsx` | 改快捷键刚按下 Ctrl 就触发暂停/播放 | 捕获期间已注册的全局键仍生效。进入捕获先 `applyShortcuts({})` 停用、结束再恢复 (v3.4) |
| **35** | **已修** | `useKeyboard.ts` | 单独方向键就跳句；按 Ctrl+方向键一次跳两句 | 内部方向键导航未清，且与全局快捷键（Ctrl+方向键）叠加触发。v3.5 起内部仅保留 Space/Esc，方向键导航统一交给全局快捷键 |
| **36** | **已修** | `SettingsModal.tsx` + `engine-manager.ts` | 新增自定义引擎无法合成音频 | `addCustomEngine()` 只存 JSON 不注册适配器; `VoiceSelector` 硬编码 safeEngineId 只认 edge/qwen/system。v3.6 新增 `HttpAdapter` 通用适配器(OpenAI兼容+HTTP)，`EngineManager.init()` 启动时为自定义引擎注册适配器，`addCustomEngine`/`deleteCustomEngine` 同步维护 |
| **37** | **已修** | `SettingsModal.tsx` + `ttsHandlers.ts` + `engine-manager.ts` | 一键部署常显示“部署请求失败”，或导入成功后通用 HTTP 配置不完整 | IPC 未兜底异常；成功提示里 `fmt` 自引用导致 typecheck 失败；curl `-d 'JSON'` 正则会被 JSON 内部双引号截断；JSON 导入忽略 `responseFormat`/`responseAudioField`/`voices`。已补异常边界、URL/类型校验、字段保留、curl body 提取、模板归一和 `tests/engineImport.test.ts` |
| **38** | **已修** | `engine-manager.ts` + `VoiceSelector.tsx` | 导入 `/v1/chat/completions` TTS curl 后，音色下拉里找不到 `Chloe` | `VoiceSelector` 只展示 `voices.length > 0` 的引擎；导入器只识别顶层 voice，未从嵌套 `audio.voice` 生成音色。已从原始 body 提取嵌套 voice，保留风格提示词，只把 assistant 示例文本归一为 `{text}`，并为 chat-completions 推断 base64 响应字段 |
| **39** | **已修** | `SettingsModal.tsx` + `ttsHandlers.ts` + `http-adapter.ts` | 手动新增引擎里点“自动发现”经常失败，失败时还可能留下临时引擎 | 前端为探测音色先写入临时引擎再删除；后端只按已保存 engineId 探测；完整 endpoint 会拼出错误 voices URL；OpenAI 兼容类型未回退内置音色。已新增 `tts:discoverVoicesForConfig`，直接用未保存表单配置探测，扩展 URL 候选路径并保留发现到的音色元数据 |
| **40** | **已修** | `http-adapter.ts` + `VoiceSelector.tsx` + `ttsHandlers.ts` | 小米 MiMo TTS 前台有音色但试听/合成不成功，日志里看不到失败历史 | MiMo 非流式 TTS 返回 `choices[0].message.audio.data` 的 base64 `wav`，但通用 HTTP 适配器固定返回 `audioFormat: 'mp3'`，试听组件也固定用 `audio/mp3`；试听 IPC 没写 LogService。已按 requestTemplate/音频头推断 wav/mp3，试听使用动态 MIME，合成/试听失败写应用日志 |
| **41** | **已修** | `provider-voices.ts` + `engine-manager.ts` + `http-adapter.ts` | 厂商音色要靠人工手动补，换机器/重导入不可自动化 | 缺少厂商音色预置/自动合并层。已加通用 `PROVIDER_VOICE_PRESETS` 注册表，在导入、获取引擎配置、自动发现音色时统一合并；当前内置 OpenAI 与小米 MiMo，未来新增厂商只加 preset |

---

## 常见修改指南

### 1. 修改清洗规则（正则）

- 用户可在「设置 → 清洗」(`CleanRulesSettings.tsx`) 可视化增/删/改正则规则，含合法性校验与实时预览；保存即写入 `settings.json` 的 `cleanRules`，前端无感、即时生效。
- 规则模型：`CleanRule { id, name, pattern, replacement, flags, enabled }`，默认值在 `src/cleanRules.ts#DEFAULT_CLEAN_RULES`（复刻原去页码/半角转全角行为）。
- 后端执行：`electron/services/parsers/textPreprocessor.ts#enhancedClean(raw, rules?)` 按序应用规则；合并硬断行、CJK 空格清理、空行压缩、重复页眉等结构性清洗始终开启，不由用户规则控制。改完走 `text:enhancedClean` IPC。
- 自然语言→规则（轻量方案，无内置解析引擎）：用户把大白话丢给外部大模型，配合 `prompts/clean-rule-import.md` 的提示词得到 CleanRule JSON，再在「清洗」tab 点「从 AI 导入」粘贴 JSON 即可。`CleanRulesSettings.tsx#parseImportedRules()` 负责解析/校验（接受单对象 / 数组 / `{rules:[...]}`，逐条校验正则合法性并兜底缺省字段），非法会提示具体第几条。

### 2. 修改编辑记录的时间显示

- 时间格式：`src/utils/timeFormat.ts` → `formatFullTime()`。
- 编辑记录 label：`TextCleanerView.tsx` `handleApply()` L120 / `handleManualSave()` L275。
- 播放器版本下拉：`PlayerView.tsx` L318-365。
- 收听历史秒数：`HistoryView.tsx` `fmtTime()`。

### 3. 恢复 LLM 清洗 / AI 审校

- 后端已基本就绪，无需大改：
  - `text-cleaner.ts#cleanTextWithLLM` 恢复真正调用 LLM（当前仅跑正则）；或在 `textCleanHandlers.ts` 注册 `text:cleanWithLLM` 的进度回调。
  - 审校：`text-reviewer.ts#reviewTextWithLLM` 存在，需在 `textCleanHandlers.ts` 注册 `review*` IPC 并解除 `preload.ts` L234-238 的 `null` 桩。
- 前端：`SettingsModal` 加回 LLM tab + 配置表单；`TextCleanerView` 加回审查按钮/进度条/疑点展示。

### 4. 修改手动编辑的分句逻辑

- `TextCleanerView.tsx` L10 `splitSentences()`（按中英文句末标点分句，与 `textPreprocessor.ts` L278 同名函数共用思路）。左右栏展示与应用共用。

### 5. 修改编辑记录徽章颜色/文案

- `EditHistoryDialog.tsx` L52-59：`ai-clean`(紫)/`manual`(蓝)/`trim-spaces`(绿)。

### 6. 加新的编辑记录类型

- `src/global.d.ts` `EditRecord.type` 联合加新值 → `EditHistoryDialog.tsx` 分支加颜色 → `TextCleanerView.tsx` 对应标记。

### 7. 修改进度条时间估算

- 估算在 `ProgressBar.tsx` / `useTTS.ts`；真实时长由 `playerStore.timeMap` 持久化（`bookStore.updateBook` L54 落盘）。

### 8. 新增/修改全局快捷键动作

- 加动作：`src/global.d.ts` `ShortcutAction` 联合加值 → `src/shortcuts.ts` 的 `SHORTCUT_ACTION_LIST`（label/description）+ `DEFAULT_SHORTCUTS`（默认键位，建议带 Ctrl+Alt 前缀避免系统冲突）→ `App.tsx onShortcut` 加 case。主进程 `registerCustomShortcuts` 遍历列表自动注册，设置页自动列出，无需额外改。
- 改倍速/音量步长范围：`playerStore.ts` 的 `SPEED_MIN/MAX/STEP`、`VOLUME_STEP`、`DEFAULT_*` 常量。
- 改键位展示（键帽文案）：`shortcuts.ts#acceleratorToKeys` 的 `KEY_LABEL_MAP`。
- 改 OSD 反馈样式：`components/PlayerOSD.tsx`（外观/图标/进度条）、`stores/osdStore.ts`（显示时长 `OSD_DURATION`）、`styles/globals.css` 的 `.osd-enter` 动画。

### 9. 修改自定义引擎（v3.6）

- 新增引擎类型：`SettingsModal.tsx` → TTS tab → 引擎管理 → 新增引擎。表单支持自动检测 URL 类型和名称、自动发现音色列表。
- 引擎适配器：`http-adapter.ts` 是通用 HTTP 适配器，支持两种模式：
  - **OpenAI 兼容** (`type: 'openai'`)：`POST /v1/audio/speech` 标准格式，含 13 个内置英文音色
  - **通用 HTTP** (`type: 'http'`)：通过 `requestTemplate`/`responseAudioField`/`responseFormat` 配置
- 一键部署：`engine-manager.ts#importEngine()` 支持粘贴 curl / Python requests / JSON；导入时会归一化常见示例字段为 `{text}`/`{voice}`/`{speed}` 模板，并通过 `ttsHandlers.ts` 返回业务错误，避免 IPC 异常冒泡到前端。对 `/v1/chat/completions` + `audio: { voice }` 的 TTS curl，会从原始 body 自动生成音色列表（例如 `Chloe`），保留 user 风格提示词，把 assistant 示例正文替换为 `{text}`。
- 手动新增引擎的“自动发现”走 `tts:discoverVoicesForConfig`：不写临时引擎、不污染 `engines.json`；`HttpAdapter.buildVoiceEndpoints()` 会从完整 URL 推导 `/v1/voices`、`/v1/audio/voices`、`/api/v1/audio/voices` 等候选。
- 音色自动注入优先级：
  1. 远端 voices 端点：`HttpAdapter.buildVoiceEndpoints()` 尝试 `/v1/voices`、`/v1/audio/voices`、`/api/v1/audio/voices` 等；
  2. 部署配置抽取：`engine-manager.ts#extractVoicesFromTemplate()` 从 curl/JSON/Python body 的 `voice`/`voice_id`/`speaker` 字段抽取；
  3. 厂商预置注册表：`provider-voices.ts#PROVIDER_VOICE_PRESETS` 按 URL/model/type 匹配并合并音色。新增厂商时只扩展这个注册表。
- 音色发现：`discoverVoices()` 自动探测 Kokoro (`/api/v1/audio/voices`)、OpenAI (`/v1/voices`) 等已知端点格式
- 引擎配置持久化：`%APPDATA%/听伴/engines.json`
- 加新引擎入口：`engine-manager.ts#addCustomEngine()` → 同时注册 `HttpAdapter` 实例 → 保存 JSON
- 引擎类型扩展：`adapter.ts#TTSEngineConfig.type` 联合 `'qwen' | 'system' | 'edge' | 'openai' | 'http' | 'local' | 'indextts'`

---

## CLI/API 参考

### 桌面启动器

```
启动听伴.vbs   # 用户日常入口：用 WScript.Shell 以隐藏窗口模式跑 start.bat（无黑窗），
               # 应用退出时控制台自动关闭；要调试日志就直接跑 start.bat
start.bat      # 开发/调试入口：可见控制台，能看到主进程日志
```

### npm scripts

```
npm run dev           # 开发模式（热重载，renderer 固定端口 5191）
npm run build         # 构建
npm run typecheck     # TypeScript 类型检查
npm run lint          # ESLint
npm run format        # Prettier 格式化
npm run package       # 打包 NSIS 安装程序（package:dir 仅目录）
npm test              # 单元测试（textPreprocessor + engineImport，依赖 tsx）
```

### 文本清洗 IPC（后端保留）

```
text:cleanWithLLM({ text, configId })
  → 返回 { success, taskId }
  → 进度事件: text:cleanProgress { taskId, current, total, phase }
  → 完成事件: text:cleanComplete { taskId, cancelled, text, stats }

text:enhancedClean({ text })   # 纯正则清洗，秒出，不调 LLM
  → 返回 { success, text, originalLength, cleanedLength }
```

### 内置 LLM 预设（settings.json 保留，UI 不可见）

| 预设 | 适配器 | 上下文 | 费用 |
|------|--------|--------|------|
| qwen3.5-4b | Ollama | 32K | 免费 |
| deepseek-v4-flash | OpenAI | 1M | 按量 |
| glm-4.5-air | OpenAI | 128K | 按量 |

---

## 配置 / 环境变量

- 数据目录：`%APPDATA%/ting-ear/听伴/`
- 日志目录：同数据目录 `logs.json`（≤5000 条）
- TTS 缓存：`edge_cache/`(MP3)、`qwen_cache/`(WAV)
- 封面图片：`covers/`(PNG)
- Python 环境：需 `python` 在 PATH 中，含 RapidOCR 依赖（仅截图 OCR 需要）

---

## 手动验证清单（要点，源自 TEST_CHECKLIST.md）

- **编译**：`npm run build` 无错；`npm run typecheck` 通过。
- **进度条**：播放 10+ 句，时间显示合理；调语速(0.5x→3.0x)估算同步；已播放段显示 "● 实时"。
- **timeMap 持久化**：播 20 句→关闭→重开同书→已播放段时间精确。
- **拖拽**：播放中拖拽→暂停→松手恢复；暂停时拖拽→松手仍暂停。
- **章节边界**：无章节区域（如序言）显示"全文"而非错误章节名。
- **加载状态**：点击句子/拖拽出现 "加载音频中..." 提示，~500ms 自动消失。
- **错误降级**：错误/缺失 API Key → 清晰提示且自动降级系统离线 TTS。
- **回归**：悬浮球上下章、书签增删、封面自动生成、点击句子自动播放。
- **控制台**：`Ctrl+Shift+I` 无 React / TS / IPC 报错。
