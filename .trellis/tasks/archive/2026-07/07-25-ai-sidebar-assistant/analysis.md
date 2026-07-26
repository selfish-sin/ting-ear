# AI 阅读重构 — 代码分析与实现路径

> 基于 ting-ear 真实代码 + 4 个参考项目（ReadAny / SageRead / ai-book-reader / Vibero）的深度分析。
> 本文档为设计定稿前的决策依据，不是执行计划。

---

## 一、现状：代码里到底有什么

### 1.1 数据模型（核心）

```typescript
// src/global.d.ts — 整个应用的数据骨架
interface BookData {
  sentences: string[]          // 纯文本平铺数组，无任何元数据
  chapters: Chapter[]          // { title, startIndex, sentenceCount } — 只是索引范围
  timeMap?: number[]           // 每句时长(ms)
  currentSentenceIndex: number // 全局句索引
  // ...progress, bookmarks, editHistory
}
```

**关键事实：**
- 句子是裸字符串，没有 ID、没有类型、没有段落归属、没有格式
- 章节只是"第 N 句到第 M 句"的范围标记
- 整本书（含全部句子）序列化在一个 `books.json` 里
- 没有数据库，没有单书文件，全量加载到内存

### 1.2 Parser 做了什么、丢了什么

| 格式 | 识别了什么 | 丢掉了什么 |
|------|-----------|-----------|
| EPUB | TOC 锚点→章节切分、封面 | **HTML 结构全丢**：h1-h6 层级、段落边界、脚注、粗斜体、列表、表格 |
| MD | `#` 标题→章节切分 | **标题层级丢失**（h1 和 h3 同等对待）、段落分组、引用块、列表、脚注 |
| PDF | 书签/大纲→章节、字号（未用） | 所有格式、段落、表格、多栏、页码结构 |
| DOCX | 仅 extractRawText（最损模式） | **一切结构**：标题样式、脚注、列表、表格、分节 |

**核心问题：EPUB 和 MD 的结构本来就在文件里，是 parser 主动拍平的。**

### 1.3 TTS 怎么消费数据

```
useTTS hook:
  读 bookStore.sentences[globalIndex] → 纯文本
  → IPC ttsSynthesize(text, voice, speed) → base64 audio
  → Audio 播放 → onended → playSentence(index + 1)
  → 到 chapter 边界停止（不自动跨章）
  → 预取后续 5 句
```

**TTS 只需要：一个 string[] + 全局索引 + 章节边界。** 它不关心结构、格式、段落。

### 1.4 PlayerView 怎么渲染

```
sentences.slice(bounds.start, bounds.end).map((text, i) =>
  <SentenceRow sentence={text} index={globalIndex} isActive={...} />
)
```

逐句渲染，行号 + 纯文本 + 高亮当前播放句。无段落分组、无标题样式、无折叠。

---

## 二、目标：要变成什么

### 2.1 新范式

- **主页面 = AI 阅读**：结构化卡片（标题/正文/脚注分层）+ AI 对话
- **TTS = 附属模块**：朗读是"消费内容"的一种方式，不是页面的骨架
- **听书模式 = 现有界面微调**：句子列表 + ControlBar，基本不动

### 2.2 用户实际格式

| 格式 | 频率 | 结构来源 |
|------|------|---------|
| MD | 高 | `#` `##` `###` 标题 + 空行分段 + `[^1]` 脚注 |
| PDF→MD | 高 | 转换后同 MD |
| EPUB | 中 | HTML 标签（h1-h6, p, aside.footnote） |
| DOCX/TXT | 极低 | 暂不考虑 |

**结论：不需要"智能识别结构"。三种主力格式的结构都是白给的。**

### 2.3 新数据模型（概念）

