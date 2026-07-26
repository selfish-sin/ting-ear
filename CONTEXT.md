# 听伴 (TingEar) CONTEXT

> 最近核对：2026-07-26 | AI 阅读一期切片 A-F 已实现；书架与正文共享右键菜单、连续阅读排版、章节标题去重和全局键盘焦点已接入

## 一分钟速览

Windows Electron AI 阅读器：导入 EPUB/TXT/PDF/DOCX/MD/HTML，默认显示结构化正文卡片并提供带来源的书内 AI 问答，也可切换到逐句 TTS 听书；另有进度/书签/历史持久化、文本清理、OCR、浮动球和独立字幕窗口。渲染层是 React + TypeScript + Zustand + Tailwind，主进程负责 IPC、文件、RAG 编排和 TTS 引擎。

## 文件索引

| 文件 | 核心内容 | 何时读 |
|---|---|---|
| `src/App.tsx` | 视图路由、按 `readerMode` 切换 AI 阅读/听书、沉浸状态、`fixed` 沉浸悬浮按钮、底栏显隐 | 改全局布局/阅读模式入口/沉浸开关 |
| `src/components/PlayerView.tsx` | 听书模式的选章、句子列表、模式切换和顶栏工具；沉浸时顶栏上移 | 改传统听书正文 UI |
| `src/components/BookShelf.tsx` | 书架网格/列表、书籍更多操作入口、共享右键菜单命令分组、专辑与批量操作 | 改书架布局、书籍菜单或专辑操作 |
| `src/components/ui/ContextMenu.tsx` | Portal 右键菜单；视口钳制、长菜单滚动、分组语义、键盘导航、关闭与焦点恢复 | 新增/修改右键菜单或溢出菜单时先读 |
| `src/components/reader/AiReaderView.tsx` | AI 阅读页容器；章节大纲、连续正文、真实 AI 助手三栏布局；沉浸时稳定挂载并隐藏助手；旧书结构 fallback | 改 AI 阅读页布局、沉浸生命周期或旧书显示 |
| `src/components/reader/ContentCards.tsx` / `ContentCard.tsx` | 章节标题去重、正文右键动作、当前块自动滚动、连续段落与特殊 block 样式、当前句/raw 朗读高亮 | 改正文排版、标题、右键动作、高亮、滚动或朗读 |
| `src/components/reader/ChapterOutline.tsx` / `ModeSwitch.tsx` | 可折叠章节导航；`AI 阅读` / `听书` 分段切换 | 改章节导航或模式切换控件 |
| `src/components/ai/AiChatPanel.tsx` / `ChatMessages.tsx` / `ChatInput.tsx` | AI 侧栏、Markdown 消息、流式光标、来源标注、引用卡片、持久 focus request、输入/发送/停止和清空历史 | 改 AI 对话交互、聚焦或消息渲染 |
| `src/components/ai/SelectionPopup.tsx` / `QuoteChips.tsx` | 阅读/听书共用的选区浮动条；最多 5 条可移除的组合引用；问 AI 请求展开并聚焦侧栏 | 改选中文本操作或引用附件 UI |
| `src/components/ai/NmemBanner.tsx` / `RetrievalCard.tsx` / `CitationPopover.tsx` | 知识库离线提示、检索状态、来源原文弹层和正文定位 | 改 RAG 状态或引用交互 |
| `src/components/settings/AiSettingsPanel.tsx` / `src/aiSettings.ts` | 模型、nmem、检索与对话配置表单；AI 默认值、四类证据/安全 prompt、路由正则和深合并 | 改 AI 配置项、prompt、问题路由或默认值 |
| `src/components/ControlBar.tsx` | 底栏：左倍速/音量、中播放、右音色/在线离线 | 改播放控制布局 |
| `src/components/TitleBar.tsx` | 无边框窗控 + 主题；沉浸时仅窗控（无沉浸按钮） | 改系统顶栏 |
| `src/hooks/useTTS.ts` | 书籍播放、ttsSkip 导航/预取过滤、唯一 Audio/TTS 引擎、`speakRaw`/`stopRaw`、system TTS 兜底 | 改书籍或片段/回答朗读生命周期 |
| `src/utils/audioOutput.ts` | Web Audio GainNode（latencyHint:'playback'）、复用Audio元素、音量>100% | 改音量增益/音频管线 |
| `src/utils/ttsSkip.ts` / `ttsSession.ts` | ttsSkip 查找/前后导航/预取过滤；书籍与 raw 朗读互斥状态、取消结算和恢复点 | 改跳过规则或 raw TTS 状态机 |
| `src/utils/contentHash.ts` | 同步、跨 Node/浏览器的 SHA-256；句子按换行拼接后取前 16 位 | 改结构一致性哈希 |
| `src/stores/playerStore.ts` / `settingsStore.ts` / `bookStore.ts` | 引擎选择、播放状态、设置、书籍持久化和 `readerMode` | 改状态或默认值 |
| `src/stores/aiStore.ts` | 按书历史、流式回答、来源、nmem 在线状态、停止、错误状态和持久侧栏聚焦请求 | 改 AI 前端状态机 |
| `src/utils/bookData.ts`、`src/shortcuts.ts` | 分句/章节、structure schema/shape/ID/range 校验、接受 structure 后重派生 chapters、pseudo 重建、播放恢复和快捷键 | 改文本数据、结构一致性或快捷键 |
| `src/utils/coverGenerator.ts` | 无封面时生成浅色调封面（`COVER_STYLE_VERSION=v2-light`） | 改默认封面风格 |
| `src/utils/cn.ts` | `clsx` + `tailwind-merge` 的 Tailwind class 合并助手 | 新组件需要条件 class 时读 |
| `src/cleanRules.ts` | 默认清洗正则规则 | 改清洗规则 |
| `electron/main.ts` / `preload.ts` | Electron 启动、`window.api` 和 IPC 注册 | 改主进程或跨层接口 |
| `electron/ipc/aiHandlers.ts` | `ai:chat/cancel/history:*`、`ai:nmem:*` 注册与 sources/chunk 事件桥接 | 改 AI IPC |
| `electron/services/ai/llm-caller.ts` / `ai-service.ts` | OpenAI SSE、200 error envelope/空正文校验、可配置 prompt、问题路由、RAG 编排、来源过滤、备用模型、定向取消；Electron 代理环境下模型请求走 axios，并兼容智谱旧模型别名 | 改 AI 请求、代理、模型别名、prompt、路由、检索或流式行为 |
| `electron/services/ai/nmem-bridge.ts` / `ingest-service.ts` | nmem health/search/ingest HTTP 契约、状态缓存和按章导入 | 改知识库连接或书籍灌入 |
| `electron/services/ai/ai-history.ts` / `ai-config.ts` | `ai-history.json` 原子持久化、可选检索字段与嵌套来源严格校验；主进程 AI 配置入口 | 改 AI 历史或主进程配置 |
| `electron/ipc/ttsHandlers.ts` | `tts:synthesize`、引擎 CRUD、测试、发现和导入导出 | 改 TTS IPC |
| `electron/services/tts-engines/engine-manager.ts` | `EngineManager.init/synthesize` 和适配器选择 | 改引擎调度或错误传播 |
| `electron/services/tts-engines/edge-adapter.ts` / `qwen-adapter.ts` / `http-adapter.ts` | Edge、千问和 OpenAI/通用 HTTP 合成 | 改具体在线引擎 |
| `electron/services/parsers/textPreprocessor.ts` | `enhancedClean` / `preprocessText` 纯规则清洗 | 改导入/清洗流水线 |
| `electron/services/parsers/epubParser.ts` / `mdParser.ts` / `structureBuilder.ts` | EPUB package XML 结构解析与 preserve-order XHTML 遍历、MD 围栏/结构解析、全局 sentences/chapters/range 派生 | 改结构化导入或 block 判定 |
| `electron/services/log-service.ts` / `electron/ipc/logHandlers.ts` | `%APPDATA%/ting-ear/听伴/logs.json` 日志 | 排查 TTS、IPC 和启动问题 |
| `electron/services/parsers/`、`electron/ipc/fileHandlers.ts` | 文档解析、导入、可选 nmem 自动灌入、进度、封面和数据目录 | 改导入/持久化 |
| `electron/ipc/ocrHandlers.ts`、`src/components/ScreenshotOverlay.tsx` | RapidOCR 截图选区（DPI、拖拽） | 改 OCR |

