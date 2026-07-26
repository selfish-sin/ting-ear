# AI 阅读模块编码规范

> 适用范围：`electron/services/ai/`、`electron/services/parsers/`（结构相关）、`src/components/ai/`、`src/components/reader/`、`src/stores/aiStore.ts`
>
> 最近核对：2026-07-27（对照已实现代码；一期 A–F + 大纲 v3 + 整本 ingest 已落地）
> 任务归档后以本文件 + 根目录 `CONTEXT.md` 为准，不再依赖已归档 task 的 design/implement 作为唯一真相。

---

## 1. 零硬编码（最高优先级）

### 1.1 铁律

```
RED LINE: 业务代码中禁止出现任何可配置值的字面量。
```

### 1.2 唯一默认值来源

- `AI_DEFAULTS: AiSettings` 定义在跨进程纯模块 `src/aiSettings.ts`
- `electron/services/ai/ai-config.ts` 只重导出该默认值与深合并函数，主进程不得再定义一份
- 新增配置项 → 只改 `AI_DEFAULTS` + `AiSettings` 接口，并在 `AiSettingsPanel` 暴露对应控件

### 1.3 禁止清单

| 禁止 | 正确做法 |
|------|---------|
| `fetch("http://127.0.0.1:14242/...")` | `fetch(\`${cfg.nmem.baseUrl}/...\`)` |
| `model: "deepseek-chat"` | `model: cfg.llm.model` |
| 内联 system prompt | `cfg.chat.systemPrompt/evidencePrompt/readerContextPrompt/spoilerPrompt/selectionPrompt` |
| 硬编码路由正则 | 从 ai-config 读取 patterns |
| 硬编码 ttsSkip 类型列表 | 从配置或 structure block.ttsSkip 读取 |

---

## 2. 错误处理

### 2.1 分类错误

```typescript
interface AiError {
  errorType: 'nmem_offline' | 'auth_failed' | 'rate_limited' | 'timeout' | 'model_error' | 'network_error' | 'ingest_failed'
  message: string   // 中文
  cause?: unknown   // 仅日志
}
```

### 2.2 禁止

```
RED LINE: 禁止 catch 后 return [] / return null / 空操作。
RED LINE: 禁止 .catch(() => {}) 。
```

### 2.3 降级

- nmem 离线 → 跳过检索，纯 LLM
- 主模型失败 + fallbackModel 非空 → 重试备用
- HTTP 200 SSE 的 error envelope 或结束前无有效正文 → 抛 `AiServiceError`，禁止保存空回答
- 语义压缩失败 → 静默跳过（不阻塞对话）
- structure 解析失败 → fallback 到 sentences 伪结构

---

## 3. 配置访问

- 主进程：`mergeAiSettings(settingsService.get().ai)` from ai-config.ts
- 渲染进程：`useSettingsStore(s => s.settings.ai)`
- 变更生效：nmem `baseUrl` → 下次状态检查/检索；llm → 下次请求
- `AiSettings` 中每个一期字段都必须能从设置页管理；证据、阅读上下文、防剧透和选区策略各有独立 prompt 字段
- `greetingPatterns`、`chapterPatterns`、`bookWidePatterns` 在文本框中一行一个正则；显式空数组表示禁用该类路由，不得在深合并时恢复默认值

---

## 4. IPC 规范

- 前缀 `ai:`，格式 `ai:<domain>:<action>`
- 所有 handler 集中在 `electron/ipc/aiHandlers.ts`
- preload 暴露到 `window.api.ai*`（flat 命名）
- 渲染进程通过 `window.api.ai*` 调用，禁止直接 ipcRenderer

---

## 5. 结构解析规范

### 5.1 Parser 输出

- MD/EPUB parser 必须输出 `structure: StructuredChapter[]`
- sentences[] 和 chapters[] 从 structure 派生（structureBuilder），不独立维护
- Markdown 文件以 fenced code 开头或围栏未闭合时，代码 block 仍必须保留；进入首个围栏前先建立默认章节
- 每个 Block 的 sentences 用现有 `splitReadableSentences()` 拆分（不新建拆句逻辑）

### 5.2 Block 类型判定