```
Book
├── meta: { title, author, cover, ... }
├── structure: Chapter[]
│   └── Chapter
│       ├── title: string
│       ├── blocks: Block[]
│       │   └── Block
│       │       ├── type: 'heading' | 'paragraph' | 'footnote' | 'quote' | 'list' | 'code' | 'page_break'
│       │       ├── level?: number        // heading 层级 (1-6)
│       │       ├── text: string          // 完整文本
│       │       ├── sentences: string[]   // TTS 用：拆好的句子
│       │       ├── ttsSkip: boolean      // TTS 是否跳过
│       │       └── meta?: {}             // 脚注编号、链接等
│       └── sentenceRange: [start, end]   // 在全局 sentences[] 中的范围
├── sentences: string[]                   // 保留！TTS 仍读这个（从 structure 派生）
├── chapters: Chapter[]                   // 保留！兼容现有索引逻辑
└── ttsConfig: { skipTypes: string[] }    // 哪些 block type 不读
```

**双层设计：structure 给 UI/AI 用，sentences 给 TTS 用。sentences 从 structure 派生，不是独立维护。**

---

## 三、实现路径（多方案对比）

### 方案 A：完全重构数据模型

**做法：** 废弃 `sentences: string[]`，全面改为结构树。TTS 遍历树中 ttsSkip=false 的 sentences。

**改动范围：**
- 所有 parser 重写（输出结构树而非平铺数组）
- BookData 接口重新定义
- books.json 格式变更（需迁移或重导入）
- useTTS 重写（从树遍历取代 index+1）
- PlayerView 重写（卡片渲染取代句子列表）
- ProgressBar 重写（时间模型基于树遍历）
- bookStore/playerStore 重写
- 所有引用 `sentences[index]` 的代码（搜索、书签、导出、编辑历史）

**工程量：** 极大。估计 3-4 周全职。涉及 30+ 文件。

**质量：** 最高。干净、无历史包袱、扩展性好。

**风险：** 极高。任何一环出错整个应用不可用。无法增量交付。

**参考项目：** ReadAny 走的就是这条路（从零设计结构树 + Part 消息 + LangGraph Agent）。但 ReadAny 是全新项目，没有历史代码。

---

### 方案 B：双层共存（structure 叠加在 sentences 上）

**做法：** 保留 `sentences: string[]` 不动。新增 `structure: StructuredChapter[]` 字段。UI 从 structure 渲染，TTS 继续读 sentences。导入时 parser 同时生成两者。

**改动范围：**
- Parser 改造：输出 structure + 派生 sentences（EPUB/MD 保留结构，不再拍平）
- BookData 新增 `structure` 字段（可选，旧书没有）
- 新增 AI 阅读页面（从 structure 渲染卡片）
- 听书模式（PlayerView）基本不动
- useTTS 不动（仍读 sentences[]）
- bookStore 新增 structure 相关 state
- 导入流程：生成 structure → 派生 sentences → 两者都存

**工程量：** 中等。估计 2-2.5 周。核心改动在 parser + 新 UI 页面。

**质量：** 高。TTS 零风险（完全不动），新页面可以慢慢打磨。

**风险：** 中。structure 和 sentences 的一致性需要保证（派生关系，不是独立维护）。旧书没有 structure → 需要 fallback（用 sentences 生成伪结构）。

**参考项目：** SageRead 的做法（EPUB 用 Foliate 渲染原始结构，AI 功能叠加在上面，TTS 独立模块）。Vibero 也是（PDF 原文不动，AI chat 是附加层）。

**关键优势：TTS 完全不碰。** 用户说"做最小改动"——这就是最小改动。

---

### 方案 C：最小改动（sentences 加类型标注）

**做法：** 不改数据结构。给每句话加一个平行数组 `sentenceTypes: string[]`（'heading'|'body'|'footnote'|...）。UI 根据 type 分组渲染卡片。

**改动范围：**
- Parser 改造：输出 sentences 时同时输出 sentenceTypes
- BookData 新增 `sentenceTypes?: string[]`
- PlayerView 可选按 type 分组显示（或新建一个 CardView 组件）
- useTTS 不动
- 新增 AI 面板（侧边栏或分栏）

**工程量：** 小。估计 1-1.5 周。

**质量：** 中。能实现基本的卡片化，但表达力有限（无法表示嵌套结构、段落内多句、脚注关联）。

**风险：** 低。几乎不碰现有逻辑。

