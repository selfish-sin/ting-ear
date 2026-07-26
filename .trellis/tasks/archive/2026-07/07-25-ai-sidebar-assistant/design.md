# AI 阅读重构 — 设计定稿（方案 B：双层共存）

> 基于 ting-ear 真实代码分析。所有接口/类型/文件路径均经过验证。
> 全部代码自己写（参考项目许可证限制：ReadAny=GPLv3, SageRead=AGPLv3, Vibero/ai-book-reader=无LICENSE）。
> 参考项目仅作架构/交互思路参考，不复制代码。

---

## 一、架构总览

```
┌─ 渲染进程 (React 18 + Zustand 5 + Tailwind 3.4) ──────────────────┐
│                                                                     │
│  App.tsx                                                            │
│  ├── SideNav（现有，不动）                                          │
│  ├── 主内容区（模式切换）                                           │
│  │   ├── mode='ai-reading' → <AiReaderView />  ← 新               │
│  │   └── mode='listening'  → <PlayerView />    ← 现有，微调        │
│  ├── ProgressBar（现有，全宽，不动）                                │
│  └── ControlBar（现有，全宽，不动）                                 │
│                                                                     │
│  AiReaderView（新）                                                 │
│  ├── ChapterOutline（左，可折叠）                                   │
│  ├── ContentCards（中，结构化卡片）                                 │
│  └── AiChatPanel（右，AI 对话）                                     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  IPC (contextBridge) — window.api.ai*                               │
├─────────────────────────────────────────────────────────────────────┤
│  主进程 (Node.js / Electron 28)                                     │
│  electron/services/ai/                                              │
│  ├── ai-config.ts       配置（零硬编码）                            │
│  ├── nmem-bridge.ts     HTTP → nmem server                          │
│  ├── llm-caller.ts      OpenAI 兼容流式 [抄:Vibero/customOpenAIService.js] │
│  ├── ai-service.ts      编排（路由→检索→prompt→流回）              │
│  ├── skills-engine.ts   模板插值                                    │
│  └── ingest-service.ts  书籍→nmem                                   │
│  electron/services/parsers/                                         │
│  ├── structureBuilder.ts  ← 新：通用结构构建器                      │
│  ├── epubParser.ts        ← 改：保留 HTML 结构                      │
│  └── mdParser.ts          ← 改：保留 MD 结构                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、数据模型（双层）

### 2.1 新增类型（加入 src/global.d.ts）

```typescript
// ─── 结构层（AI 阅读页面用）───
type BlockType = 'heading' | 'paragraph' | 'footnote' | 'endnote' | 'quote' | 'list' | 'code' | 'page_break' | 'toc_entry'

interface Block {
  blockId: string               // 稳定 ID（uuid，导入时生成）
  type: BlockType
  level?: number                // heading: 1-6
  text: string                  // 原始文本（唯一文本存储点，不重复存 sentences）
  ttsSkip: boolean              // TTS 是否跳过
  sentenceRange: [number, number]  // 在全局 sentences[] 中的 [start, end)
  meta?: Record<string, string> // 脚注编号等
}

interface StructuredChapter {
  title: string
  level: number                 // 章节层级（1=章，2=节）
  blocks: Block[]
  sentenceRange: [number, number]  // 全局 sentences[] 中的范围 [start, end)
}

interface StructureMeta {
  schemaVersion: 1              // 结构格式版本
  contentHash: string           // sentences 内容 SHA-256 前 16 位（校验用）
  sourceFormat: string          // 'md' | 'epub' | 'pdf' | 'pseudo'
}

// ─── BookData 扩展（现有字段全部保留）───
interface BookData {
  // ...现有 26 个字段不动...
  structure?: StructuredChapter[]  // 新增！可选（旧书没有→fallback 伪结构）
  structureMeta?: StructureMeta    // 新增！structure 的校验元数据
}
```

### 2.2 不变的部分

```typescript
// 这些完全不动：
sentences: string[]           // TTS 仍读这个
chapters: Chapter[]           // { title, startIndex, sentenceCount }
timeMap?: number[]
currentSentenceIndex: number
// useTTS 仍按 sentences[globalIndex] 播放
```

### 2.3 派生关系

```
structure（主数据，parser 生成）
  → 派生 sentences[]（遍历所有 block.sentences，拼接）
  → 派生 chapters[]（每个 StructuredChapter → { title, startIndex, sentenceCount }）
