# Backend / Main-Process Guidelines

> ting-ear 的「后端」= Electron 主进程（`electron/`）+ 本地数据目录，**无独立服务端、无 SQL 数据库**。
>
> 最近核对：2026-07-27

---

## Overview

主进程负责：窗口/托盘、IPC、文件导入解析、AI/RAG/大纲、TTS 引擎调度、本地 JSON 持久化、OCR 子进程。渲染进程（`src/`）只通过 `window.api` 访问能力，禁止直连 Node/`ipcRenderer`。

权威架构索引：仓库根目录 `CONTEXT.md`、`README.md`。

---

## Guidelines Index

| Guide | Description | Status |
| ----- | ----------- | ------ |
| [Directory Structure](./directory-structure.md) | `electron/` 布局与命名 | Active |
| [Local Persistence](./database-guidelines.md) | JSON 文件、原子写、数据目录 | Active |
| [Error Handling](./error-handling.md) | IPC/AI/TTS 错误分类与传播 | Active |
| [Quality Guidelines](./quality-guidelines.md) | 禁止项、窗口生命周期、测试 | Active |
| [Logging Guidelines](./logging-guidelines.md) | `log-service`、source 约定 | Active |
| [Reading Pipeline Contract](./reading-pipeline-contract.md) | 书本规范化、导航、版本不变量 | Active |
| [AI Sidebar Spec](../ai-sidebar.md) | AI 阅读/对话/大纲/ingest 编码规范 | Active |

---

## Pre-Development Checklist

- [ ] 读 `CONTEXT.md` 对应文件索引行
- [ ] 改 IPC 时同步 `preload.ts` + `src/global.d.ts`
- [ ] 路径一律 `getDataDir()`，不硬编码 `%APPDATA%`
- [ ] 不把 API Key / 书籍正文 / 日志写进仓库
- [ ] 涉及句子/章节索引时遵守 [Reading Pipeline Contract](./reading-pipeline-contract.md)

## Quality Check

- [ ] `npm run typecheck`
- [ ] 相关 `npm test` 子集或全量
- [ ] 无反向依赖（handlers → services → adapters，不可反）

---

**Language**: 规范正文可用中文；代码标识符保持英文。
