# Phase 2 验证记录

日期：2026-07-26

## 验收证据

| PRD 范围 | 主要实现证据 | 自动化证据 |
|---|---|---|
| 结构与导入 | MD 首段/未闭合围栏保真与 structure 派生；EPUB package XML 结构解析及 preserve-order 混合容器遍历；完整 structure schema/shape/ID/range 校验并从接受 structure 重派生 chapters；PDF/旧书 pseudo；可选后台 nmem ingest | `mdParserStructure.test.ts`、`epubParserStructure.test.ts`、`parserCompatibility.test.ts`、`structureBuilder.test.ts`、`structureVersionMismatch.test.ts` |
| AI 阅读页面 | 默认 AI 模式、三栏、大纲、分类型卡片、当前块/句高亮、卡片朗读、侧栏宽度钳制、持久聚焦请求、沉浸隐藏但不卸载 | `bookStore.test.ts`、`readerComponents.test.ts`、`aiComponents.test.ts`、`selectionQuoteComponents.test.ts` |
| 流式 AI 对话 | OpenAI SSE、200 error envelope/空正文拒绝、Markdown/GFM、来源定位、可见错误、按 requestId/seq 取消 | `llmCaller.test.ts`、`ipcStreaming.test.ts`、`aiStore.test.ts`、`aiComponents.test.ts`、`ragComponents.test.ts` |
| 引用与安全 | 选区浮动条、最多 5 条引用、selection 证据隔离、先硬过滤再防剧透 prompt | `selectionQuoteComponents.test.ts`、`aiStore.test.ts`、`spoilerFilter.test.ts`、`ragOrchestration.test.ts` |
| 问题路由 | 可配置 greeting/chapter/book-wide 正则；chapter 只保留当前章；book-wide 遵守防剧透边界 | `settingsDeepMerge.test.ts`、`aiSettingsPanel.test.ts`、`spoilerFilter.test.ts`、`ragOrchestration.test.ts` |
| 历史与离线降级 | `ai-history.json` 按书分组、动态数据目录、根/消息/可选检索字段/嵌套来源严格校验；nmem 离线直聊 | `aiHistory.test.ts`、`aiStore.test.ts`、`nmemBridge.test.ts`、`ragOrchestration.test.ts` |
| 模式切换与 TTS | 模式切换不改播放状态；ttsSkip 导航/灰显/预取；raw 独占、取消结算、按原播放意图恢复 | `ttsSkip.test.ts`、`ttsSession.test.ts`、`modeSwitchPlayback.test.ts`、`readerComponents.test.ts` |
| 配置 | `AiSettings` 四段由设置页管理；四类证据/安全 prompt 独立配置；显式空路由数组可往返 | `settingsDeepMerge.test.ts`、`aiSettingsPanel.test.ts`、`ragOrchestration.test.ts`、typecheck/lint |

## 最终质量门

最终修复与文档同步后按顺序执行并读取完整输出：

1. `npm.cmd run typecheck`：通过，Node 与 Web 两套 TypeScript 配置均无错误。
2. `npm.cmd test`：通过，27 个测试脚本全部退出 0。
3. `npm.cmd run lint`：通过，0 errors / 0 warnings。
4. `npm.cmd run build`：通过，main / preload / renderer 生产构建全部完成。
5. `git diff --check`：退出 0；仅输出工作区既有 LF→CRLF 转换提示，无空白错误。

### 隔离暂存复验

发现当前工作区同时包含另一应用改造后，使用独立临时 Git index 从
`origin/master` 的一致基线重建共享文件，只叠加结构化导入与 AI 一期改动。
该 staged-only 导出树重新按相同顺序通过 typecheck、27 个测试脚本、
0-warning lint 和生产 build。重建明确排除了 200% 音量/内存预取、数据目录、
autoResume、搜索/截图和文本清洗重构；真实 index 保持为空。

最终修复后的 code tree 为 `c3a76b99f699dc254287002c58d4ac6447b6d248`。
验证树的 158 个受版本控制文件均与该 index 的 Git blob 哈希一致，且没有额外
源码或根目录文件。

构建仍输出 Vite 对 `quickTextStore.ts` 同时静态与动态导入的既有提示，但命令
退出 0，main / preload / renderer 均完成产物生成。

## 审查

第二轮独立审查的 8 个 Important 与第一轮终审新增的 4 个 Important 均已逐项增加回归并修复。随后对完整 75 文件 staged-only diff 的终审又发现 3 个 Important：流式主模型已有输出后错误地拼接 fallback、检索错误未进入历史、AI 模式跨章时播放器章节索引不同步。三项均先增加失败回归，再完成最小修复；复审结果为 0 Critical / 0 Important / 0 Minor。

## 运行时交互补充

- 复用现有 `http://localhost:5191/` 开发实例进行浏览器检查；实例由用户原有 PID 31604 持有，未重启或关闭。
- 浏览器壳可以加载应用，但没有 Electron preload，`loadProgress` / `selectFile` 通过可选链成为空操作，且当前书架为空，因此无法在不注入测试桩的情况下进入 AI 阅读页验证“折叠后问 AI 聚焦”和“流式回答中切换沉浸”。
- 对应状态契约由 `aiComponents.test.ts`、`aiStore.test.ts`、`selectionQuoteComponents.test.ts` 与 `readerComponents.test.ts` 覆盖；本次不把受环境限制的浏览器尝试记为手工通过。