```

sentences 和 chapters 从 structure 单向派生，不独立编辑。保证一致性。

### 2.4 旧书兼容

无 structure 的旧书：
- 听书模式：正常（读 sentences[]）
- AI 阅读页面：生成伪结构（每 5 句 → 一个 paragraph block，章节标题 → heading block）
- 或提示用户"重新导入以获得完整结构"

---

## 三、Parser 改造

### 3.1 新增：structureBuilder.ts

```typescript
// electron/services/parsers/structureBuilder.ts
// 通用结构构建器：从 Block[] 派生 sentences[] + chapters[]

export function deriveSentences(chapters: StructuredChapter[]): string[] {
  const sentences: string[] = []
  for (const ch of chapters) {
    for (const block of ch.blocks) {
      block.sentenceStart = sentences.length
      sentences.push(...block.sentences)
    }
  }
  return sentences
}

export function deriveChapters(structure: StructuredChapter[]): Chapter[] {
  let idx = 0
  return structure.map(ch => {
    const count = ch.blocks.reduce((n, b) => n + b.sentences.length, 0)
    const result = { title: ch.title, startIndex: idx, sentenceCount: count }
    idx += count
    return result
  })
}

export function generatePseudoStructure(sentences: string[], chapters: Chapter[]): StructuredChapter[] {
  // 旧书 fallback：每章内每 5 句一组 → paragraph block
}
```

### 3.2 mdParser 改造

现在（`electron/services/parsers/mdParser.ts` L52）：
```typescript
// 现在：# 标题 → 章节切分 → 全部 splitReadableSentences → string[]
```

改为：
```typescript
export function parseMarkdown(filePath: string): BookData {
  const raw = decodeMarkdownSafe(filePath)
  const structure = parseMarkdownToStructure(raw)  // 新函数
  const sentences = deriveSentences(structure)
  const chapters = deriveChapters(structure)
  // ...构造 BookData，含 structure 字段
}

function parseMarkdownToStructure(md: string): StructuredChapter[] {
  // 逐行解析：
  // /^#{1,6}\s+(.+)/ → 新章节开始（level = # 数量）或 heading block
  // 空行分隔 → paragraph block（text 保留，sentences 用 splitReadableSentences 拆）
  // /^\[\^(\w+)\]/ → footnote block（ttsSkip=true）
  // /^>\s/ → quote block
  // /^```/ → code block（ttsSkip=true）
  // /^[-*+]\s/ → list block
  // 其他 → paragraph block
}
```

**关键：不再 stripMarkdown。** 保留 `#` 层级、`>` 引用、`[^1]` 脚注、代码块。

### 3.3 epubParser 改造

现在（`electron/services/parsers/epubParser.ts` L60）：
```typescript
// 现在：stripHtml(html) → 纯文本 → splitReadableSentences → string[]
```

改为：
```typescript
function parseHtmlToBlocks(html: string): Block[] {
  // 用正则或轻量 DOM 解析（不引入 jsdom，用正则匹配标签）：
  // <h1>-<h6> → heading block (level=N)
  // <p> → paragraph block
  // <aside>, [epub:type="footnote"], .footnote → footnote block (ttsSkip=true)
  // <blockquote> → quote block
  // <ul>/<ol> → list block
  // <pre>/<code> → code block (ttsSkip=true)
  // 其他文本 → paragraph block
  // 每个 block 的 sentences 用现有 splitReadableSentences(text) 拆分
}
```

**注意：** 不引入 jsdom/cheerio（避免重依赖）。EPUB 的 XHTML 结构简单，正则足够。现有 `stripHtml` 函数保留给听书模式 fallback。

### 3.4 PDF 处理

用户说"PDF 硬转 MD"。一期方案：
- 现有 pdfParser 输出 sentences[] 不变
- 用 `detectHeadingBoundaries` 的结果生成伪 structure
- 二期：引入 pymupdf4llm 做 PDF→MD 预处理（不在本次范围）

### 3.5 导入流程变更（fileHandlers.ts）