## TTS 调用链与故障含义

```text
useTTS.playSentence
 -> 内存预取缓存命中? → 直接取 base64（跳过 IPC）
 -> 未命中 → window.api.ttsSynthesize(text, voice, speed, volume=1.0, engineId)
    -> ttsHandlers -> EngineManager.synthesize
    -> EdgeAdapter / QwenAdapter / HttpAdapter
 -> base64 → Blob → 复用 Audio 元素（getReusableAudio）+ GainNode
```

合成侧固定 `volume=1.0`（满电平），响度只在渲染层 GainNode 控制。这样：

- 可超过 100%（`VOLUME_MAX=2.0`）
- 磁盘缓存不因用户调音量而失效

**播放性能优化（2026-07-25）：**

- `AudioContext({ latencyHint: 'playback' })`：增大内部 buffer，消除 underrun 导致的颤音/电子音
- `getReusableAudio()`：整个生命周期只创建一次 MediaElementSource，后续只换 `src`，避免频繁创建/销毁音频节点
- 内存预取缓存（`prefetchCache: Map<idx, {audio, format}>`）：预取结果存内存，播放时直接取用跳过 IPC 往返，句间间隙接近 0
- `PREFETCH_CONCURRENCY=2`，预取失败只影响预取项
- base64 解码分块 8KB 处理，减少主线程阻塞尖峰

