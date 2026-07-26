# Directory Structure (Electron main process)

> 主进程与共享解析代码布局。渲染层见 `src/`（不在本文件展开）。

---

## Layout

```
electron/
├── main.ts                 # 入口：窗口、托盘、单实例、注册 IPC
├── preload.ts              # contextBridge → window.api
├── ipc/                    # 按域拆分的 IPC handlers（只做接线）
│   ├── fileHandlers.ts     # 导入/导出、JSON、getDataDir、ingest 启动
│   ├── aiHandlers.ts       # chat / nmem / outline
│   ├── ttsHandlers.ts
│   ├── ocrHandlers.ts
│   ├── textCleanHandlers.ts
│   ├── bookmarkHandlers.ts / historyHandlers.ts / logHandlers.ts
│   ├── subtitleHandlers.ts / floatingBallHandlers.ts / windowHandlers.ts
├── services/
│   ├── settings-service.ts
│   ├── log-service.ts
│   ├── ai/                 # 对话、RAG、整本 ingest、章节大纲
│   │   ├── ai-config.ts / ai-service.ts / ai-history.ts
│   │   ├── llm-caller.ts / nmem-bridge.ts
│   │   ├── ingest-service.ts / ingest-scheduler.ts
│   │   └── outline-*.ts
│   ├── parsers/            # 格式解析 + structure + 清洗
│   │   ├── txt/epub/pdf/docx/md/html/mobiParser.ts
│   │   ├── structureBuilder.ts / chapterBuilder.ts
│   │   └── textPreprocessor.ts
│   └── tts-engines/        # Edge / Qwen / HTTP + EngineManager
└── ocr/rapidocr_runner.py
```

渲染侧关键入口：

```
src/
├── App.tsx                 # 视图路由、沉浸、autoResume、AI/听书底栏
├── components/reader/      # AiReaderView、ContentCards、ChapterOutlinePanel、AiPlaybackCapsule
├── components/ai/          # 侧栏对话与引用
├── stores/                 # Zustand
├── hooks/useTTS.ts
└── utils/bookData.ts       # 规范化与 pseudo structure（主进程可重导出）
```

---

## Module Organization

| 新能力 | 放哪里 |
|--------|--------|
| 新 IPC 域 | `electron/ipc/<domain>Handlers.ts`，在 `main.ts` 注册，`preload` + `global.d.ts` 同步 |
| 新 AI 子能力 | `electron/services/ai/`，由 `aiHandlers` 编排，禁止 handler 内堆业务 |
| 新文件格式 | `electron/services/parsers/`，输出与现有 parser 相同的 sentences/chapters/structure 契约 |
| 新 TTS 厂商 | `tts-engines/*-adapter.ts` + `EngineManager` 注册 |
| 新阅读 UI | `src/components/reader/` 或 `ai/`，状态进 store，不绕过 `App` 激活链路 |

---

## Naming

- IPC channel：`domain:action` 或 `domain:sub:action`（如 `ai:outline:generate`）
- preload API：camelCase 扁平名（`aiOutlineGenerate`）
- 服务文件：kebab-case（`ingest-scheduler.ts`）
- React 组件：PascalCase

---

## Forbidden

- 在 `ipc/*Handlers.ts` 写大块业务逻辑（应下沉 services）
- 渲染进程 `import` 主进程模块或反向依赖
- 新增与 `CONTEXT.md` 索引脱节的源文件而不更新文档