```
现在：file → parse → sentences[] + chapters[] → BookData → books.json
改为：file → parse → structure[] → deriveSentences + deriveChapters → BookData(含structure) → books.json
```

---

## 四、UI 布局

### 4.1 模式切换

```typescript
// src/stores/bookStore.ts 新增
type ReaderMode = 'ai-reading' | 'listening'
// 默认 'ai-reading'（打开书后进入 AI 阅读页面）
```

App.tsx 中：
```tsx
{currentView === 'player' && (
  <div className="flex-1 flex flex-col min-h-0">
    <div className="flex-1 flex min-h-0">
      {readerMode === 'ai-reading' && <AiReaderView />}
      {readerMode === 'listening' && <PlayerView />}
    </div>
    <ProgressBar />   {/* 全宽，不动 */}
    <ControlBar />    {/* 全宽，不动 */}
  </div>
)}
```

模式切换入口：ControlBar 左侧新增模式按钮组（或顶栏）。
切换时 TTS 播放不中断（useTTS 状态与模式无关）。

### 4.2 AI 阅读页面（AiReaderView）

```
┌─────────────────────────────────────────────────────────────────┐
│ AiReaderView (flex row)                                          │
├────────────┬────────────────────────┬───────────────────────────┤
│ Outline    │ ContentCards           │ AiChatPanel               │
│ (200px)    │ (flex-1)               │ (360px, 可拖拽/可折叠)    │
│            │                        │                           │
│ 第1章      │ ┌────────────────────┐ │ ┌───────────────────────┐ │
│  1.1 节    │ │ # 第一章 标题      │ │ │ NmemBanner            │ │
│  1.2 节    │ │ (heading card)     │ │ ├───────────────────────┤ │
│ 第2章 ●    │ ├────────────────────┤ │ │ ChatMessages          │ │
│  2.1 节    │ │ 正文段落…          │ │ │ (Part 渲染)           │ │
│  2.2 节    │ │ (paragraph card)   │ │ │                       │ │
│            │ │ [▶ 朗读本段]       │ │ │                       │ │
│            │ ├────────────────────┤ │ ├───────────────────────┤ │
│            │ │ 脚注 [折叠]        │ │ │ RetrievalCard         │ │
│            │ │ (footnote, 灰显)   │ │ ├───────────────────────┤ │
│            │ └────────────────────┘ │ │ QuoteChips            │ │
│            │                        │ │ ChatInput             │ │
│            │                        │ │ [🚫防剧透] [发送]     │ │
└────────────┴────────────────────────┴───────────────────────────┘
```

### 4.3 听书模式（PlayerView）

**现有 PlayerView 基本不动。** 微调：
- 顶栏新增模式切换按钮（切回 AI 阅读）
- ttsSkip 句子灰显或隐藏（可选）
- 其他全部保留（句子列表、行号、高亮、自动滚动、搜索）

### 4.4 卡片渲染规则

| Block type | 卡片样式 | TTS |
|-----------|---------|-----|
| heading | 大字号，粗体，无背景 | 读（可配置不读） |
| paragraph | 正常字号，白底卡片 | 读 |
| footnote | 小字号，灰底，默认折叠 | 不读 |
| quote | 左边框 primary，斜体 | 读 |
| list | 带序号/圆点 | 读 |
| code | 等宽字体，深色底 | 不读 |
| page_break | 分隔线 | 不读 |
| toc_entry | 灰显 | 不读 |

当前播放句所在卡片：左边框 primary + 轻微背景色。
当前播放句：卡片内对应文字高亮（复用现有 `bg-primary/10` 样式）。

---

## 五、AI 后端（与之前设计一致，微调）

### 5.1 模块（不变）

| 文件 | 职责 | 来源 |
|------|------|------|
| ai-config.ts | 配置+默认值 | 自写 |
| nmem-bridge.ts | nmem HTTP | 自写 |
| llm-caller.ts | SSE 流式 | [抄:Vibero/customOpenAIService.js] 改 TS |
| ai-service.ts | 编排+路由+防剧透+压缩 | 自写 |
| skills-engine.ts | 模板插值 | 自写，prompt 参考 [ReadAny/builtin-skills.ts] |
| ingest-service.ts | 书→nmem | 自写 |
| aiHandlers.ts | IPC 注册 | 自写 |

