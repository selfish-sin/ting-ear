# AI 阅读重构 — 执行计划（6 切片）

> 全部代码自己写（参考项目许可证不允许复制：ReadAny=GPLv3, SageRead=AGPLv3, Vibero/ai-book-reader=无LICENSE）。
> 每切片独立可回滚，做完 typecheck+lint+dev 通过再 commit。
> 一期 = 切片 A-F。二期 = Skills/思维导图/深度控制/字幕联动/PDF→MD 预处理。

---

## 切片 A：结构契约、解析器和旧书 fallback

**目标：** 导入 MD/EPUB 后 BookData 含正确的 structure，sentences/chapters 从 structure 派生。旧书/版本切换时 structure 自动失效重建。

### 步骤

A1. `src/global.d.ts` 新增类型
```typescript
type BlockType = 'heading'|'paragraph'|'footnote'|'endnote'|'quote'|'list'|'code'|'page_break'|'toc_entry'

interface Block {
  blockId: string               // 稳定 ID（uuid，导入时生成，不随版本变）
  type: BlockType
  level?: number                // heading 1-6
  text: string                  // 原始文本（唯一文本存储点）
  ttsSkip: boolean
  sentenceRange: [number, number]  // 在全局 sentences[] 中的 [start, end)
  meta?: Record<string, string>
}

interface StructuredChapter {
  title: string
  level: number
  blocks: Block[]
  sentenceRange: [number, number]
}

interface StructureMeta {
  schemaVersion: 1              // 结构格式版本
  contentHash: string           // sentences 内容的 hash（SHA-256 前 16 位）
  sourceFormat: string          // 'md' | 'epub' | 'pdf' | 'pseudo'
}

// BookData 扩展
interface BookData {
  // ...现有字段不动...
  structure?: StructuredChapter[]
  structureMeta?: StructureMeta
}
```

A2. 创建 `src/utils/contentHash.ts`
- `hashSentences(sentences: string[]): string` — 拼接后 SHA-256 取前 16 位
- 用于校验 structure 是否与当前 sentences 匹配

A3. 创建 `electron/services/parsers/structureBuilder.ts`
- `deriveSentences(structure): string[]` — 遍历 blocks，对每个 block.text 调 splitReadableSentences，填充 sentenceRange
- `deriveChapters(structure): Chapter[]` — 从 sentenceRange 计算
- `validateStructure(book: BookData): boolean` — 比对 structureMeta.contentHash 与当前 sentences hash
- `invalidateStructure(book): void` — 删除 structure + structureMeta
- `generatePseudoStructure(sentences, chapters): { structure, structureMeta }` — 旧书 fallback（每章内每 5 句→paragraph block）