在线合成/解码失败时，`useTTS` 对当前句调用 `playWithSystemTTS()` 临时兜底，不修改 `settings.ttsEngine`，也不把全局 `useSystemTTS` 锁成 true；下一句继续尝试用户选中的在线引擎。只有用户主动选择系统引擎才进入持久的系统 TTS 模式。系统 TTS 音量钳到 0~1（Web Speech 不支持 >100%）。

`EngineManager` 不在 Edge、千问、自定义 HTTP 之间自动换引擎；适配器原始错误会进入 IPC/日志。排查「莫名跳离线 TTS」时先看 `logs.json` 中 `source=TTS` 的时间、`context.engineId`、voice 和 details，再核对 `settings.json` 的 `ttsEngine/voiceId` 与 `engines.json`。`engineUsed: system` 只表示当前句兜底，不表示设置被改写。

## 文本清洗流水线

已移除内置 LLM 模块（无 `electron/services/llm`、无清洗 AI 评审）。

```text
导入 / 手动清洗
 -> enhancedClean / preprocessText（同一套规则）
 -> removeCJKSpaceGaps → mergeBrokenLines → collapseBlankLines
 → normalizePunctuation → 页码/页眉/竖排清理
 -> splitSentences（最短可读长度约 20 字）
```

设置里若仍有历史 `llmConfigs` / `cleanPrompt` 字段，`settings-service` 读取时丢弃且写回时不保留。规则可视化编辑仍在设置 / 清洗页；AI 生成规则仅支持「粘贴导入」，应用内不再调 LLM。

## 播放器 UI 约定

| 区域 | 内容 |
|---|---|
| TitleBar | 拖拽区 + 主题切换 + 最小化/最大化/关闭；**无 Logo**；沉浸时透明细条仅窗控 |
| 播放器顶栏 | 章节/版本/搜索/字幕等；**不含**沉浸按钮，也不为沉浸预留右侧空位 |
| 沉浸开关 | **仅**在 `App.tsx`：`fixed top-24 right-4 z-[60]` 悬浮胶囊。压在正文区右上（低于 TitleBar ≈32px + 播放器顶栏 ≈40px），不挡顶栏与窗控；进出沉浸同一视口坐标，不随布局上移 |
| ControlBar 左 | 倍速 ±0.1、音量 ±5%（可到 200% 增益显示琥珀色） |
| ControlBar 中 | 上章/上句/**播放**/下句/下章/停止，播放键居中包绕 |
| ControlBar 右 | 音色选择 + 在线/离线切换 |
| 窄屏 | 部分标题隐藏；控件保持可点 |

### 沉浸模式行为

```text
进入：侧栏收起 + 播放器顶栏上移隐藏 + 底栏（进度/控制）下移隐藏
退出：恢复上述 chrome
开关：始终 fixed 悬浮，不嵌 TitleBar / PlayerView 顶栏
离开播放器视图：自动退出沉浸（App useEffect）
快捷键：沉浸中仍可控制播放
```