**参考项目：** ai-book-reader 的做法（flat chunk + metadata 标注，不做结构树）。

**局限：** 标题层级（h1 vs h3）只能靠 type 字符串区分，无法自然表达树形嵌套。卡片折叠、大纲导航做起来别扭。

---

### 方案 D：渐进式（先 B 后 A）

**做法：** 一期用方案 B（双层共存），快速上线 AI 阅读页面。二期根据实际使用体验决定是否完全迁移到结构树（方案 A）。

**一期（2 周）：**
- Parser 输出 structure + sentences
- AI 阅读页面（卡片 + AI 对话）
- 听书模式不动
- 模式切换

**二期（视需求）：**
- 如果双层运行良好 → 保持现状
- 如果需要更深度的结构操作（拖拽重排、编辑结构、跨章引用）→ 迁移到方案 A

**工程量：** 一期 2 周，二期 0-2 周（视决策）。

**质量：** 一期高，二期可选最高。

**风险：** 低→中。一期风险同 B，二期风险同 A（但已有经验）。

**参考项目：** 这是最务实的路径。SageRead 和 Vibero 都是"现有阅读器 + AI 附加层"的模式，没有重构阅读器本身。

---

## 四、各角度对比

### 4.1 工程量最小

**方案 C > 方案 B > 方案 D > 方案 A**

方案 C 只加一个平行数组，一周能做完。但效果有限。

### 4.2 效果最好

**方案 A > 方案 D(二期) > 方案 B > 方案 C**

方案 A 最干净，但代价是 3-4 周 + 极高风险。

### 4.3 风险最低

**方案 C > 方案 B > 方案 D > 方案 A**

方案 C 几乎不碰现有代码。方案 B 的 TTS 也不碰，但 parser 改动较大。

### 4.4 最适合 ting-ear 现状

**方案 B（双层共存）**，理由：
1. 用户说"已导入可以全删重导" → 无迁移负担
2. 用户格式（MD/EPUB）结构白给 → parser 改造不难
3. 用户说"TTS 做最小改动" → sentences[] 不动，useTTS 不动
4. 用户说"AI 阅读是主体" → 新页面从 structure 渲染，不受旧模型限制
5. 听书模式 = 现有界面 → PlayerView 基本不动

### 4.5 从 4 个项目学到的

| 项目 | 它怎么做的 | ting-ear 能抄什么 |
|------|-----------|-----------------|
| ReadAny | 全新结构树 + Part 消息 + LangGraph | 卡片渲染思路、Part 消息结构、引用导航 |
| SageRead | Foliate 渲染原始 EPUB + AI 叠加 | **双层共存思路**（阅读器不动，AI 是附加层） |
| Vibero | PDF 原文 + VibeCard 引用 + AI chat | 卡片引用交互、@mention、大纲导航 |
| ai-book-reader | flat chunk + Map-Reduce | 深度控制、渐进摘要（作为 Skill） |

**SageRead 的模式最接近 ting-ear 的需求：** 保留现有阅读能力（Foliate/TTS），AI 功能作为独立层叠加。不重构阅读器本身。

---

## 五、方案 B 具体要改什么（基于真实代码）

### 5.1 Parser 改造

**epubParser.ts（改动最大）：**

现在：`stripHtml(html) → splitReadableSentences(text) → string[]`
改为：`parseHtmlStructure(html) → Block[] → 派生 sentences[]`

```typescript
// 新增：保留 HTML 结构
function parseHtmlToBlocks(html: string): Block[] {
  // h1-h6 → { type: 'heading', level: N, text, sentences }
  // p → { type: 'paragraph', text, sentences }
  // aside.footnote / [epub:type="footnote"] → { type: 'footnote', ... }
  // blockquote → { type: 'quote', ... }
  // ul/ol → { type: 'list', ... }
  // 其他 → { type: 'paragraph', ... }
}
```

**mdParser.ts（改动中等）：**

现在：`# 标题` → 章节切分 → 全部拍平为句子
改为：`# 标题` → heading block，空行分段 → paragraph block，`[^1]` → footnote block

