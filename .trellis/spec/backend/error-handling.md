# Error Handling

> 主进程与跨进程错误如何分类、记录、返回渲染层。

---

## Principles

1. **可分类**：AI/nmem/TTS 错误有稳定 `code` / `errorType`，供 UI 文案与降级
2. **可观测**：写 `log-service`（带 `source`），禁止吞掉后无日志
3. **中文用户文案**：`message` 面向用户；`cause`/details 仅日志
4. **禁止静默成功**：HTTP 200 空正文、error envelope、损坏历史文件不得当成成功

---

## Error surfaces

| 域 | 类型/通道 | 行为 |
|----|-----------|------|
| AI 对话 | `AiServiceError` / `ai:chat:error` | 401/403、429、5xx、超时、取消、200 envelope、空正文 |
| nmem | `NmemError` + 离线横幅 | 断线/超时 → 当前请求降级纯 LLM，对话不中断 |
| TTS | 适配器抛错 → IPC / logs | **不**自动换引擎；当前句可临时 system TTS 兜底 |
| 文件导入 | `{ success:false, error }` | 0 句可读内容不得覆盖已有书 |
| 大纲 | generate 失败 status=`failed` | 队列继续；UI 可重试 |
| ingest | `ingest-status.json` + `ai:ingest:error` toast | 不阻塞导入主路径 |

---

## Patterns

```typescript
// Good: 分类后上抛 / 回传
throw new AiServiceError('model_error', '模型服务暂时不可用', status)

// Bad: 吞掉
try { await work() } catch { return null }
.catch(() => {})
```

### IPC 返回约定

- 同步结果：`{ success: boolean, error?: string, ...data }`
- 流式：事件 `ai:chat:chunk` / `sources` / `done` / `error`；取消走 `done` 而非 error（与 ai-sidebar 一致）

### 渲染层

- Store 保留 `error` 字段展示；历史加载失败必须可见，禁止静默 `[]`
- Toast 用于一次性失败；面板内错误用于可重试状态

---

## Common mistakes

- catch 后 `return []` 导致 UI 以为「无数据」
- 把 system TTS 兜底当成全局引擎已切换（实际不改 `settings.ttsEngine`）
- 代理环境下假定 Node `fetch` 读了 `HTTP_PROXY`（模型请求需走 axios 路径，见 `llm-caller.ts`）
