# AI 阅读体验与模型设置优化 Implementation Plan

> **For agentic workers:** Work inline in this session. Keep tests focused on changed behavior.

**Goal:** 完成 AI 阅读轻量播放、常规模型设置、真实 nmem 同步状态与无防剧透上下文。

**Architecture:** 复用现有播放器状态与 AI 配置结构，通过小组件和窄 IPC 扩展实现。主进程负责带密钥的模型请求与 nmem 对账，渲染层只管理交互状态。

**Tech Stack:** Electron, React, TypeScript, Zustand, Tailwind CSS, lucide-react, tsx tests.

## Global Constraints

- 不新增大型依赖。
- 不改动用户的无关工作区修改。
- 每项行为先写一个最小失败测试，再实现并复测。

### Task 1: AI 阅读播放外观

**Files:** `src/App.tsx`, `src/components/reader/AiPlaybackCapsule.tsx`, `tests/modeSwitchPlayback.test.ts`, `tests/readerComponents.test.ts`

- [ ] 增加失败测试：AI 模式只渲染胶囊，听书模式只渲染完整底栏。
- [ ] 实现上一句、播放/暂停、下一句胶囊并固定右下角。
- [ ] 确认沉浸模式不隐藏胶囊，顶栏是唯一沉浸入口。
- [ ] 运行两个相关测试。

### Task 2: 常规模型设置

**Files:** `electron/services/ai/llm-caller.ts`, `electron/ipc/aiHandlers.ts`, `electron/preload.ts`, `src/global.d.ts`, `src/components/settings/AiSettingsPanel.tsx`, `tests/aiSettingsPanel.test.ts`, `tests/llmCaller.test.ts`

- [ ] 增加失败测试：模型列表规范化、连接错误和设置页关键控件。
- [ ] 实现主进程模型获取/连接测试 IPC。
- [ ] 重排设置页为常用区与高级折叠区，并保留手动模型 ID 兜底。
- [ ] 运行两个相关测试。

### Task 3: nmem 真实同步状态

**Files:** `electron/services/ai/nmem-bridge.ts`, `electron/services/ai/ingest-service.ts`, `electron/services/ai/ingest-scheduler.ts`, `electron/ipc/aiHandlers.ts`, `electron/ipc/fileHandlers.ts`, `src/components/settings/AiSettingsPanel.tsx`, `tests/nmemBridge.test.ts`, `tests/nmemContract.test.ts`

- [ ] 增加失败测试：旧状态不可直接视为 ready，服务端无来源时重新同步。
- [ ] 扩展同步状态记录并实现服务端生命周期对账。
- [ ] 支持设置变化后的补同步与手动重新同步。
- [ ] 在知识库设置区显示状态和重试动作。
- [ ] 运行两个相关测试。

### Task 4: 上下文与防剧透清理

**Files:** `src/aiSettings.ts`, `src/stores/aiStore.ts`, `electron/services/ai/ai-config.ts`, `electron/services/ai/ai-service.ts`, `src/components/settings/AiSettingsPanel.tsx`, `tests/aiStore.test.ts`, `tests/ragOrchestration.test.ts`, `tests/spoilerFilter.test.ts`

- [ ] 增加失败测试：检索查询组合问题、选文、当前句和章节；提示中无防剧透约束。
- [ ] 删除防剧透配置/UI/提示和检索过滤。
- [ ] 实现组合检索查询，兼容读取旧设置。
- [ ] 删除或改写过时防剧透测试并运行相关测试。

### Task 5: 集成与文档

**Files:** `CONTEXT.md`

- [ ] 运行本次相关测试、`npm run typecheck` 和 `npm run build`。
- [ ] 启动 Electron，检查普通/沉浸/设置三种视图的布局与交互。
- [ ] 更新 `CONTEXT.md` 的状态、数据流、文件索引和风险说明。