```typescript
function parseMarkdownToBlocks(md: string): Block[] {
  // 逐行解析：
  // /^#{1,6}\s/ → heading block (level = # 数量)
  // 空行分隔 → paragraph block
  // /^\[\^/ → footnote block
  // /^>/ → quote block
  // /^[-*]\s/ → list block
}
```

**pdfParser.ts（改动小）：**
- 用户说 PDF 先转 MD → 走 mdParser 路径
- 或者：保留现有 pdfParser 输出 sentences，structure 用 `detectHeadingBoundaries` 生成伪结构

### 5.2 数据模型变更

```typescript
// 新增类型
interface Block {
  id: string                    // uuid
  type: 'heading' | 'paragraph' | 'footnote' | 'endnote' | 'quote' | 'list' | 'code' | 'page_break' | 'toc_entry'
  level?: number                // heading: 1-6
  text: string                  // 完整文本（含格式标记或纯文本）
  sentences: string[]           // 拆好的句子（TTS 用）
  sentenceStart: number         // 在全局 sentences[] 中的起始索引
  ttsSkip: boolean              // 是否跳过朗读
  children?: Block[]            // 嵌套（如列表项）
  meta?: Record<string, string> // 脚注编号等
}

interface StructuredChapter {
  title: string
  blocks: Block[]
  sentenceRange: [number, number]  // 全局 sentences[] 中的范围
}

// BookData 扩展
interface BookData {
  // ...现有字段全部保留...
  structure?: StructuredChapter[]  // 新增！可选（旧书没有）
}
```

**向后兼容：** `structure` 是可选字段。没有 structure 的旧书 → 听书模式正常（读 sentences），AI 阅读页面用 sentences 生成伪卡片（每 N 句一组）。

### 5.3 useTTS — 不动

```
现有逻辑完全保留：
  sentences[globalIndex] → ttsSynthesize → play → index+1
  章节边界停止
  预取 5 句
  全部不变
```

唯一新增：`ttsSkip` 句子的跳过逻辑。现在 `skipEmptyForward` 跳过空句子，扩展为跳过 `ttsSkip` 句子：

```typescript
// useTTS.ts — 唯一改动
function skipEmptyForward(idx: number): number {
  while (idx < bounds.end && (!sentences[idx]?.trim() || isTtsSkip(idx))) idx++
  return idx
}
```

`isTtsSkip(idx)` 查 structure 中对应 block 的 ttsSkip 标记。无 structure 时永远返回 false（兼容旧书）。

### 5.4 新增 AI 阅读页面

新组件，不碰 PlayerView：

```
src/components/reader/
├── AiReaderView.tsx      # AI 阅读主页面（卡片列表 + AI 对话分栏）
├── ContentCards.tsx      # 左侧：结构化卡片渲染
├── ContentCard.tsx       # 单张卡片（heading/paragraph/footnote 不同样式）
├── ChapterOutline.tsx    # 大纲/目录导航
├── AiChatPanel.tsx       # 右侧：AI 对话（复用之前设计的 ChatMessages/ChatInput）
└── ModeSwitch.tsx        # 模式切换（AI阅读 / 听书）
```

### 5.5 模式切换

```typescript
// bookStore 或新 readerStore
type ReaderMode = 'ai-reading' | 'listening'

// App.tsx 中：
{mode === 'ai-reading' && <AiReaderView />}
{mode === 'listening' && <PlayerView />}  // 现有组件，不动
```

切换时：
- TTS 播放状态保持（不因为切模式而停止）
- 阅读位置同步（ai-reading 的当前卡片 ↔ listening 的当前句子）
- AI 对话历史保持

### 5.6 导入流程变更

```
现在：file → parse → sentences[] + chapters[] → books.json
改为：file → parse → structure[] → 派生 sentences[] + chapters[] → books.json
```

structure 是主数据，sentences 是派生。但两者都存（TTS 读 sentences 不需要每次从 structure 重新派生）。

### 5.7 books.json 体积问题

现在一本书 3000 句 ≈ 1-2MB JSON。加了 structure 后 ≈ 2-3MB（blocks 含 text + sentences 双份）。

