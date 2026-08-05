# 交接文档：大纲 LLM 缓存止血（Part 1 已完成）

**日期**：2026-08-04  
**项目**：`D:\projects\ting-ear`（听伴）  
**导向**：LLM **性价比第一**——未命中不得与命中一样贵；能复用磁盘缓存就绝不重烧。  
**本轮范围**：只做 **Part 1 缓存止血**，**已暂停**。Part 2/3 交给下一组。

---

## 1. 用户目标（原话意图）

1. 优化的是 **大纲 LLM 缓存**，不是 TTS（TTS 免费无所谓）。
2. 现状「未命中缓存和命中一样高」不可接受——根因是缓存被错误作废。
3. 大纲 / 关系纵览产品形态可大改（可砍关系纵览），要更有见地、抓阿基米德支点；**名字无所谓**。
4. 大方向：听上一任方案的 **方案 C** = 先止血命中率 + 再做 ChapterBrief 形态。

---

## 2. 已完成（Part 1：缓存止血）

### 2.1 根因（已证实）

用户数据目录 `%APPDATA%/ting-ear/<听伴>/outlines/` 实测（2026-08-04）：

| 文件版本 | 书本数 | 小节规模 | summary |
|---------|--------|----------|---------|
| **v3** | 5 | ~398 节 | 全 0 |
| **v4** | 1 | 12 节 | 0 |

旧代码：

```ts
if (value.version !== OUTLINE_CACHE_VERSION) return null  // 只认 4
```

→ **约 5/6 大纲文件整库 miss**，批量/重进会再调 LLM。这是命中率崩盘的第一杀手。

### 2.2 代码改动

| 文件 | 改动 |
|------|------|
| `electron/services/ai/outline-repository.ts` | **重写读策略**：`OUTLINE_CACHE_MIN_READABLE_VERSION=3`，可读 v3～当前；`normalizeOutlineRecord`；写入仍 `OUTLINE_CACHE_VERSION=4` 并渐进抬升文件版本；**保留其余章记录**；`schemaVersion` 软标记（缺省=1 LEGACY）；`loadAny` 辅助 |
| `electron/services/ai/outline-batch.ts` | `generateChapterOutlineRecord`：hit/miss/force/write **日志**；legacy schema **仍算 hit**；新写入打 `schemaVersion: 1` |
| `electron/ipc/aiHandlers.ts` | 命中 vs 新生成 分流写 `logService` |
| `src/global.d.ts` | `ChapterOutlineRecord.schemaVersion?: number` |
| `tests/outlineRepository.test.ts` | 覆盖 v3 命中、v2 拒绝、save 抬升版本、normalize |
| `CONTEXT.md` | 缓存命中规则与禁止整库作废说明 |

### 2.3 常量约定

```ts
OUTLINE_CACHE_VERSION = 4              // 写入文件版本
OUTLINE_CACHE_MIN_READABLE_VERSION = 3 // 可读下限
OUTLINE_SCHEMA_LEGACY = 1              // 旧目录式 title/point/summary
OUTLINE_SCHEMA_BRIEF = 2               // 预留：ChapterBrief（未实现）
```

**硬规则（下一组必须遵守）**：

- `contentHash` 匹配 + `status ∈ {generated, short_chapter}` → **必须 skip LLM**
- **禁止**因 `schemaVersion` 旧 / 缺 `thesis` / 缺 `summary` 而强制重算
- **禁止**再写 `version !== N → 整文件 null`；只拒绝 `< MIN_READABLE`
- 升 schema 时：**软失效**（UI 可标「可升级」），默认不烧 LLM

### 2.4 日志

控制台：

```text
[outline-cache] hit|miss|force|write|fail book=… ch=… key=…
```

主进程 LogService：`大纲缓存命中` / `大纲生成完成 cache=…`

### 2.5 测试（本机已跑通）

```powershell
cd D:\projects\ting-ear
npx tsx tests/outlineRepository.test.ts
npx tsx tests/outlineIntegration.test.ts
npx tsx tests/outlineGenerator.test.ts
```

预期均 exit 0。

---

## 3. 未做（明确暂停）

### Part 2 — 生成器 / 产物形态（ChapterBrief）

目标：少调用、高质量「见地」，不是多切目录节点。

建议数据（可微调）：