A4. 改造 `electron/services/parsers/mdParser.ts`
- 新增 `parseMarkdownToStructure(raw: string): StructuredChapter[]`
- 逐行解析（MD 格式简单，逐行就是正确方法，不是"降级"）：
  - `/^#{1,6}\s+(.+)/` → heading block (level=#数量)
  - 空行分隔 → paragraph block
  - `/^\[\^(\w+)\]/` → footnote block (ttsSkip=true)
  - `/^>\s/` → quote block
  - `/^```/` → code block (ttsSkip=true)
  - `/^[-*+]\s/` → list block
- 每个 block 只存 text，sentences 由 structureBuilder.deriveSentences 统一拆
- 输出 BookData 含 structure + structureMeta（contentHash + sourceFormat:'md'）

A5. 改造 `electron/services/parsers/epubParser.ts`
- 新增依赖：`fast-xml-parser`（零依赖、20KB、MIT 许可证）
- 新增 `parseXhtmlToBlocks(xhtml: string): Block[]`
- 用 fast-xml-parser 解析 XHTML → 遍历节点：
  - h1-h6 → heading
  - p → paragraph
  - aside / [epub:type="footnote"] / .footnote → footnote (ttsSkip=true)
  - blockquote → quote
  - pre/code → code (ttsSkip=true)
  - 文本节点 → paragraph
- 保留原 stripHtml 路径作为 fallback（解析失败时降级）
- 输出含 structure + structureMeta（sourceFormat:'epub'）

A6. 修改 `electron/ipc/fileHandlers.ts`
- 导入后：有 structure → deriveSentences + deriveChapters + 计算 contentHash
- 无 structure（PDF/TXT）→ 现有逻辑 + generatePseudoStructure
- 重复导入（同 filePath）：比对 contentHash，变了则 invalidateStructure + 重建

A7. 修改 `src/utils/bookData.ts` 的 normalizeBookData
- 运行时校验：如果 structure 存在但 contentHash 不匹配当前 sentences → invalidateStructure + generatePseudoStructure
- 版本切换（editHistory）：切到非当前版本时 invalidateStructure（因为 sentences 变了）
- 切回主版本时：如果 structureMeta.contentHash 匹配则恢复，否则重建

A8. 测试
- `tests/structureBuilder.test.ts`：deriveSentences 正确填充 sentenceRange；validateStructure hash 不匹配返回 false；generatePseudoStructure 合理
- `tests/mdParserStructure.test.ts`：fixture 含 #/##/脚注/引用/代码块，验证层级+ttsSkip+sentenceRange 连续
- `tests/epubParserStructure.test.ts`：fixture 含 h1/p/footnote 的 XHTML，验证 block 类型
- `tests/structureVersionMismatch.test.ts`：模拟 sentences 被 editHistory 修改后 structure 自动失效

**验证：** `npm run typecheck && npm run test && npm run dev` → 导入 MD/EPUB 后 console.log(book.structure) 正确

**回滚：** git revert。structure 是可选字段，删除后回到纯 sentences 模式。

---

## 切片 B：只读 AI 阅读页、大纲、卡片和模式切换

**目标：** 打开书默认看到结构化卡片 + 大纲导航。可切换到听书模式（现有 PlayerView）。

### 步骤

B1. 创建 `src/utils/cn.ts`（clsx + tailwind-merge）

B2. 扩展 `src/stores/bookStore.ts`
- +`readerMode: 'ai-reading' | 'listening'`（默认 'ai-reading'）
- +`setReaderMode(mode)`

B3. 创建 `src/components/reader/ContentCard.tsx`
- 按 block.type 渲染：heading(大字号粗体) / paragraph(白底卡片) / footnote(小字灰底折叠) / quote(左边框) / code(等宽深底) / list(缩进)
- 当前播放句所在卡片：border-l-4 border-primary + bg-primary/5
- 卡片内当前句高亮：bg-primary/10

B4. 创建 `src/components/reader/ContentCards.tsx`
- 从 structure 渲染卡片列表，无 structure 用 pseudoStructure fallback
- 自动滚动到当前播放句所在卡片

B5. 创建 `src/components/reader/ChapterOutline.tsx`
- 章节树，点击→滚动到对应卡片，当前章高亮，可折叠

B6. 创建 `src/components/reader/ModeSwitch.tsx`
- [AI 阅读] [听书] pill 按钮组

B7. 创建 `src/components/reader/AiReaderView.tsx`
- 三栏 flex：Outline + Cards + 右侧预留（切片 C 填 AI 面板）

B8. 修改 `src/App.tsx`
- readerMode 切换 AiReaderView / PlayerView
- ProgressBar + ControlBar 全宽不动

B9. 修改 `src/components/PlayerView.tsx`
- 顶栏新增 ModeSwitch

B10. 测试
- `tests/modeSwitch.test.ts`：切换后 playState/index 不变；两种模式渲染正确

**验证：** 导入 MD → 默认卡片 → 大纲跳转 → 切听书 → 句子列表 → 切回 → 卡片还在

**回滚：** git revert。删除 readerMode 后永远显示 PlayerView。

---

## 切片 C：OpenAI 兼容直聊、流式 IPC、取消和历史

**目标：** AI 对话面板可用。纯 LLM 直聊（无 RAG），流式输出，可取消，历史持久化。

### 步骤

C1. 创建 `electron/services/ai/ai-config.ts`
- AiSettings（nmem/llm/retrieval/chat 四段）+ AI_DEFAULTS + getAiSettings()
- 路由正则 patterns 可配置

C2. 创建 `electron/services/ai/llm-caller.ts`（自己写）
- streamChat(config, messages, signal): AsyncGenerator<string>
- fetch + ReadableStream + 逐行解析 data: {...}
- 错误分类：401→auth_failed, 429→rate_limited, timeout→timeout, 5xx→model_error, 网络断→network_error
- AbortSignal 取消 + fallbackModel

C3. 创建 `electron/services/ai/ai-service.ts`（一期简化）
- chat(requestId, payload, webContents)
- 流程：构建 prompt → llm stream → 逐 chunk 发 IPC
- 问题路由（简化）：greeting 跳过 autoContext
- cancel(requestId)

C4. 创建 `electron/ipc/aiHandlers.ts`
- ai:chat / ai:chat:chunk(含 requestId+seq) / ai:chat:done / ai:chat:error / ai:cancel(requestId) / ai:history:get / ai:history:clear

C5. 修改 `electron/preload.ts`
- window.api.ai* 暴露（含 unsubscribe 返回）

C6. 扩展 `src/stores/settingsStore.ts` +ai 段

C7. 创建 `src/stores/aiStore.ts`
- messages(Part结构) / isStreaming / currentRequestId
- sendMessage / cancelStream / 历史加载保存

C8. 创建 `src/components/ai/AiChatPanel.tsx`（容器）

C9. 创建 `src/components/ai/ChatMessages.tsx`（自己写）
- Part 渲染 + react-markdown + 流式追加 + 光标动画 + 自动滚底 + 错误消息

C10. 创建 `src/components/ai/ChatInput.tsx`（自己写）
- textarea + Enter 发送 + IME 处理 + 发送/停止按钮

C11. 修改 AiReaderView 右侧挂载 AiChatPanel

C12. 设置页新增 AI 配置（llm + chat 段）

C13. 测试
- `tests/llmCaller.test.ts`：mock fetch，SSE 解析+错误分类+取消
- `tests/ipcStreaming.test.ts`：chunk seq 递增；cancel 只取消对应 requestId
- `tests/settingsDeepMerge.test.ts`：AI_DEFAULTS + 部分配置深合并

**验证：** 填 API Key → 提问 → 流式回答 → 停止 → 关闭重开历史还在

**回滚：** git revert。删除 aiHandlers + AiChatPanel。

---

## 切片 D：nmem ingest/search、引用定位、离线降级和防剧透

**目标：** 对话带 RAG，来源可定位，nmem 离线降级，防剧透硬过滤。

### 步骤

D1. 创建 `electron/services/ai/nmem-bridge.ts`（自己写）
- nmem HTTP 契约（已实测，无鉴权）：
  - GET /health → 200
  - GET /memories/search?q=&limit= → {memories:[{id,content,source,score}]}
  - POST /sources/ingest/content {content,name,source_type} → {source_id,is_duplicate}
- 超时：health 5s / search 30s / ingest 120s
- 健康检查轮询 + 状态缓存

D2. 创建 `electron/services/ai/ingest-service.ts`
- 按章灌入，name 编码 metadata：`[bookId={id}][ch={N}] {title}`
- is_duplicate 跳过

D3. 修改 ai-service.ts
- 检索 → **防剧透硬过滤**（ch > currentChapter 的结果删除）→ 发 ai:chat:sources → prompt 注入 → stream
- 新增 IPC：ai:chat:sources { requestId, sources: SourceRef[] }

D4. 创建 `src/components/ai/RetrievalCard.tsx`（searching→done 两态）

D5. 创建 `src/components/ai/CitationPopover.tsx`
- [N] 药丸 → Popover → [定位] → 滚动到对应卡片

D6. 创建 `src/components/ai/NmemBanner.tsx`（离线黄色横幅）

D7. fileHandlers：导入后 autoIngest

D8. 设置页：nmem + retrieval 段

D9. aiStore：+nmemStatus / +spoilerFree / +currentSources / 监听 ai:chat:sources

D10. 测试
- `tests/nmemBridge.test.ts`：mock HTTP，search/ingest/health/超时/ECONNREFUSED
- `tests/nmemContract.test.ts`：请求格式+响应解析
- `tests/spoilerFilter.test.ts`：ch 过滤逻辑

**验证：** nmem 启动 → 导入书 → 提问 → 检索卡片 → [N] 定位 → 关 nmem → 横幅 → 仍可聊

**回滚：** git revert。nmem 代码独立，删除后回到纯 LLM。

---

## 切片 E：选中引用

**目标：** 选中→浮动条→引用卡片→组合提问。

### 步骤

E1. 创建 `src/components/ai/SelectionPopup.tsx`（自己写）
- mouseup + selection>2字符 → 浮动条 [复制][引用][问AI]
- 视口钳制 + Esc/空白/滚动消失
- 替代现有 copy bubble

E2. 创建 `src/components/ai/QuoteChips.tsx`（引用卡片区，最多5张）

E3. 修改 ChatInput：集成 QuoteChips，发送时 quotes 注入 message

E4. aiStore：+quotes[] + addQuote/removeQuote/clearQuotes

E5. ai-service：quotes→category='selection'，引用为主上下文

E6. 自动上下文：aiStore 订阅 playerStore，发送时快照 autoContext

E7. 测试：手动验证选中→引用→组合→发送

**验证：** 选中→[引用]→卡片→再选→[问AI]→输入→发送→基于引用回答

**回滚：** git revert。删除 SelectionPopup + QuoteChips。

---

## 切片 F：ttsSkip、卡片朗读和 AI 回答朗读

**目标：** TTS 跳过脚注，卡片/回答可朗读，互斥状态机正确。

### 步骤

F1. 创建 `src/utils/ttsSession.ts`（自己写）
- 独占播放会话状态机：idle / book_playing / raw_speaking / raw_paused
- 转换规则：
  - book_playing → raw_speaking（暂停书籍，记位置）
  - raw_speaking → idle（朗读完，恢复书籍）
  - raw_speaking → book_playing（用户点播放，停朗读，恢复书籍）
  - raw_speaking ↔ raw_paused
- **禁止** stopPlayback 后假定可恢复，必须走状态机

F2. 修改 `src/hooks/useTTS.ts`
- skipEmptyForward + isTtsSkip（查 structure block.ttsSkip）
- speakRaw(text, onSentence?, onEnd?)：通过 ttsSession 管理
- stopRaw()

F3. ContentCard：[▶] 按钮 → speakRaw(block.text)，朗读中逐句高亮

F4. ChatMessages：assistant 消息 [🔊] → 清洗文本 → speakRaw

F5. aiStore：+speakingMessageId

F6. PlayerView：ttsSkip 句子灰显

F7. 测试
- `tests/ttsSession.test.ts`：状态机所有路径+非法转换拒绝
- `tests/ttsSkip.test.ts`：有/无 structure 的跳过行为
- `tests/modeSwitchPlayback.test.ts`：播放中切模式连续性

**验证：** 脚注跳过 → 卡片[▶]朗读 → 点播放停朗读恢复书籍 → AI回答[🔊]朗读 → 完成恢复

**回滚：** git revert。删除 ttsSession + speakRaw。

---

## 二期内容（不在本次执行范围）

| 功能 | 依赖 | 预估 |
|------|------|------|
| Skills 系统（预设问答 + CRUD） | 切片 C | 2天 |
| 思维导图 Skill（markmap） | Skills + B | 1.5天 |
| 深度控制（概要/标准/详细） | Skills | 0.5天 |
| 语义上下文压缩 | 切片 C | 1天 |
| PDF→MD 预处理（pymupdf4llm） | 切片 A | 2天 |
| LLM 结构标注（OCR TXT） | 切片 A | 1天 |
| 字幕窗口联动 | 切片 F | 1天 |
| 跨书联合检索 UI | 切片 D | 1天 |
| 知识图谱可视化 | nmem graph | 3天 |

---

## 依赖新增（一期）

```json
{
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "fast-xml-parser": "^4",
  "clsx": "^2",
  "tailwind-merge": "^2"
}
```

二期再加：markmap-lib / markmap-view / rehype-katex / rehype-highlight / remark-math

## 新增文件（一期，~24 个源码 + 14 个测试）

```
源码:
  electron/services/parsers/structureBuilder.ts
  electron/services/ai/ai-config.ts
  electron/services/ai/nmem-bridge.ts
  electron/services/ai/llm-caller.ts
  electron/services/ai/ai-service.ts
  electron/services/ai/ingest-service.ts
  electron/ipc/aiHandlers.ts
  src/utils/cn.ts
  src/utils/contentHash.ts
  src/utils/ttsSession.ts
  src/stores/aiStore.ts
  src/components/reader/AiReaderView.tsx
  src/components/reader/ContentCards.tsx
  src/components/reader/ContentCard.tsx
  src/components/reader/ChapterOutline.tsx
  src/components/reader/ModeSwitch.tsx
  src/components/ai/AiChatPanel.tsx
  src/components/ai/ChatMessages.tsx
  src/components/ai/ChatInput.tsx
  src/components/ai/QuoteChips.tsx
  src/components/ai/SelectionPopup.tsx
  src/components/ai/RetrievalCard.tsx
  src/components/ai/CitationPopover.tsx
  src/components/ai/NmemBanner.tsx

测试:
  tests/structureBuilder.test.ts
  tests/mdParserStructure.test.ts
  tests/epubParserStructure.test.ts
  tests/structureVersionMismatch.test.ts
  tests/modeSwitch.test.ts
  tests/llmCaller.test.ts
  tests/ipcStreaming.test.ts
  tests/settingsDeepMerge.test.ts
  tests/nmemBridge.test.ts
  tests/nmemContract.test.ts
  tests/spoilerFilter.test.ts
  tests/ttsSession.test.ts
  tests/ttsSkip.test.ts
  tests/modeSwitchPlayback.test.ts
```