**解决方案：**
- 短期：接受体积增加（用户书不多）
- 中期：structure.text 和 sentences 去重（sentences 只存索引引用）
- 长期：迁移到 SQLite 或单书文件（但这不是现在的事）

---

## 六、清洗/结构还原怎么做

### 6.1 重新定义

不是"修错字"，是"还原层次"：
- 标题是标题（heading block, level=N）
- 正文是正文（paragraph block）
- 脚注是脚注（footnote block, ttsSkip=true）
- 页码是页码（page_break block, ttsSkip=true）
- 目录是目录（toc_entry block, ttsSkip=true）

### 6.2 各格式策略

| 格式 | 策略 | 需要 LLM？ |
|------|------|-----------|
| EPUB | 直接读 HTML 标签（h1/p/aside）| 不需要 |
| MD | 直接解析 # 和空行 | 不需要 |
| PDF→MD | 先用 pymupdf4llm/marker 转 MD，再解析 | 不需要（转换工具自带结构识别） |
| 硬 OCR TXT | 免费 LLM 标注结构 | 需要（但用户说 TXT 很少，暂不管） |

### 6.3 PDF→MD 转换

用户说"PDF 可以硬处理成 MD"。工具选择：
- `pymupdf4llm`（Python，本地，免费，识别标题/段落/表格）
- `marker`（Python，本地，效果更好但更重）
- 现有 pdfParser 的 `getPageText` + `detectHeadingBoundaries`（最轻，但结构识别弱）

**建议：** 一期用现有 pdfParser + detectHeadingBoundaries 生成伪结构。二期如果效果不好，引入 pymupdf4llm 做 PDF→MD 预处理。

### 6.4 现有 TextCleanerView 的命运

保留，但定位变化：
- 不再是"必须手动清洗才能用"
- 变成"极端 case 的微调工具"（比如 OCR 乱码太多，LLM 也修不好）
- 低优先级，不改

---

## 七、与 4 个参考项目的对应关系

### 7.1 从 ReadAny 抄什么

| ReadAny 的做法 | ting-ear 怎么用 | 在哪个方案里 |
|---------------|----------------|------------|
| 结构树（Chapter > Section > Chunk） | structure: StructuredChapter > Block | 方案 B 的数据模型 |
| Part 消息（TextPart/CitationPart/ToolCallPart） | AI 对话消息用 Part 结构 | AI 对话设计（已定） |
| Citation-as-Navigation（[N]→跳转） | [N] 药丸→跳转到对应 Block | AI 对话设计（已定） |
| Question Category Router | 问题路由（正则分类） | ai-service（已定） |
| Spoiler-Free Mode | 防剧透（按 chapterIndex 过滤） | ai-service（已定） |
| SelectionPopover → AttachedQuote | 选中→引用卡片 | 交互设计（已定） |
| Reading Context Service（自动感知当前位置） | aiStore 订阅 playerStore | TTS 集成（已定） |

### 7.2 从 SageRead 抄什么

| SageRead 的做法 | ting-ear 怎么用 |
|----------------|----------------|
| **Foliate 渲染原始 EPUB + AI 叠加** | **双层共存：sentences(TTS) + structure(AI阅读)** |
| Annotation Popover + searchAndNavigate | CitationPopover + 阅读器定位 |
| Mindmap (markmap) | 思维导图 Skill |
| Provider Factory（多模型切换） | ai-config 的 llm 段（已设计） |
| Semantic Context Compression | 语义压缩（已设计） |
| TTS for AI responses | speakRaw 复用现有引擎（已设计） |

### 7.3 从 Vibero 抄什么

| Vibero 的做法 | ting-ear 怎么用 |
|--------------|----------------|
| VibeCard @mention（多引用组合） | QuoteChips 引用卡片（已设计） |
| 大纲导航（PDF outline → 跳转） | ChapterOutline 组件（新增） |
| 可折叠内容区 + 右侧 AI chat | AiReaderView 布局（新增） |
| Paper context auto-injection | 自动上下文（当前卡片/句子注入 prompt） |
| Drag-to-reference | 一期不做（点击引用够了），二期可选 |

