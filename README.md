# 听伴（TingEar）— Windows 桌面 AI 阅读与 TTS 听书伴侣

> 版本：v1.0.0（与 `package.json` 一致）｜ 技术栈：Electron 28 + React 18 + TypeScript + Vite 5 + Tailwind CSS + Zustand
>
> 本地优先的 Windows 桌面阅读应用：默认以结构化卡片阅读电子书，通过 OpenAI 兼容模型与 Nowledge Mem 做带来源的书内问答；可切换到逐句 TTS 听书。支持章节大纲生成、选中引用、防剧透、回答朗读、Edge/千问/自定义/系统四类 TTS、OCR、纯规则文本清洗、桌面字幕与沉浸阅读。

---

## 功能一览

| 模块 | 功能 |
|------|------|
| **书架管理** | 导入 EPUB / TXT / PDF / DOCX / MD / HTML / MOBI(需 Calibre)，多书并存，封面/进度持久化；EPUB 可抽内嵌封面，无封面时浅色调自动生成 |
| **文档解析** | EPUB(adm-zip)、TXT(编码检测)、PDF(pdf-parse)、DOCX(mammoth)、MD、HTML；MOBI/AZW 经本机 `ebook-convert` 转 EPUB 再解析 |
| **AI 阅读** | 默认三栏：当前章大纲面板、结构化正文卡片、可折叠/拖拽 AI 侧栏；旧书无 structure 时用伪结构兼容显示 |
| **章节大纲** | 按当前阅读章按需生成（不自动切章触发）；缓存 `outlines/<bookId>.json`（版本 3）；支持章节名/小节名编辑 |
| **书内问答** | OpenAI 兼容 SSE 流式回答、Nowledge Mem 检索、来源定位、防剧透、按书历史、离线降级、最多 5 条选中引用组合提问 |
| **逐句播放器** | 句子高亮 + 自动滚动、点击跳转、进度条跨章定位、文本搜索（Ctrl+F）、沉浸模式（正文区右上 fixed 悬浮开关） |
| **AI 模式播放** | AI 阅读时用可拖拽 `AiPlaybackCapsule` 控制播放；听书模式用完整底栏（进度 + ControlBar） |
| **TTS 引擎** | ① Edge 在线（默认）② 千问 CosyVoice ③ 自定义 HTTP/OpenAI 兼容 ④ 系统离线（Web Speech，失败时临时兜底） |
| **音色 / 语速 / 音量** | 多音色与试听、0.5x~3.0x 语速（±0.1）、音量 0~200%（Web Audio 增益）+ 静音 |
| **预选页（两步）** | 选编辑记录版本 → 选章节范围 → 开始阅读；PlayPref 按书记忆偏好 |
| **截图 OCR** | 桌面截图 → 拖拽选区（DPI 感知）→ RapidOCR → 快速文本 |
| **文本清洗** | 纯正则规则（可视化编辑 + 规则导入）/ 手动逐句编辑 / 撤销 / 应用；**无内置清洗 LLM** |
| **编辑记录** | 每次清洗存为版本，播放器内可切换 |
| **桌面字幕** | 独立透明窗口显示当前句，可控制播放与拖拽拉伸 |
| **自定义专辑** | 多书归入合集 |
| **音频导出** | 当前章节/区间合成 MP3 |
| **悬浮球** | 独立透明窗口：播放/暂停/上下句/上下章/OCR/剪贴板朗读 |
| **书签 / 历史 / 日志** | 书签备注、收听历史恢复、运行日志面板 |
| **全局快捷键** | 可自定义（默认 Ctrl+Alt 前缀），OSD 反馈 |
| **主题** | 浅色 / 深色 / 跟随系统；无边框窗控 |

---

## 快速开始

### 环境要求

- **Node.js 20+**、npm 10+
- **Python 3 + RapidOCR**（仅截图 OCR；不装则 OCR 不可用，其余功能正常）
- **Calibre**（可选；仅导入 MOBI/AZW 时需要 `ebook-convert`）

### 安装依赖

```bash
cd ting-ear
npm install
```

### 开发模式（热重载）

```bash
npm run dev
```

或双击 `start.bat`（可见控制台）。`启动听伴.vbs` 为隐藏窗口启动器（本地文件，默认不入库）。

开发时 Vite 默认端口 **5191**（被占用时会换空闲端口，配合单实例锁聚焦已有窗口）。

### 构建与打包

```bash
npm run build          # 输出到 out/
npm run package        # NSIS 安装程序 → dist/
npm run package:dir    # 仅打包目录，不生成安装程序
```

---

## 配置与数据目录

默认数据目录：`%APPDATA%/ting-ear/听伴/`（可通过设置自定义，但 `settings.json` 始终在默认位置）：

```
%APPDATA%/ting-ear/听伴/
├── books.json            # 书籍、进度、editHistory、structure、timeMap
├── ai-history.json       # 按书 AI 对话、检索状态与来源
├── settings.json         # AI / TTS / 快捷键 / 清洗规则 / 外观等
├── engines.json          # 自定义 TTS 引擎
├── bookmarks.json        # 书签
├── history.json          # 收听历史
├── albums.json           # 自定义专辑
├── logs.json             # 运行日志（上限裁剪）
├── ingest-status.json    # 知识库整本同步状态
├── outlines/             # 按书章节大纲缓存（version=3）
├── covers/               # 封面 PNG
└── cache/                # TTS 等缓存
```