改开关位置时只改 `App.tsx` 的 `fixed top-* right-*`，勿再塞回顶栏。

## AI 阅读页（切片 B、F）

打开一本书时，`bookStore.setCurrentBook` 会把 `readerMode` 重置为 `ai-reading`；模式切换只改阅读器视图，不重置 `playerStore` 的播放状态或当前句索引。`App.tsx` 根据该状态渲染 `AiReaderView` 或原有 `PlayerView`，底部进度与播放控制继续共用。

AI 阅读页在大屏显示三栏：左侧可折叠章节大纲、中间结构化正文、右侧 AI 助手；`md` 宽度起显示 AI 面板，面板宽度按视口钳制并支持拖拽/折叠。普通段落和列表采用无外框的连续阅读排版，当前块只显示浅色底与左侧标记；引用、代码、脚注和尾注保留独立语义表面。当前播放块与当前句分别高亮，并在句子变化时自动滚动到当前块。沉浸模式隐藏大纲、页头和 AI 面板，只保留正文；AI 面板保留稳定挂载，切换沉浸不会取消正在生成的回答。

`ContentCards` 在首个有内容的 block 不是与 `chapter.title` 等价的 heading 时渲染章节标题；比较前会去首尾空白、合并连续空白并忽略大小写。首个有效 heading 已等于章节标题时不再重复渲染。

书架书卡/列表行与 AI 正文共用 `ContextMenu`。菜单必须保持 8px 视口边距，超高时内部滚动，并支持 `Escape`、方向键、`Home`、`End`、`Shift+F10`、外部点击/滚动关闭和焦点恢复。书架网格与列表都保留可见的“更多书籍操作”按钮；正文右键会在打开时快照选区或当前 block 文本，提供从此处播放、朗读本段、复制、引用和问 AI，其中“问 AI”继续走 `queueSelectionForAi`，不要另建请求通道。

旧书若没有 `BookData.structure`，`AiReaderView` 会按现有章节在前端临时生成伪结构：章节标题生成 heading，每 5 句组成一个 paragraph；该 fallback 不写回书籍数据。非 `ttsSkip` 卡片右上角可朗读本段，raw 朗读句在卡片内单独高亮，读完只恢复触发前正在播放的书籍。

已有 structure 只有在 `schemaVersion=1`、meta 形状、block 类型、全局唯一 blockId，以及 chapter/block ranges 连续且位于当前 sentences 边界内全部成立时才会保留；接受后 `BookData.chapters` 必须从 structure ranges 重派生，避免导航、检索与防剧透使用不同章节分区。hash 或任一结构不变量失配时，`normalizeBookData` 用共享的 `generatePseudoStructure` 重建并返回新 structure/meta。生成器定义在 `src/utils/bookData.ts`，Electron 的 `structureBuilder.ts` 重导出它以兼容导入流程。

## AI 对话、书内检索、选中引用与回答朗读（切片 C-F）

右侧 `AiChatPanel` 已接入 OpenAI 兼容的 `/chat/completions` 流式接口和 nmem 书内检索，Nowledge Mem 本机默认地址为 `http://127.0.0.1:14242`。设置页「AI」可管理模型、知识库、检索、防剧透、总 system prompt、证据/阅读上下文/防剧透/选区四类 prompt、历史条数，以及问候/当前章/全书三组路由正则；路由数组显式保存 `[]` 时不会恢复默认值。消息支持 Markdown/GFM；发送后先显示检索状态，再按 `requestId + seq` 追加分片，可单独停止当前请求。

```text
aiStore.sendMessage
 -> window.api.aiChat(requestId, payload)
 -> aiHandlers -> AiService.chat
 -> classifyQuestion(selection/greeting/book_wide/chapter/current_sentence/general)
 -> nmem.search -> 按 bookId、路由与 currentChapterIndex 硬过滤
 -> ai:chat:sources(searching/done/offline/skipped) -> 限长并注入编号来源
 -> streamChat(fetch + SSE) -> ai:chat:chunk(seq)
 -> ai:chat:done / ai:chat:error
 -> aiStore 更新同 requestId 的 assistant message
```

