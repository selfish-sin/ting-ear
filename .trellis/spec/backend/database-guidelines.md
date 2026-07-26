# Local Persistence (not SQL)

> ting-ear **没有数据库**。状态落在用户数据目录的 JSON / 目录文件。
> 文件名保留 `database-guidelines.md` 以兼容 Trellis 默认索引；内容以本地持久化为准。

---

## 1. Scope / Trigger

改 books/settings/历史/书签/专辑/AI 历史/大纲缓存/ingest 状态/封面/缓存路径时读本规范。

## 2. Data directory

- 默认：`%APPDATA%/ting-ear/听伴/`（`app.getPath('userData') + '/听伴'`）
- 统一入口：`getDataDir()`（`fileHandlers.ts`）；禁止硬编码拆分路径
- `settings.json` 始终在默认 userData 侧解析（自定义数据目录时注意 settings 位置约定，见 `main.ts`）

## 3. File map

| 文件/目录 | 内容 |
|-----------|------|
| `books.json` | 书籍、进度、editHistory、structure、timeMap |
| `settings.json` | 用户设置（含 `ai` 段） |
| `engines.json` | 自定义 TTS 引擎 |
| `ai-history.json` | 按书对话历史 |
| `bookmarks.json` / `history.json` / `albums.json` | 书签 / 收听历史 / 专辑 |
| `logs.json` | 运行日志（有上限裁剪） |
| `ingest-status.json` | 知识库 **整本**同步状态 |
| `outlines/<bookId>.json` | 章节大纲缓存（`OUTLINE_CACHE_VERSION=3`） |
| `covers/` | 封面 PNG |
| `cache/` | TTS 等缓存 |

## 4. Contracts

- **原子写**：先写临时文件再 `rename` 替换目标（避免崩溃截断 `books.json`）
- **整包校验**：保存 books 时若集合非法或 id 重复，整次拒绝，禁止部分写入
- **损坏策略**：`ai-history.json` 等已存在但结构损坏时抛中文错误，禁止静默过滤后覆盖
- **ingest**：一书一源整本上传；旧按章状态视为过期，下次整本重传
- **大纲**：按 `bookId + chapterKey + contentHash` 隔离；版本号不匹配整文件失效

## 5. Validation & Error Matrix

| 条件 | 结果 |
|------|------|
| books 保存含非法书/重复 id | 整次失败 |
| ai-history 文件损坏 | 抛错，UI 显示重试，不伪装空历史 |
| outline 缓存 version ≠ 3 | 视为无缓存 |
| 清数据 `type=all` | 清空列明的 json + `covers`/`cache`/`outlines` |

## 6. Wrong vs Correct

#### Wrong

```typescript
writeFileSync(join(process.env.APPDATA!, 'books.json'), JSON.stringify(books))
```

#### Correct

```typescript
saveJsonFile('books.json', books) // 内部走 getDataDir() + 原子写
```

## 7. Tests

- 书本规范化 / 集合校验：`tests/bookData.test.ts`、`bookStore.test.ts`
- 大纲缓存：`outlineRepository` / `outlineIntegration`
- 整本 ingest：`ingestWholeBook.test.ts`
- AI 历史损坏传播：`aiHistory.test.ts`