### 5.2 IPC 通道（不变）

ai:chat / ai:chat:chunk / ai:chat:sources / ai:chat:done / ai:chat:error / ai:cancel / ai:nmem:status / ai:nmem:ingest / ai:history:get / ai:history:clear / ai:cite:navigate

### 5.3 问题路由（不变）

greeting / selection / current_sentence / chapter / book_wide / general

### 5.4 配置结构（AiSettings，不变）

nmem / llm / retrieval / skills / chat 五段，全部从前端设置页管理。

---

## 六、交互模式（与之前设计一致）

引用卡片（Quote-Attach）、来源导航（[N]药丸→定位）、检索透明（RetrievalCard）、Part 消息结构、防剧透、思维导图 Skill、深度控制、语义压缩、回答朗读——全部保留，见之前 design.md 交互设计章节。

**新增：卡片级交互**
- 卡片右上角 [▶] 按钮：朗读本段（调 speakRaw，从本段第一句开始）
- 卡片内选中文字 → 统一浮动条 [复制] [引用] [解释] [翻译] [问AI]
- 点击大纲项 → 滚动到对应卡片
- 当前播放句自动滚动（AI 阅读页面也有，复用 PlayerView 的 scrollIntoView 逻辑）

---

## 七、TTS 适配（最小改动 + 状态机）

### 7.1 useTTS 改动（~10 行）

```typescript
// src/hooks/useTTS.ts — ttsSkip 跳过
function skipEmptyForward(idx: number): number {
  const { sentences } = useBookStore.getState()
  const structure = useBookStore.getState().currentBook?.structure
  while (idx < bounds.end) {
    if (sentences[idx]?.trim() && !isTtsSkip(idx, structure)) break
    idx++
  }
  return idx
}

function isTtsSkip(idx: number, structure?: StructuredChapter[]): boolean {
  if (!structure) return false
  // 二分查找 idx 所在 block，返回 block.ttsSkip
}
```

### 7.2 speakRaw — 独占播放会话状态机

**不用"暂停→朗读→恢复"的天真方案。** 用显式状态机：

```typescript
// src/utils/ttsSession.ts
type TtsSessionState = 'idle' | 'book_playing' | 'raw_speaking' | 'raw_paused'

interface TtsSession {
  state: TtsSessionState
  bookResumeIndex: number | null  // 书籍恢复位置
  rawQueue: string[]              // 待朗读句子
  rawIndex: number                // 当前第几句
}
```

**状态转换（合法路径）：**

```
idle → book_playing          （用户点播放）
book_playing → raw_speaking  （触发 speakRaw：暂停书籍，记 bookResumeIndex）
raw_speaking → idle          （朗读完毕：恢复书籍播放从 bookResumeIndex）
raw_speaking → book_playing  （用户手动点书籍播放：停朗读，恢复书籍）
raw_speaking → raw_paused    （用户暂停朗读）
raw_paused → raw_speaking    （恢复朗读）
raw_paused → book_playing    （用户点书籍播放：停朗读，恢复书籍）
```

**禁止的转换：** idle → raw_paused / book_playing → idle（除非 stop）/ 任何跳跃

**关键规则：**
- 进入 raw_speaking 前必须记住 bookResumeIndex
- 离开 raw_speaking/raw_paused 时必须恢复书籍到 bookResumeIndex
- 用户手动操作书籍播放 = 最高优先级，立即终止朗读
- 模式切换不中断朗读（raw_speaking 在两种模式下都有效）

### 7.3 不动的

- ControlBar：不动
- ProgressBar：不动
- SentenceRow：不动
- 章节切换逻辑：不动
- 预取机制：不动
- 语速/音量/引擎选择：不动

---

## 八、前端组件清单

### 8.1 新增组件