HTTP 401/403、429、5xx、网络失败、超时和取消分别归类；HTTP 200 流中的 OpenAI error envelope 或直到结束仍无有效正文也会报错，不保存为空成功回答。主要模型遇到模型服务错误时可尝试一次备用模型。路由优先级是 `selection → greeting → book_wide → chapter → current_sentence → general`：问候跳过阅读上下文和检索，chapter 始终只保留当前章来源，book-wide 在关闭防剧透时允许全书、开启时仍限制到当前阅读章。nmem 断线/超时只把当前请求降级为纯 LLM，对话不中断；面板显示离线横幅并按 `statusCacheMs` 轮询，成功检索会立即清除离线缓存。检索正文按 `retrieval.maxContextChars` 截断，以 user 证据块传入；system 规则明确证据不可信且不得执行其中指令。来源 `[N]` 可展开原文，定位时先按摘录匹配结构化 block；旧书按每 5 句的临时 block 规则匹配，无法匹配才回退到章节首块。

自动灌入在文件保存成功后后台执行，不阻塞书籍导入；`IngestService` 按章发送 `/sources/ingest/content`，名称固定为 `[bookId=<id>][ch=<0-based>] <title>`。防剧透开启时，主进程先排除其他书、无法核验元数据和 `ch > currentChapterIndex` 的结果，再把来源发送给渲染层与模型。发送时的自动阅读上下文快照由切片 E 接入。

AI 阅读卡片和听书句子列表共用 `SelectionPopup`：选中去空白后超过 2 个字符时显示固定浮动条，支持复制、引用和问 AI，并在 Escape、外部点击或滚动时关闭。“问 AI”通过 `aiStore` 的持久请求切回 AI 阅读、展开折叠侧栏并在输入框挂载后聚焦，不使用定时 DOM 查询。引用由 `aiStore` 去重并限制为 5 条，发送成功后只清除本次请求快照中的引用；请求未接受时保留。发送时同步快照当前书名、章节和句子。主进程将非空引用路由为 `selection`，引用作为主要且不可信的上下文，nmem 检索、防剧透过滤、来源隔离和历史保存流程保持不变。

完成的对话按书写入数据目录的 `ai-history.json`，正文、来源与检索状态一并保存，最多保留每书 200 条；旧的 `{role, content}` 历史仍兼容，面板清空只删除当前书历史。文件不存在时返回空历史；已存在但 JSON、根对象、任一书籍数组、任一消息形状、可选检索字段或嵌套来源对象损坏时 repository 整体抛中文错误，禁止静默过滤后覆盖原文件。配置存放于默认目录的 `settings.json.ai`，读取时对 `nmem/llm/retrieval/chat` 四段做深合并，兼容旧设置。

## Raw TTS 生命周期（切片 F）

`speakRaw` 用于卡片和 AI 回答朗读，复用书籍播放的唯一 Audio 元素与当前 TTS 引擎，但不写入 `currentSentenceIndex`、`timeMap`、书籍历史或字幕进度。`playerStore.rawSpeechActive` 让历史与字幕 effect 在 raw 期间保持书籍会话不变。

- raw 开始时只记录“此前正在播放”的书籍恢复点；从暂停或空闲触发时，raw 完成后不启动书籍。
- 用户播放、暂停、停止、seek、切书或卸载会取消 raw；前后句/seek 在原书此前播放时从新位置继续。
- 取消通过 cancel race 让挂起的合成 Promise 立即结算；异步 `AudioContext.resume()` 后重新校验 generation，旧 continuation 不能覆盖新书或新 raw。
- 连续朗读另一张卡片/回答时继承最初书籍恢复点；UI 的“停止朗读”默认按该恢复点恢复。

## 音量增益注意点

- `playerStore.setVolume`：`v===0` 自动静音，`v>0` 自动取消静音
- 静音时 `volume` 仍保留记忆值；步进请用记忆音量，**不要**用 `displayVolume`（静音时为 0）再 `toggleMute`，否则会冲掉音量或立刻重新静音
- 全局复用单一 Audio 元素（`getReusableAudio()`），MediaElementSource 只创建一次；`attachBoostPipeline` 用 WeakMap 幂等，兼容旧路径

## 启动与数据