| 来源 | 判定规则 |
|------|---------|
| MD `#`~`######` | heading, level = # 数量 |
| MD 空行分隔文本 | paragraph |
| MD `[^id]` | footnote, ttsSkip=true |
| MD `>` | quote |
| MD ``` | code, ttsSkip=true |
| EPUB `<h1>`-`<h6>` | heading, level = 标签数字 |
| EPUB `<p>` | paragraph |
| EPUB `<aside>`/`[epub:type="footnote"]`/`.footnote` | footnote, ttsSkip=true；属性值兼容单、双引号 |
| EPUB `<blockquote>` | quote |
| EPUB `<pre>`/`<code>` | code, ttsSkip=true |
| 无法识别 | paragraph（安全 fallback） |

EPUB XHTML 使用 `fast-xml-parser` 的 `preserveOrder` 遍历；普通容器递归，连续行内文本合并，未知容器的可读文本不得因已识别到其他块而丢失。
EPUB 的 `META-INF/container.xml` 与 OPF package/manifest/spine/metadata 同样必须用 XML parser 结构读取；合法的单/双引号和任意属性顺序不得影响 OPF 定位或 spine 顺序。

### 5.3 禁止

- 禁止引入 jsdom / cheerio；使用已有 `fast-xml-parser` 完成确定性的顺序遍历
- 禁止修改 splitReadableSentences 逻辑
- 禁止修改 chapterBuilder 逻辑（从 structure 派生 chapters 即可）
- 禁止在 parser 中调用 LLM（结构识别是确定性的，不用 AI）

### 5.4 ttsSkip 默认值

| BlockType | ttsSkip 默认 |
|-----------|-------------|
| heading | false（可配置为 true） |
| paragraph | false |
| footnote | true |
| endnote | true |
| quote | false |
| list | false |
| code | true |
| page_break | true |
| toc_entry | true |

### 5.5 结构一致性哈希

- `hashSentences()` 将 sentences 用 `\n` 拼接，按 UTF-8 计算 SHA-256，取小写十六进制前 16 位
- 该函数位于 `src/utils/contentHash.ts`，必须保持同步且同时可在 Node 与浏览器运行
- 禁止改成 FNV、只比较句数/前几句或使用仅 Node 可用的 `createHash`

### 5.6 失效结构重建

- `generatePseudoStructure()` 位于共享的 `src/utils/bookData.ts`，`structureBuilder.ts` 只重导出以保持 parser API 稳定
- `normalizeBookData()` 只接受 `schemaVersion=1`、合法 meta/chapter/block 形状、允许的 block type、全局唯一 blockId，以及连续有界 chapter/block ranges
- 已有 structure 的 hash 或任一结构不变量失配、或缺少配套 meta 时，必须用当前 `sentences + chapters` 重建 pseudo structure/meta；禁止只删除结构
- 已有 structure 通过校验时，运行时必须从其 chapter ranges 重派生 `BookData.chapters`，不得保留与 structure 分区不一致的旧 chapters
- 真正没有 structure 的旧书仍保持可选字段为空，由 AI 阅读页临时 fallback；重新导入时写入 pseudo structure

---

## 6. 模式切换规范

### 6.1 状态

- `bookStore.readerMode: 'ai-reading' | 'listening'`
- 默认 `'ai-reading'`（打开书后 `setCurrentBook` 会重置）
- 进入 `ai-reading` 时 `App.tsx` **会 pause** 书籍 TTS（避免侧栏阅读时继续出声）；**不**重置 `currentSentenceIndex` / timeMap
- AI 阅读底栏：`AiPlaybackCapsule`（可拖拽）；听书模式：完整 `ProgressBar` + `ControlBar`（`shouldShowAiPlaybackCapsule` / `shouldShowFullPlaybackBar`）

### 6.2 位置同步

- AI 阅读→听书：定位到当前高亮卡片的第一句
- 听书→AI 阅读：滚动到 currentSentenceIndex 所在卡片
- 同步是单向快照，不持续联动

### 6.3 禁止

- 禁止切换模式时清空 AI 对话历史
- 禁止切换模式时重置 TTS **句子位置**（可 pause，不可 seek 回 0）
- 禁止在听书模式挂载整页 AI 阅读树时用 `display:none` 假隐藏关键副作用；`App` 用条件渲染在两种主视图间切换

---

## 7. 前端组件规范

### 7.1 四态覆盖

每个数据展示组件：loading / empty / error / success。

### 7.2 文案

- 所有用户可见文案中文
- 按钮是具体动作（"重新连接"而非"确定"）

### 7.3 样式

- 颜色从 Tailwind theme token 取（primary/surface/dark-*）
- 禁止内联 style 写死颜色（Vibero 抄来的 inline style 必须转为 Tailwind class）
- cn() 工具函数用于条件 class 合并

### 7.4 复用代码适配规则

- 从 Vibero 抄的 JSX → 必须转 TSX（加类型）
- 从 SageRead 抄的组件用 `cn()` → 确保已创建 src/utils/cn.ts
- 从 SageRead 抄的 Radix 组件 → 用纯 Tailwind + state 替代（不引入 Radix）
- 从 ReadAny 抄的 i18n 字符串 → 替换为中文硬编码（ting-ear 无 i18n）
- 所有抄来的代码必须去掉原项目的 store 耦合，改为读 ting-ear 的 store

### 7.5 侧栏聚焦与沉浸生命周期

- “问 AI”写入可持久的 focus request；侧栏折叠时先展开，输入框挂载后聚焦并按 requestId 消费
- 禁止用固定延时查询 DOM 猜测输入框何时出现
- AI 阅读沉浸模式只隐藏侧栏的稳定宿主，不卸载 `AiChatPanel`；切换沉浸不得取消正在生成的回答

---

## 8. 主进程模块规范

### 8.1 职责边界

| 模块 | 只做 | 不做 |
|------|------|------|
| ai-config.ts | 重导出默认值 + 深合并 | 业务逻辑 |
| nmem-bridge.ts | HTTP 请求 nmem | prompt/LLM |
| llm-caller.ts | OpenAI fetch/axios + SSE | 检索编排 |
| ai-service.ts | 对话/RAG 编排 | 直接持久化 UI 状态 |
| ingest-service.ts | **整本**一书一源 → nmem | 对话 |
| ingest-scheduler.ts | 排队、重试、`ingest-status.json` | 解析文件 |
| outline-generator/input/queue/repository | 当前章大纲生成与缓存 | 书内问答 |
| structureBuilder.ts | structure→sentences/chapters 派生 | 解析文件 |

### 8.2 依赖方向

```
aiHandlers → ai-service → { nmem-bridge, llm-caller, ai-config }
aiHandlers → outline-* → { llm-caller, books.json via outline-input }
fileHandlers → IngestScheduler → ingest-service → nmem-bridge
fileHandlers → parsers / structureBuilder
```

禁止反向依赖。

### 8.4 知识库 ingest（整本）

- V3：**一书一源**整本上传，不再按章拆成多 source
- 状态文件：`ingest-status.json`；旧按章记录视为过期并整本重传
- 自动 ingest 在书籍保存成功后后台执行，失败 toast `ai:ingest:error`，不阻断导入

### 8.3 流式

- llm-caller 接受 AbortSignal
- ai:cancel → abort
- 取消后发 ai:chat:done（sources 空），不发 error
- ai:chat:sources 必须在第一个 chunk 之前
- HTTP 200 内的 OpenAI-compatible `error` envelope 必须转成 `model_error`
- 流结束时若从未收到非空正文，必须转成 `invalid_response`

---

## 9. 数据持久化

### 9.1 对话历史

- 数据目录下单个 `ai-history.json`，结构为 `Record<bookId, AiHistoryMessage[]>`
- 每书最多保留 200 条；正文、来源、检索状态与检索错误一并持久化
- 向后兼容只有 `{ role, content }` 的旧消息
- 数据目录运行时切换后，repository 必须通过动态 `getDataDir()` 读取新路径
- 文件不存在时返回空历史；文件已存在但 JSON、根对象、任一书籍数组、任一消息形状、可选检索字段或任一嵌套 `AiSourceRef` 损坏或无法读取时必须抛出中文错误，禁止静默过滤或伪装成空历史；缺少这些可选字段的旧 `{role, content}` 消息仍兼容

### 9.2 books.json

- structure 字段可选（旧书没有）
- 体积增大可接受（短期）
- `Block` 只存 `text + sentenceRange`，禁止新增 `block.sentences` 副本；TTS 使用从 structure 派生的 `BookData.sentences`

---

## 10. 依赖管理

### 10.1 新增

react-markdown / remark-gfm / fast-xml-parser / clsx / tailwind-merge

### 10.2 禁止引入

- Ant Design / shadcn/ui / Radix（用纯 Tailwind 实现）
- Slate（QuoteChips 用简单 state 管理，不需要富文本编辑器）
- LangChain / LlamaIndex / Vercel AI SDK
- jsdom / cheerio（EPUB 使用已有 fast-xml-parser）
- 本地 Embedding 库

---

## 11. 交互模式规则

### 11.1 问题路由

- 分类优先级固定为 `selection → greeting → book_wide → chapter → current_sentence → general`
- 非空引用强制走 selection；greeting 跳过检索和自动阅读上下文
- `book_wide` 与 `chapter` 由 `chat.bookWidePatterns` / `chat.chapterPatterns` 配置，并在 autoContext 判定之前匹配，避免所有阅读页问题退化为 current_sentence
- chapter 的检索来源必须满足 `chapterIndex === currentChapterIndex`，即使关闭防剧透也不能扩大
- book_wide 在关闭防剧透时可检索全书；开启时仍先硬过滤到 `chapterIndex <= currentChapterIndex`
- 无效正则只跳过该条 pattern，不得导致对话失败

### 11.2 引用、来源与防剧透

- 引用最多 5 条，trim、去重；只有请求被主进程接受后才清除本次引用快照
- 来源必须先按 bookId 和可核验章节元数据过滤，再发送 sources 事件并注入模型
- 防剧透同时使用检索硬过滤与 system prompt 约束；模型历史或用户要求不能绕过当前阅读边界

---

## 12. TTS 集成规则

### 12.1 与现有播放管线共存

- 保留 `useTTS` 在线引擎、错误降级、**内存预取**（`PREFETCH_CONCURRENCY=2`）与唯一 `Audio` + **GainNode 音量增益**（0~200%）
- 扩展 AI 能力时**禁止拆掉** `audioOutput` / 预取缓存；书籍与 raw 朗读仍复用同一 Audio 元素
- ttsSkip 导航/预取过滤与 `speakRaw` / `stopRaw` 生命周期是 AI 阅读附加约束
- 听书模式继续用 ControlBar / ProgressBar；AI 阅读用 `AiPlaybackCapsule`，不要两套引擎

### 12.2 speakRaw

- 复用现有 TTS 引擎（Edge/Qwen/system）
- 朗读与书籍互斥（朗读前暂停，朗读后恢复）
- 用户手动播放书籍 → 立即停止 AI 朗读（书籍优先）
- 只有 raw 开始前正在播放的书籍才允许在完成/显式停止后恢复；从暂停或空闲触发时不得启动书籍
- 用户播放、暂停、停止、seek、切书或卸载必须取消 raw；挂起的合成 Promise 也必须立即结算
- 合成与播放的每个异步 continuation 必须复核 raw token / book generation，旧操作不得覆盖新书/新 raw
- raw 期间不得更新书籍句子索引、timeMap、历史会话或字幕播放状态；用 `playerStore.rawSpeechActive` 隔离发布

### 12.3 卡片朗读

- 卡片 [▶] 按钮 → speakRaw(block.text)
- 朗读时卡片内逐句高亮（使用 raw 朗读自己的局部句子索引）
- 读完本段停止（不自动继续下一段）

### 12.4 AI 历史初始化

- 历史读取失败不得回退成无提示的空数组；渲染层必须显示中文错误和重试指引
- 快速切书时旧初始化结果不得覆盖新书；切书/卸载同时取消旧请求并清理 listeners

---

## 13. 文件组织（当前）

```
electron/services/ai/
├── ai-config.ts / ai-history.ts / ai-service.ts
├── nmem-bridge.ts / llm-caller.ts
├── ingest-service.ts / ingest-scheduler.ts    # 整本同步
├── outline-generator.ts / outline-input.ts
├── outline-queue.ts / outline-repository.ts   # 大纲 v3 缓存

electron/services/parsers/
├── structureBuilder.ts / chapterBuilder.ts
├── mdParser.ts / epubParser.ts / … / mobiParser.ts
└── textPreprocessor.ts

electron/ipc/aiHandlers.ts                     # chat + nmem + outline

src/components/reader/
├── AiReaderView.tsx / ContentCards.tsx / ContentCard.tsx
├── ChapterOutlinePanel.tsx                    # 唯一挂载的大纲 UI
├── AiPlaybackCapsule.tsx                      # AI 模式播放胶囊
├── ModeSwitch.tsx / ReaderHeader.tsx
├── ChapterOutline.tsx / SectionNav.tsx        # 遗留未挂载，勿接回

src/components/ai/                             # 侧栏对话、引用、检索、选区
src/stores/aiStore.ts
src/utils/cn.ts / contentHash.ts / ttsSkip.ts / ttsSession.ts
```

### 13.1 章节大纲

- 仅当前阅读章；切章只读缓存，不自动 generate
- IPC：`ai:outline:get|generate|update`；正文以 `outline-input` 从 `books.json` 为准
- 缓存：`outlines/<bookId>.json`，`OUTLINE_CACHE_VERSION=3`

新增/删除源文件必须同步 `CONTEXT.md` 文件索引。