### 7.4 从 ai-book-reader 抄什么

| ai-book-reader 的做法 | ting-ear 怎么用 |
|---------------------|----------------|
| Depth control（conceptual/standard/detailed） | Skill 深度选项（已设计） |
| Map-Reduce progressive summary | "全书概览" Skill 的实现策略（可选） |
| Sliding window integration | 长文摘要时的分段合并策略（可选） |

---

## 八、决策建议

### 推荐：方案 B（双层共存）+ 方案 D 的渐进思路

**一期（本次任务）：**
1. Parser 改造（EPUB/MD 保留结构 → Block[]）
2. BookData 新增 structure 字段
3. AI 阅读页面（卡片 + AI 对话 + 大纲）
4. 模式切换（AI 阅读 / 听书）
5. AI 后端服务（nmem + LLM + 问题路由 + 防剧透）
6. 交互模式（引用卡片 + 来源导航 + 检索透明 + 思维导图）
7. TTS 最小适配（ttsSkip 跳过 + speakRaw）

**不动的：**
- useTTS 核心逻辑
- PlayerView（听书模式）
- ControlBar / ProgressBar
- 句子分割逻辑（splitReadableSentences）
- 章节构建逻辑（chapterBuilder）— 从 structure 派生 chapters

**二期（视体验）：**
- PDF→MD 预处理（pymupdf4llm）
- LLM 结构标注（给 OCR TXT 用）
- 完全结构树迁移（如果双层不够用）
- 字幕窗口联动
- 拖拽引用

---

## 九、风险清单

| 风险 | 影响 | 应对 |
|------|------|------|
| structure 和 sentences 不一致 | TTS 跳句/错位 | sentences 从 structure 派生（单向），不独立编辑 |
| books.json 体积膨胀 | 加载慢 | 短期接受；中期 structure.text 和 sentences 去重 |
| EPUB 结构复杂（嵌套 div、无语义标签） | 解析出乱结构 | fallback：无法识别的统一归为 paragraph |
| 旧书无 structure | AI 阅读页面空白 | 伪结构生成：每 5 句一组 → paragraph block |
| 模式切换时位置同步 | 用户困惑 | 切到听书时自动定位到当前卡片的第一句 |
| PDF 结构识别差 | 卡片混乱 | 一期用 detectHeadingBoundaries 伪结构，标注"结构可能不准确" |

---

## 十、文件影响预估（方案 B）

```
重写/大改（4 个）:
  electron/services/parsers/epubParser.ts    # 保留 HTML 结构
  electron/services/parsers/mdParser.ts      # 保留 MD 结构
  electron/ipc/fileHandlers.ts              # 导入流程：生成 structure + 派生 sentences
  src/global.d.ts                           # 新增 Block/StructuredChapter 类型

新增（~15 个）:
  electron/services/parsers/structureBuilder.ts  # 通用结构构建器
  src/components/reader/AiReaderView.tsx
  src/components/reader/ContentCards.tsx
  src/components/reader/ContentCard.tsx
  src/components/reader/ChapterOutline.tsx
  src/components/reader/ModeSwitch.tsx
  src/components/ai/*（之前设计的 AI 对话组件）
  electron/services/ai/*（之前设计的 AI 后端服务）

小改（~8 个）:
  src/App.tsx                    # 模式切换 + 布局
  src/stores/bookStore.ts        # 新增 structure state
  src/hooks/useTTS.ts            # ttsSkip 跳过（~5 行）
  src/components/PlayerView.tsx  # 顶栏加模式切换按钮
  electron/preload.ts            # AI IPC 通道
  src/stores/settingsStore.ts    # ai 配置段
  package.json                   # 新依赖
  src/shortcuts.ts               # Ctrl+L

不动（关键）:
  src/hooks/useTTS.ts 核心逻辑
  src/components/ControlBar.tsx
  src/components/ProgressBar.tsx
  src/components/SentenceRow.tsx
  src/utils/bookData.ts（splitReadableSentences）
  electron/services/parsers/chapterBuilder.ts
  electron/services/parsers/textPreprocessor.ts
```