```powershell
.\start.bat          # 可见控制台开发入口
npm run dev          # renderer 开发端口由 Vite 配置决定
npm run build
npm run typecheck
npm run lint
npm test
```

默认数据目录是 `%APPDATA%/ting-ear/听伴/`，包含 `books.json`、`ai-history.json`、`settings.json`、`engines.json`、`logs.json`、`covers/` 和缓存目录；这些是运行时数据，不入库。路径统一经 `getDataDir()`，不要硬编码拆分目录。`electron/main.ts` 在启动时把活动引擎同步为设置中的 `ttsEngine`。

## 当前状态与边界

- 已实现在线 Edge/千问/HTTP 引擎、系统 Web Speech 临时兜底、引擎管理、导入解析、阅读进度、书签/历史、OCR、浮动球和字幕窗口。
- 文本清洗为纯规则（`enhancedClean` / `cleanRules`），已移除内置 LLM 模块；导入与手动清洗共用同一流水线。
- 音量支持 0~200%（Web Audio GainNode）；沉浸开关为正文区右上 `fixed` 悬浮（`top-24 right-4`），不挡顶栏、不跟布局移位。
- 封面生成 `COVER_STYLE_VERSION=v2-light`。
- 断点恢复三层机制（见下节）。
- AI 阅读页切片 B 已完成：默认结构化卡片、大纲导航、当前句高亮、模式切换和旧书 fallback。
- AI 对话切片 C 已完成：OpenAI 兼容流式直聊、Markdown、取消、备用模型、设置页和按书历史。
- AI 检索切片 D 已完成：nmem health/search/按章 ingest、检索状态、来源引用与定位、离线降级和按当前章节硬防剧透。
- AI 选中引用切片 E 已完成：阅读/听书统一浮动条、最多 5 条引用卡片、组合提问、发送时自动上下文快照和 selection 优先提示词。
- AI 朗读切片 F 已完成：ttsSkip 导航/预取过滤和灰显、卡片/回答 raw 朗读、逐句高亮、书籍优先取消与严格恢复生命周期。
- 阅读交互基础已完成：共享可访问右键菜单、书架双视图更多入口、正文段落/选区动作、章节标题去重、连续阅读排版、全局 `focus-visible` 与 reduced-motion。
- `structureMeta.contentHash` 使用句子以换行拼接后的 UTF-8 SHA-256 前 16 位；不要替换为 FNV 等非规格算法。
- 不要把用户书籍、API key、cookies、日志或缓存写入 Git。

## 断点恢复（autoResume）

三层恢复机制，确保刷新/重启后快速回到阅读位置：

1. **启动自动恢复**（`App.tsx` auto-resume effect）：`books` 加载后找 `lastReadAt` 最近且 `!isCompleted && progressPercent > 0` 的书，调 `handleOpenBook` 直接进播放器。`autoResumedRef` 保证只触发一次。
2. **书架「继续阅读」卡片**（`BookShelf.tsx` `lastReadBook` useMemo）：书架顶部显示上次读到的书（封面+章节+进度条），点击即恢复。仅在「全部书籍」视图且无专辑筛选时显示。
3. **历史一键跳转**（`HistoryView.tsx` `handleContinue`）：历史记录带 `contentPreview`，点播放按钮跳到 `endSentenceIndex`。

设置项：`AppSettings.autoResume?: boolean`（默认 `true`，`undefined` 视为开启）。开关在 SettingsModal「窗口行为」区。判断统一用 `=== false` 关闭，避免旧配置缺字段时误判。

## 章节大纲重构增量索引

| 文件 | 核心内容 | 何时读 |
|---|---|---|
| `src/components/reader/ChapterOutlinePanel.tsx` | 当前章专属大纲面板、生成/重试、章节名与小节名编辑恢复 | 修改大纲面板或标题编辑 |
| `electron/services/ai/outline-repository.ts` | 版本 3 的按书/章键/内容哈希缓存，临时文件原子替换 | 修改大纲持久化、迁移或清理 |
| `electron/services/ai/outline-input.ts` | 从 books.json 重新加载当前章节并校验稳定章键，防止 IPC 信任 renderer 文本 | 修改大纲 IPC 请求、章节身份或数据目录 |
| `electron/services/ai/outline-queue.ts` | 进程级 FIFO 单飞行生成队列 | 修改并发、排队或后台任务 |
| `electron/services/ai/outline-generator.ts` | <=10 短章策略、比例最低节数、偏移和数量校验 | 修改模型提示或大纲生成规则 |
| `electron/ipc/aiHandlers.ts` / `electron/preload.ts` | 当前章文本请求、读取/生成/更新 IPC | 修改大纲跨进程接口 |