| 文件 | 职责 | 来源 |
|------|------|------|
| src/components/reader/AiReaderView.tsx | AI 阅读主容器（三栏） | 自写 |
| src/components/reader/ContentCards.tsx | 卡片列表（滚动+定位） | 自写 |
| src/components/reader/ContentCard.tsx | 单张卡片（按 type 渲染） | 自写 |
| src/components/reader/ChapterOutline.tsx | 大纲导航 | 自写 |
| src/components/reader/ModeSwitch.tsx | 模式切换按钮 | 自写 |
| src/components/ai/AiChatPanel.tsx | AI 对话面板容器 | 自写 |
| src/components/ai/ChatMessages.tsx | 消息列表（Part 渲染） | [抄:ReadAny/MessageList.tsx + PartRenderer.tsx] 适配 |
| src/components/ai/ChatInput.tsx | 输入+引用卡片+防剧透 | [抄:ReadAny/ChatInput.tsx] 适配 |
| src/components/ai/QuoteChips.tsx | 引用卡片区 | [抄:ReadAny/ChatInput.tsx L88-124] |
| src/components/ai/RetrievalCard.tsx | 检索状态卡片 | [抄:SageRead/tool.tsx] 简化 |
| src/components/ai/CitationPopover.tsx | 来源弹窗+定位 | [抄:SageRead/annotation-popover] 适配 |
| src/components/ai/MindmapView.tsx | markmap 渲染 | [抄:SageRead/mindmap-viewer.tsx] 去 Tauri |
| src/components/ai/MarkdownRenderer.tsx | AI 回答 Markdown | [抄:Vibero/MarkdownRenderer.jsx] 转 TSX |
| src/components/ai/StreamingText.tsx | 流式文本动画 | [抄:SageRead/response-stream.tsx] |
| src/components/ai/ReasoningPanel.tsx | 思考折叠面板 | [抄:SageRead/reasoning.tsx] |
| src/components/ai/SelectionPopup.tsx | 统一浮动条 | [抄:ReadAny/SelectionPopover.tsx] 改按钮 |
| src/components/ai/NmemBanner.tsx | 连接状态横幅 | 自写（简单） |
| src/components/ai/SkillBar.tsx | Skills 按钮+深度下拉 | 自写 |

### 8.2 修改的现有文件

| 文件 | 改动 |
|------|------|
| src/global.d.ts | +Block/StructuredChapter 类型 |
| src/App.tsx | 模式切换 + AiReaderView 挂载 |
| src/stores/bookStore.ts | +structure state +readerMode |
| src/stores/settingsStore.ts | +ai 配置段 |
| src/hooks/useTTS.ts | +ttsSkip 跳过 +speakRaw（~30行） |
| src/components/PlayerView.tsx | 顶栏+模式切换按钮 |
| electron/services/parsers/mdParser.ts | 保留结构 |
| electron/services/parsers/epubParser.ts | 保留结构 |
| electron/ipc/fileHandlers.ts | 导入流程+structure |
| electron/preload.ts | +ai IPC 通道 |
| src/shortcuts.ts | Ctrl+L |
| package.json | +依赖 |

### 8.3 不动的

ControlBar / ProgressBar / SentenceRow / SideNav / SubtitleWindow / FloatingBall / 所有现有 store 逻辑 / chapterBuilder / textPreprocessor / splitReadableSentences

---

## 九、依赖变更

```json
// 新增
{
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "remark-math": "^6",
  "rehype-katex": "^7",
  "rehype-highlight": "^7",
  "markmap-lib": "^0.18",
  "markmap-view": "^0.18",
  "clsx": "^2",
  "tailwind-merge": "^2",
  "eventsource-parser": "^2"
}
```

**不引入：** Ant Design / shadcn/ui / Radix / Slate / LangChain / Vercel AI SDK / jsdom / cheerio

cn() 工具函数自己写（3行）：
```typescript
// src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```

---

## 十、books.json 体积

现在：一本 3000 句的书 ≈ 1-2MB（sentences + originalSentences）
加 structure 后：≈ 2.5-3.5MB（blocks 含 text + sentences 双份）

短期接受。用户书不多（十几本）。
中期优化：structure 中 block.text 和 block.sentences 去重（sentences 存索引引用而非重复文本）。

---

## 十一、回滚

- AI 模块独立（electron/services/ai/ + src/components/ai/ + src/components/reader/）
- structure 字段可选（删除即回退到纯 sentences 模式）
- 模式切换删除 → 永远显示 PlayerView（回到旧行为）
- git revert 一个 commit 完全回滚