```ts
ChapterOutlineRecord {
  schemaVersion: 2
  thesis?: string           // 本章一句话主张
  whyItMatters?: string     // 读懂差在哪
  sections: SpineSection[]  // 3～6 论证脊骨，role: setup|build|turn|payoff|aside
  hinges?: Hinge[]          // 1～3 阿基米德支点
  skipHints?: string[]      // 可略读
}
```

性价比约束：

1. **优先单次 LLM**：抬高 `CHUNK_SIZE`（现 5000 过碎），中短章 1 次调用出完整 Brief。
2. 长章才分块；块间 delay 现 3000ms 可降（不影响 token，影响体验）。
3. 失败重试**不要**再降级成「只要 title」（会写浅缓存占坑）。
4. 新 prompt 进默认 `outlineSystemPrompt`；若用户 settings 里存的是**旧默认全文**，应识别并切到新默认（避免永远旧 prompt）。
5. 写入 `schemaVersion: 2`；读路径已兼容缺字段。

关键文件：

- `electron/services/ai/outline-generator.ts`（prompt、分块、parse）
- `src/aiSettings.ts` 默认 `outlineSystemPrompt`
- `electron/services/ai/outline-batch.ts` 映射新字段
- `tests/outlineGenerator.test.ts`

### Part 3 — UI

- **删除**「关系纵览」tab（现仅为同一 `sections` + 箭头；且磁盘 **summary 覆盖率 0%**，等于废 tab）
- 单面板：主张 → 为何重要 → 脊骨（可点跳）→ 支点 → 可略读
- legacy（schema=1）仍显示 title/point 列表；可选「升级本章」按钮（**仅用户点击才 force**）

关键文件：

- `src/components/reader/ChapterOutlinePanel.tsx`
- `src/components/reader/AiReaderView.tsx`（生成 force 逻辑：首次 force=false，仅「重新生成」force=true）

### 已知仍存在的烧钱点（Part 1 未改）

| 点 | 位置 | 说明 |
|----|------|------|
| 单章按钮恒 `force: true` | `AiReaderView.generateOutline` | 点「生成/重新生成」必重算；首次无缓存时无差，有缓存时浪费 |
| 分块多 + delay 3s | `outline-generator.ts` | 长章 N 次 LLM |
| 目录式 prompt | `DEFAULT_OUTLINE_SYSTEM_PROMPT` | 产出浅、块多 |
| 自定义 prompt 锁死旧文案 | settings 已 persist 时 | 改代码默认不生效 |

---

## 4. 建议下一组执行顺序

1. **先验证 Part 1 生效**  
   - 用用户真实 `outlines/*.json`（大量 v3）：`aiOutlineGet` / 批量 `force:false` 应 **skipped/hit**，日志出现 `hit`。  
   - 不要先 bump `OUTLINE_CACHE_VERSION` 到 5 还只认 5。

2. **Part 2 生成器**（性价比）：单次调用 + Brief schema + 测试。

3. **Part 3 UI**：砍关系纵览 + legacy 兼容展示 + 升级按钮。

4. 全程：**默认路径 0 次多余 LLM**；force 仅用户明确「重新生成 / 升级」。

---

## 5. 不要做的事

- 不要为了「新功能」批量 `force: true` 刷新用户全书大纲。
- 不要用 `OUTLINE_CACHE_VERSION++` 并只认新版本（会重演 v3 事故）。
- 不要把 TTS 缓存优化混进本线。
- 大改前若偏离「性价比第一」，先跟用户确认。

---

## 6. 快速索引

| 主题 | 路径 |
|------|------|
| 缓存读写 | `electron/services/ai/outline-repository.ts` |
| 生成编排 / hit 日志 | `electron/services/ai/outline-batch.ts` |
| IPC | `electron/ipc/aiHandlers.ts`（`ai:outline:*`） |
| 纯 LLM | `electron/services/ai/outline-generator.ts` |
| 面板 UI | `src/components/reader/ChapterOutlinePanel.tsx` |
| 架构笔记 | `CONTEXT.md` →「章节大纲」 |
| 历史设计 | `docs/superpowers/plans/2026-07-26-chapter-outline-redesign.md` |

---

## 7. 验收标准（Part 1）

- [x] v3 文件可 `load` 命中  
- [x] v2 仍拒绝  
- [x] save 不丢同文件其它章  
- [x] schema 缺省视为 legacy，且 hit  
- [x] 控制台 / LogService 可区分 hit 与 write  
- [x] 相关单测通过  
- [ ] Part 2/3 未开始（有意暂停）

---

**交接完成。下一组从本文 §3 Part 2 起做。**