### TTS

- **Edge TTS**（默认）：免费，无需配置
- **千问 CosyVoice**：设置 → TTS 填写阿里云 API Key
- **自定义引擎**：支持 OpenAI 兼容 / 通用 HTTP，可粘贴 curl/JSON 一键部署
- **系统离线**：Web Speech；在线引擎当前句失败时**临时**兜底，不改写全局 `ttsEngine`

### AI 阅读与知识库

- 设置 → AI：OpenAI 兼容地址、API Key、主/备用模型、Nowledge Mem、超时、检索、防剧透、system prompt、问候路由正则等
- Nowledge Mem 默认 `http://127.0.0.1:14242`（用户自行启动）；断线显示横幅并降级为无 RAG 直聊
- 开启自动导入后：书籍保存成功后由 `IngestScheduler` **整本**写入知识库（一书一源，非按章拆分）；旧按章状态会在下次同步时迁移重传

### 音量

- 界面 0~**200%**（>100% 为 GainNode 增益）
- 合成侧固定满电平缓存；调音量不使缓存失效
- 系统 TTS 限制在 0~100%

---

## 项目结构

```
ting-ear/
├── electron/                         # 主进程
│   ├── main.ts                       # 窗口、托盘、单实例、注册 IPC
│   ├── preload.ts                    # contextBridge（listener 均返回 cleanup）
│   ├── ipc/                          # file / ai / tts / ocr / subtitle / …
│   ├── services/
│   │   ├── ai/                       # 对话、RAG、nmem、整本 ingest、章节大纲
│   │   ├── parsers/                  # txt/epub/pdf/docx/md/html/mobi + structure + 清洗
│   │   ├── tts-engines/              # Edge / 千问 / HTTP / EngineManager
│   │   ├── settings-service.ts
│   │   └── log-service.ts
│   └── ocr/rapidocr_runner.py
├── src/                              # React 渲染进程
│   ├── App.tsx                       # 视图路由、沉浸、autoResume、AI/听书底栏策略
│   ├── components/
│   │   ├── reader/                   # AiReaderView、ContentCards、ChapterOutlinePanel、AiPlaybackCapsule…
│   │   ├── ai/                       # 侧栏对话、引用、检索、选区
│   │   ├── settings/                 # AI 设置面板
│   │   └── …                         # 书架/播放器/清洗/OCR/悬浮球/字幕/OSD 等
│   ├── stores/                       # book / player / ai / settings / …
│   ├── hooks/                        # useTTS / useKeyboard
│   └── utils/                        # bookData / audioOutput / ttsSkip / ttsSession / contentHash
├── tests/                            # 解析、AI/RAG、大纲、TTS、清洗等回归
├── prompts/clean-rule-import.md      # 清洗规则导入提示词（粘贴用）
├── docs/superpowers/                 # 历史设计/实现计划（非运行时依赖）
├── start.bat
├── electron.vite.config.ts
├── electron-builder.yml
├── CONTEXT.md                        # 开发者文档（文件索引 / 数据流 / 坑点）
└── AGENTS.md                         # AI 助手项目指引
```

---

## 常用脚本

```bash
npm run dev         # 开发模式
npm run build       # 生产构建 → out/
npm run typecheck   # tsc（node + web）
npm run lint        # ESLint
npm run format      # Prettier
npm test            # 单元/跨层回归（见 package.json scripts.test）
npm run package     # 打包 NSIS 安装程序
```

---

## 键盘快捷键

**应用内**（窗口聚焦）：

| 快捷键 | 功能 |
|--------|------|
| `Space` | 播放 / 暂停 |
| `Esc` | 停止 |
| `Ctrl+F` | 搜索文本 |
| `Ctrl+Z` | 清洗页撤销 |

**全局**（设置中可改，默认 Ctrl+Alt 前缀）：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Alt+P` | 播放 / 暂停 |
| `Ctrl+Alt+S` | 停止 |
| `Ctrl+Alt+←` / `→` | 上一句 / 下一句 |
| `Ctrl+Alt+↑` / `↓` | 上一章 / 下一章 |
| `Ctrl+Alt+]` / `[` | 倍速 ±0.1x |
| `Ctrl+Alt+=` / `-` | 音量 ±5%（最高 200%） |
| `Ctrl+Alt+0` | 恢复默认倍速/音量 |

---

## 已知限制

1. **PDF** 只抽文字层；扫描件/图片 PDF 无文字，需 OCR 后粘贴到「快速文本」。
2. **截图 OCR** 需要本机 Python + RapidOCR。
3. **EPUB 图片/表格** 仅提取纯文本。
4. **MOBI/AZW** 依赖本机 Calibre `ebook-convert`；未安装时会给出明确错误提示。
5. **系统 TTS** 不支持 >100% 音量增益。
6. **章节大纲** 切章只读取缓存，不自动调 AI；需用户手动生成/重试。

---

*更详细的架构、文件索引、数据流、UI 约定与坑点见 `CONTEXT.md`。*

## License

[MIT](LICENSE)
