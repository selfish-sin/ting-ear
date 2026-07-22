# 听伴（TingEar）— Windows 桌面 TTS 听书伴侣

> 版本：v3.2 ｜ 技术栈：Electron 28 + React 18 + TypeScript + Vite 5 + Tailwind CSS + Zustand
>
> 一个本地优先的 Windows 桌面应用：左边书架管理电子书，右边播放器逐句朗读。支持 Edge（免费）、千问（阿里云 API）、系统离线三种 TTS 引擎；截图 OCR 带放大镜与确认工具栏；LLM 文本清洗（本地 Ollama + 云端 DeepSeek/GLM）+ 编辑记录版本管理。

---

## 功能一览

| 模块 | 功能 |
|------|------|
| **书架管理** | 导入 EPUB / TXT / PDF / DOCX / MD / HTML，多本书并存，封面/进度持久化 |
| **文档解析** | EPUB(adm-zip)、TXT(编码检测 GBK/UTF-8)、PDF(pdf-parse v1)、DOCX(mammoth)、MD、HTML |
| **逐句播放器** | 句子高亮 + 自动滚动居中、点击跳转、进度条拖拽跨章节定位 |
| **TTS 引擎** | ① Edge 在线（免费，默认）② 千问 CosyVoice（阿里云 API）③ 系统离线（Web Speech API，自动降级） |
| **音色 / 语速 / 音量** | 多音色选择、0.5x~3.0x 语速、音量 + 静音 |
| **预选页（两步）** | 第 1 步选编辑记录版本（原始 / 切除空格 / AI 清洗），第 2 步选章节范围 → 开始阅读 |
| **截图 OCR** | 桌面截图 → 镂空选区 + 放大镜 + 8 点把手 + 确认工具栏 → RapidOCR → 快速文本 |
| **LLM 文本清洗** | 切除空格 / AI 清洗（Ollama 本地或 DeepSeek/GLM 云端）/ 手动编辑 / 撤销(Ctrl+Z) / 应用 |
| **编辑记录** | 每次清洗存为版本，可回看、切换、删除（最多保留 20 条） |
| **悬浮球** | 独立透明窗口，播放/暂停/上下章 |
| **书签 / 历史 / 日志** | 书签管理、收听历史恢复、运行日志面板 |
| **主题 / 快捷键** | 浅色/深色、Space 播放暂停、←→ 上下句、Esc 停止 |

---

## 快速开始

### 环境要求

- **Node.js 20+**、npm 10+
- **Python 3 + RapidOCR**（仅截图 OCR 功能需要；不装则 OCR 不可用，其余功能照常）

### 安装依赖

```bash
cd ting-ear
npm install
```

### 开发模式（带热重载）

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 打包为 Windows exe（NSIS 安装程序）

```bash
npm run package
```

> 仅打包目录不生成安装程序：`npm run package:dir`

---

## 配置说明

所有数据存放于 `%APPDATA%/听伴/`（实际目录名以 `app.getPath('userData')` 为准）：

```
%APPDATA%/听伴/
├── books.json       # 书籍数据 + 进度 + 编辑记录(editHistory)
├── settings.json    # 用户设置（含 LLM 配置）
└── logs.json        # 平台日志（最多 5000 条，超出自动裁剪）
```

### LLM / TTS 配置（settings.json）

现代码使用**多引擎 LLM 配置**，不再是单 key 模式：

```json
{
  "activeLlmId": "qwen3.5-4b",
  "llmConfigs": [
    { "id": "qwen3.5-4b", "name": "Qwen 3.5 4B", "type": "ollama", "baseUrl": "http://localhost:11434", "model": "qwen3.5:4b", "contextWindow": 32768 },
    { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "type": "openai", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-你的Key", "model": "deepseek-v4-flash", "contextWindow": 1048576 },
    { "id": "glm-4.5-air", "name": "GLM 4.5 Air", "type": "openai", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "apiKey": "你的Key", "model": "glm-4.5-air", "contextWindow": 131072 }
  ],
  "cleanPrompt": "（可选）自定义清洗 Prompt，留空则用内置默认 Prompt"
}
```

- **千问 TTS** 需在「设置 → TTS」中填写阿里云 API Key（CosyVoice HTTP 非实时合成接口，按句合成播放）。
- 未配置有效 Key 或网络异常时，播放自动降级到**系统离线 TTS**，不会中断。

---

## 项目结构

```
ting-ear/
├── electron/                      # Electron 主进程
│   ├── main.ts                    # 入口（窗口、托盘、日志、注册 IPC）
│   ├── preload.ts                 # 预加载脚本（contextBridge，所有 listener 返回 cleanup）
│   ├── ipc/                       # IPC 处理器
│   │   ├── fileHandlers.ts        # 文件选择 / 导入 / 导出音频 / JSON 读写
│   │   ├── ttsHandlers.ts         # TTS 合成 IPC
│   │   ├── textCleanHandlers.ts   # LLM 文本清洗 IPC
│   │   ├── ocrHandlers.ts         # 截图 OCR IPC
│   │   ├── floatingBallHandlers.ts
│   │   ├── windowHandlers.ts / bookmarkHandlers.ts / logHandlers.ts / historyHandlers.ts
│   ├── services/
│   │   ├── settings-service.ts    # LLM 默认配置 / cleanPrompt
│   │   ├── text-cleaner.ts        # 分块 + LLM 清洗核心
│   │   ├── llm/                   # adapter / ollama-adapter / openai-adapter / adapter-factory
│   │   ├── tts-engines/           # engine-manager / edge-adapter / qwen-adapter
│   │   ├── parsers/               # txt/epub/pdf/docx/md/html + textPreprocessor
│   │   └── log-service.ts
│   └── ocr/rapidocr_runner.py     # RapidOCR 子进程
├── src/                           # React 渲染进程
│   ├── App.tsx / main.tsx / global.d.ts
│   ├── components/                # 书架/播放器/清洗/截图/设置/悬浮球 等
│   ├── stores/                    # playerStore / bookStore / settingsStore / textCleanStore 等
│   ├── hooks/                     # useTTS / useKeyboard
│   └── styles/globals.css
├── tests/textPreprocessor.test.ts # 文本预处理单元测试
├── electron.vite.config.ts / electron-builder.yml / tailwind.config.js
├── CONTEXT.md # 项目上下文（开发者向：文件索引+行号+数据流+设计速查+坑点+验证清单）
```

---

## 常用脚本

```bash
npm run dev         # 开发模式
npm run build       # 生产构建（输出到 out/）
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run format      # Prettier 格式化
npm test            # 单元测试（textPreprocessor，依赖 tsx）
npm run package     # 打包 NSIS 安装程序
```

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Space` | 播放 / 暂停 |
| `←` | 上一句 |
| `→` | 下一句 |
| `Esc` | 停止（回到开头） |

---

## 已知限制

1. **PDF** 仅提取文字层；扫描件/图片 PDF 无文字，需先用 OCR 处理再粘贴到「快速文本」。
2. **千问 TTS** 未配置真实 Key 时自动降级系统离线 TTS。
3. **截图 OCR** 需要本机 Python + RapidOCR 环境。
4. **EPUB 图片 / 表格**：仅提取纯文本，图片显示为空。

---

*本文档对应《听伴》v3.3。更详细的架构、文件索引、数据流、设计速查与坑点见 `CONTEXT.md`。*

---

## License

[MIT](LICENSE)