## 测试

- `tests/textPreprocessor.test.ts` — 清洗流水线 23 项
- `tests/bookData.test.ts` — 分句/章节/进度规范化
- `tests/parserCompatibility.test.ts` — 解析器兼容
- `tests/engineImport.test.ts` — 引擎 JSON/curl 导入
- `tests/albumUtils.test.ts` — 专辑工具
- `tests/bookStore.test.ts` — 阅读模式切换、打开新书默认 AI 阅读且保留播放状态/位置
- `tests/readerComponents.test.ts` — 模式控件、章节标题契约、连续段落/特殊 block、当前句状态、窄 store 订阅和旧书 fallback 服务端渲染
- `tests/llmCaller.test.ts` / `ipcStreaming.test.ts` — SSE、错误分类、备用模型、上下文路由、流序号和定向取消
- `tests/settingsDeepMerge.test.ts` / `aiHistory.test.ts` — AI 配置/路由正则深合并、带来源的按书 JSON 历史与损坏文件错误传播
- `tests/aiStore.test.ts` / `aiComponents.test.ts` / `aiSettingsPanel.test.ts` — 前端流状态、历史引用恢复、离线转在线、Markdown 对话和设置表单
- `tests/nmemBridge.test.ts` / `nmemContract.test.ts` — nmem 请求格式、响应校验、断线、超时与成功检索后的在线恢复
- `tests/spoilerFilter.test.ts` / `ragOrchestration.test.ts` / `ragComponents.test.ts` — 来源硬过滤、chapter/book-wide 路由、取消终态、提示词安全与限长、离线降级和精确引用定位
- `tests/selectionQuoteComponents.test.ts` — 选区阈值、视口钳制、引用卡片和输入框静态集成
- `tests/contextMenuComponents.test.ts` — 右键菜单视口钳制/语义，以及书架与正文菜单接线
- `tests/mdParserStructure.test.ts` / `epubParserStructure.test.ts` / `structureVersionMismatch.test.ts` — MD 首段/未闭合围栏、EPUB package 属性变体与文档顺序、跨章全局 range、失效结构 pseudo 重建和章节重派生
- `tests/ttsSkip.test.ts` / `ttsSession.test.ts` / `modeSwitchPlayback.test.ts` — 跳过导航/预取、raw 互斥状态与取消恢复、模式切换和字幕/历史隔离

修改清洗规则或分句逻辑后务必跑 `npm test`；改 IPC 签名后跑 `npm run typecheck`。

## 当前状态补充

- 章节大纲已切换为按当前阅读章生成：切章只读取对应记录，不自动触发 AI；请求只携带当前章句子。
- EPUB 同一 XHTML 文件内的密集 TOC 锚点会按 200~500 句归并，保留 heading block 和全局范围；不同 spine 文件仍保持章节边界。
- 大纲缓存使用版本 3，按 `bookId + chapterKey + sentenceContentHash` 隔离；旧版本缓存自动失效。生成队列为进程级 FIFO 单飞行。
- `ChapterOutlinePanel` 是唯一挂载的大纲 UI；`SectionNav` 和 `ChapterOutline` 仅保留兼容类型引用，后续不要重新接回旧实现。
- Electron 主进程的 Node `fetch` 不读取 HTTP(S) 代理环境变量；模型列表和流式请求在检测到代理时通过 axios 发送，否则保留原 fetch 路径。代理配置或模型请求异常时优先检查 `electron/services/ai/llm-caller.ts`。
- 智谱接口曾保存过 `GLM-4.7-Flash` 旧别名，当前模型列表使用 `glm-4.7`；请求层会自动做该别名兼容映射。
- 已知边界：Markdown 低层标题的旧结构测试仍保持原语义；若要将 Markdown 的 `##/###` 统一视为章内 heading，需要单独迁移测试和正文导航数据。
