# Quality Guidelines

> 主进程与跨层质量门禁。AI 阅读细则见 `../ai-sidebar.md`。

---

## Forbidden patterns

- 硬编码可配置值（模型名、nmem URL、prompt）→ 必须走 `AI_DEFAULTS` / settings
- 渲染层直连 `ipcRenderer` 或主进程模块
- `EngineManager` 静默切换 Edge/千问/HTTP
- 把用户数据目录文件提交进 Git
- 辅助窗口在启动时强行创建（见下）
- catch 后空操作 / 返回假成功

## Required patterns

### 数据进入播放器

必须经 `App` 的激活链路：`normalizeBookData` → 设 book/sentences/chapters/range/index → `setCurrentView('player')`。书架/历史/书签只上报意图，不私自写 player store。详见 [Reading Pipeline Contract](./reading-pipeline-contract.md)。

### Window lifecycle: lazy auxiliary windows

`floatingBallEnabled` 是功能许可，不是启动指令。主窗口在 `app.whenReady()` 创建；悬浮球 `BrowserWindow` 仅在用户显式显示或主窗口进托盘时创建。

```typescript
// Good: 启动不创建辅助渲染进程
if (settingsService?.get().floatingBallEnabled && logService) {
  showFloatingBallWindow(logService)
}
```

不要在首次加载 settings 的 effect 里无条件 `showFloatingBall()`。

### IPC 三件套同步

改 channel 必须同时改：`ipc/*Handlers.ts`、`preload.ts`、`src/global.d.ts`。

### 类型与测试

- `npm run typecheck` 通过（node + web 双 tsconfig）
- 改清洗/分句/结构/AI/大纲/ingest 后跑 `npm test` 对应文件
- 新跨层契约优先写成可执行测试，再写文档

---

## Common mistakes

- 把 Electron GPU/utility/renderer 子进程当成重复 app 实例
- 功能开关 = 立即创建 `BrowserWindow`
- 切换 `readerMode` 时误重置 `currentSentenceIndex` 或清空 AI 历史
- 信任 renderer 传来的章节正文做大纲（必须 `outline-input` 从 `books.json` 重载）

---

## Testing expectations

| 改动 | 至少覆盖 |
|------|----------|
| 解析/structure | `parserCompatibility`、`*Structure*`、`structureVersionMismatch` |
| 播放/数据 | `bookData`、`bookStore`、`modeSwitchPlayback` |
| AI/RAG | `llmCaller`、`rag*`、`nmem*`、`aiStore` |
| 大纲 | `outline*`、`chapterTitleEditing` |
| ingest | `ingestWholeBook` |
| TTS | `ttsSkip`、`ttsSession`、`engineImport` |

---

## Code review checklist

- [ ] 有无硬编码密钥/URL/模型
- [ ] 错误是否分类且可日志排查
- [ ] 是否破坏句子索引/range 不变量
- [ ] CONTEXT.md 是否需要同步
- [ ] 是否误提交 `out/` `dist/` 用户数据
