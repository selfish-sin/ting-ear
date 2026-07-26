# 修复大纲模型请求超时

## Goal

让章节大纲在需要 HTTP 代理的运行环境中能够正常请求模型，并让请求失败时在大纲面板中明确显示可重试的错误，而不是只留下空白面板。

## Requirements

- Electron 主进程调用 OpenAI 兼容模型时必须兼容当前进程的 HTTP(S) 代理环境变量。
- 现有 Node 测试和无代理环境继续使用当前可测试的请求路径。
- 大纲生成失败必须保留失败原因，界面显示错误并允许再次生成。
- 不改变按章节解析、章节切换、内容哈希和大纲缓存的数据契约。

## Acceptance Criteria

- [ ] 在代理环境下模型列表和流式大纲请求不再因 Node `fetch` 直连而超时。
- [ ] 无代理请求和现有 `fetch` 测试继续通过。
- [ ] 大纲请求失败时面板显示具体错误，点击重试会重新发起请求。
- [ ] `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
