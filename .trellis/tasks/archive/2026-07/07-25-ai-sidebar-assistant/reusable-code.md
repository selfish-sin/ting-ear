# 可复用代码清单（标注来源）

> 从 4 个参考项目中找到的可直接复制/少量适配的代码。
> ai-book-reader 是 Python CLI，无可复用前端代码，不列入。

---

## 直接抄（改 JSX→TSX 即可）

| 组件 | 来源 | 文件 | 行数 | 说明 |
|------|------|------|------|------|
| Markdown 渲染器 | Vibero | `ai-chat/src/MarkdownRenderer.jsx` | 94 | react-markdown + GFM + KaTeX + highlight，最干净的一个文件 |
| SSE 流式客户端 | Vibero | `ai-chat/src/customOpenAIService.js` | 286 | fetch + ReadableStream + data: 解析，零 DOM 耦合 |
| URL 格式化 | Vibero | 同上 `_formatUrl()` | 30 | 任意 base URL → /chat/completions，处理尾斜杠等 |
| 多模态错误检测 | Vibero | `ai-chat/src/multimodalApiError.js` | 59 | 正则识别"模型不支持图片"错误 |
| 引用药丸渲染 | Vibero | `SlateInputWithSender.jsx` L16-46 | 30 | VibeCard mention 药丸样式（inline style） |
| 用户消息中 @chip | Vibero | `index.jsx` L408-458 | 50 | 正则拆分 @name → 渲染为药丸 span |
| 毛玻璃拖拽遮罩 | Vibero | `index.jsx` L914-949 | 35 | backdrop-blur 10px + 居中图标 |
| .markdown-content CSS | Vibero | `ai-chat/src/styles.css` L622-907 | 285 | 标题/列表/代码块/表格/KaTeX 全套排版 |
| 流式动画组件 | SageRead | `prompt-kit/response-stream.tsx` | 394 | typewriter + fade 两种模式，零依赖 |
| 思考/推理面板 | SageRead | `prompt-kit/reasoning.tsx` | 148 | 折叠面板，流式时自动展开，完成自动收起 |
| 推理计时器 | SageRead | `hooks/use-reasoning-timer.ts` | 145 | "思考中…5s" → "思考了5秒" |
| 加载动画集 | SageRead | `prompt-kit/loader.tsx` | 499 | 12种 loading 动画，纯 CSS |
| [N] 标注解析 | SageRead | `markdown/annotation-utils.ts` | 27 | 正则提取 [N] → 结构化，纯函数 |
| 文本工具集 | SageRead | `markdown/text-utils.ts` | 271 | stripMarkdown/extractSentences/getBestSearchSentence |
| 代码块组件 | SageRead | `prompt-kit/code-block.tsx` | 94 | Shiki 高亮 + 语言标签 |
| 消息类型定义 | ReadAny | `core/src/types/message.ts` | 261 | Part 系统全套类型 + 工厂函数 + 类型守卫 |
| 流式指示器 | ReadAny | `chat/StreamingIndicator.tsx` | 95 | thinking/tool_calling/responding 三态动画 |
| 选中浮动条 | ReadAny | `reader/SelectionPopover.tsx` | 194 | 视口边界钳制 + 按钮组 + overlay 关闭 |
| 内置 Skill 模板 | ReadAny | `core/src/ai/skills/builtin-skills.ts` | 483 | 8个 Skill 的 prompt 结构（角色→步骤→格式→约束） |

**小计：~3,600 行可直接复用**

---

## 抄核心逻辑（需剥离框架耦合）

| 组件 | 来源 | 文件 | 行数 | 要剥什么 |
|------|------|------|------|---------|
| ChatInput（引用卡片+发送） | ReadAny | `chat/ChatInput.tsx` | 207 | 去 i18n，换 shadcn Tooltip |
| MessageList（滚动+渲染） | ReadAny | `chat/MessageList.tsx` | 275 | 需 Part 类型 + PartRenderer |
| PartRenderer（分发渲染） | ReadAny | `chat/PartRenderer.tsx` | 406 | 换 TOOL_LABEL_KEYS，去 Mindmap 可选 |
| MarkdownRenderer（含引用） | ReadAny | `chat/MarkdownRenderer.tsx` | 681 | 去 Mermaid（-250行），适配 CitationPart |
| 消息气泡组件 | SageRead | `prompt-kit/message.tsx` | 87 | 需 shadcn Avatar/Tooltip |
| Tool 调用卡片 | SageRead | `prompt-kit/tool.tsx` | 218 | 定义自己的 TOOL_NAME_MAP |
| 来源引用药丸 | SageRead | `prompt-kit/source.tsx` | 130 | 需 shadcn HoverCard |
| 自动滚动容器 | SageRead | `prompt-kit/chat-container.tsx` | 72 | 需 use-stick-to-bottom |
| 输入框（IME 处理） | SageRead | `prompt-kit/prompt-input.tsx` | 173 | 需 shadcn Textarea |
| 思维导图渲染 | SageRead | `tools/mindmap-viewer.tsx` | 161 | Tauri 右键菜单→Electron/HTML 菜单 |
| Slate @mention 输入 | Vibero | `SlateInputWithSender.jsx` 核心 | ~150 | 去 Zotero.Prefs 400行，JSX→TSX |
| 阅读上下文服务 | ReadAny | `reading-context-service.ts` | 218 | 去 DB/platform 依赖，保留 singleton+subscribe 模式 |
| 流式节流发布 | ReadAny | `use-streaming-chat.ts` 模式 | ~100 | 提取 160ms 节流 + Part 累积模式，不抄整个 hook |

