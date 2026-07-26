# Logging Guidelines

> 使用 `electron/services/log-service.ts` → `%APPDATA%/ting-ear/听伴/logs.json`。

---

## API

- `logService.info(source, message, context?)`
- `logService.warn(...)` / `logService.error(...)`
- 渲染层可通过 IPC 拉取 / 实时 `onLogEntry` 追加到 `logStore`

`source` 使用稳定短标签，便于过滤：

| source | 用途 |
|--------|------|
| `TTS` | 合成失败、引擎 id、voice |
| `AI` | 对话/大纲/模型错误 |
| `IPC` / 域名单 | 导入、窗口、OCR 等 |
| `App` | 启动与生命周期 |

---

## What to log

- TTS 失败：时间、`engineId`、voice、错误 details（**不要**打 API Key）
- AI/大纲：失败原因摘要、model 名（可）、requestId（若有）
- 导入失败：格式、错误信息（不要整书正文）
- 启动/数据目录切换等关键生命周期

## What NOT to log

- API Key、Authorization 头、cookies
- 整章/整书正文、用户隐私选区长文本（可记长度）
- 无意义的高频 debug 刷屏

---

## Levels

| Level | 何时 |
|-------|------|
| info | 正常里程碑（大纲完成、导入成功） |
| warn | 可恢复降级（nmem 离线、临时兜底） |
| error | 用户可感知的失败且需排查 |

---

## Retention

- `logs.json` 有条数上限，超出自动裁剪（以 `log-service` 实现为准）
- 清数据 `type=logs` 或 `all` 会清空日志文件
