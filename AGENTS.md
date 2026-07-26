<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` - development phases, when to create tasks, skill routing
- `.trellis/spec/` - package- and layer-scoped coding guidelines
- `.trellis/workspace/` - per-developer journals and session traces
- `.trellis/tasks/` - active and archived tasks

If a Trellis command is available on your platform, prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` - reusable Trellis skills
- `.codex/agents/` - optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future Trellis update.

<!-- TRELLIS:END -->

# ting-ear Project Guide

- 改代码前先读 `CONTEXT.md`（架构、文件索引、数据流、坑点）；与源码不一致时先更新文档再改功能。
- 用户文档入口：`README.md`（安装/功能/数据目录）；开发细节只维护在 `CONTEXT.md`，避免两处细节打架。
- 优先用 codebase-memory MCP 或 CodeGraph 做代码发现；不可用时再 `rg` + 定点读文件。
- 改动保持在任务范围内，遵循现有约定；不要提交密钥、本机数据、`out/`、`dist/`、日志、缓存、`*-main.zip` 参考包。

## 关键事实（防止文档回退）

- 包名/版本以 `package.json` 为准（当前 `ting-ear@1.0.0`，产品名「听伴」）。
- 知识库 ingest 是 **整本一书一源**（`ingest-service` + `ingest-scheduler` → `ingest-status.json`），不是按章拆分。
- 章节大纲 UI 只挂载 `ChapterOutlinePanel`；`ChapterOutline.tsx` / `SectionNav.tsx` 为未使用遗留。
- AI 阅读模式播放控件是 `AiPlaybackCapsule`；听书模式才显示完整 ProgressBar + ControlBar。
- 数据目录默认 `%APPDATA%/ting-ear/听伴/`，含 `outlines/`、`ingest-status.json` 等（见 README/CONTEXT）。

## CONTEXT.md 维护（强制）

- 任务归档时必须同步 CONTEXT.md（M/L 级强制，S 级可跳过）
- 触发条件：新增/删除/重命名源码文件、API/路由/IPC 变化、数据模型变化、架构变化、新坑点、功能状态变化、启动方式变化
- 文件索引表必须有「何时读」列
- 与实际代码一致，过时即更新；新文件入库索引，删除的文件移除
- 当前状态区块每次归档刷新
- 总长 ≤ 300 行，超出拆子文档

<!-- codebase-memory-mcp:start -->
# Codebase Knowledge Graph (codebase-memory-mcp)

This project may use codebase-memory-mcp to maintain a knowledge graph of the codebase.
Prefer graph tools over grep/glob/file-search for code discovery when they are available.

## Priority Order

1. `search_graph` - find functions, classes, routes, variables by pattern
2. `trace_path` - trace who calls a function or what it calls
3. `get_code_snippet` - read specific function/class source code
4. `query_graph` - run Cypher queries for complex patterns
5. `get_architecture` - high-level project summary

## When to fall back to grep/glob

- Searching for string literals, error messages, config values
- Searching non-code files
- When MCP tools return insufficient results
<!-- codebase-memory-mcp:end -->

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph, a `.codegraph/` directory exists at the repo root. Reach for it before grep/find or raw file reads when you need to understand or locate code.

- MCP tool, when available: `codegraph_explore`
- Shell fallback: `codegraph explore "<symbol names or question>"`

If there is no `.codegraph/` directory, skip CodeGraph for this repo.
<!-- CODEGRAPH_END -->