**小计：~2,900 行需适配后复用**

---

## 只参考架构（太重/太耦合，重写）

| 组件 | 来源 | 原因 |
|------|------|------|
| ChatPanel 整体 | ReadAny | 深度耦合 ReadAny store/thread/platform |
| index.jsx 主应用 | Vibero | 全是 Zotero bridge 代码 |
| custom-chat-transport | SageRead | Vercel AI SDK v5 专用，我们用裸 fetch |
| LangGraph Agent | ReadAny | 我们不用 Agent，用简单问题路由 |
| useStreamingChat 整体 | ReadAny | 609行，耦合太重，只提取节流模式 |

---

## 需要新增的 npm 依赖（复用代码带来的）

```json
{
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "remark-math": "^6",
  "rehype-katex": "^7",
  "rehype-highlight": "^7",
  "markmap-lib": "^0.18",
  "markmap-view": "^0.18",
  "use-stick-to-bottom": "^1",
  "lucide-react": "latest",
  "clsx": "^2",
  "tailwind-merge": "^2",
  "eventsource-parser": "^2"
}
```

可选（如果抄 Slate 输入）：`slate` + `slate-react` + `slate-history`
可选（如果抄 SageRead 全套）：`@radix-ui/react-collapsible` + `@radix-ui/react-tooltip` + `@radix-ui/react-popover`

---

## 复用策略建议

### 第一优先级（省最多时间）

1. **Vibero 的 customOpenAIService.js** → 改为 `llm-caller.ts`（省掉 SSE 解析调试）
2. **ReadAny 的 message.ts 类型** → 直接作为 Part 消息系统基础
3. **ReadAny 的 SelectionPopover** → 改为统一浮动条（省掉位置计算调试）
4. **SageRead 的 reasoning.tsx + response-stream.tsx** → 流式渲染直接用
5. **Vibero 的 .markdown-content CSS** → AI 回答排版直接用

### 第二优先级（提升质量）

6. **ReadAny 的 PartRenderer** → 消息分发渲染（text/retrieval/citation/mindmap）
7. **ReadAny 的 ChatInput** → 引用卡片 + 发送按钮
8. **SageRead 的 mindmap-viewer** → 思维导图渲染
9. **ReadAny 的 builtin-skills.ts** → Skill prompt 模板参考
10. **ReadAny 的 reading-context-service 模式** → 自动上下文感知

### 第三优先级（锦上添花）

11. Vibero 的 Slate @mention 输入（如果 QuoteChips 不够用）
12. SageRead 的 loader.tsx（12种加载动画）
13. SageRead 的 source.tsx（来源 HoverCard）
14. Vibero 的毛玻璃拖拽遮罩

---

## 工程量估算（考虑复用后）

| 模块 | 不复用 | 复用后 | 省了多少 |
|------|--------|--------|---------|
| LLM 流式调用 | 2天 | 0.5天 | 75%（抄 Vibero） |
| 消息类型系统 | 1天 | 0天 | 100%（抄 ReadAny） |
| Markdown 渲染 | 2天 | 0.5天 | 75%（抄 Vibero CSS + SageRead 组件） |
| 流式 UI 渲染 | 2天 | 0.5天 | 75%（抄 SageRead response-stream + reasoning） |
| 选中浮动条 | 1天 | 0.5天 | 50%（抄 ReadAny，改按钮） |
| 引用卡片输入 | 1.5天 | 0.5天 | 67%（抄 ReadAny ChatInput） |
| 思维导图 | 1.5天 | 0.5天 | 67%（抄 SageRead mindmap-viewer） |
| Part 渲染器 | 2天 | 1天 | 50%（抄 ReadAny PartRenderer，改类型） |
| **合计** | **~13天** | **~4天** | **~70%** |

Parser 改造 + 数据模型 + 模式切换 + AI 后端编排 这些没有可抄的，得自己写（~8天）。
总工程量从 ~21天 降到 ~12天。
