# Design

## UI

`App` 仅在 `readerMode === 'listening'` 时渲染现有 `ProgressBar + ControlBar`。新增独立的 `AiPlaybackCapsule`，在播放器视图且为 AI 阅读模式时固定到正文区域右下角；沉浸模式不卸载它。组件只消费现有播放器动作和状态，不复制播放逻辑。

`TitleBar` 继续拥有沉浸切换按钮，清理正文区残留入口与过时注释。

`AiSettingsPanel` 分为服务、任务分配、知识库三个常用区和一个折叠的高级区。服务卡支持模型获取、刷新、选择、连接测试、密钥显隐和状态反馈。高级区承载手动模型 ID、提示词、路由规则和超时。防剧透项全部删除。

## IPC And Services

在 `aiHandlers`/`preload` 增加模型列表、连接测试、知识库状态和重新同步 IPC。模型接口由主进程请求，避免渲染进程直接接触密钥。

nmem 桥接层解析 ingest 响应的 source/lifecycle 信息，并查询服务端来源状态。同步记录保存书籍内容哈希、source IDs、每章状态、更新时间和错误。调度器在启动、设置变化、导入和手动重试时对账；只有服务端确认可检索才标为 ready。

## Context

检索查询由最后一条用户消息、选中文本、当前句和章节标题去重拼接。发送给模型的阅读上下文继续包含书名、章节和当前句，并移除 spoiler prompt 与所有防剧透硬过滤。

## Compatibility

读取旧设置时忽略已删除的 spoiler 字段。旧的仅含 `ingestedAt` 状态视为待核验；若 nmem 找不到对应来源则重新同步。模型列表不可用时不阻断保存，允许在高级设置中填写模型 ID。

## Verification

用少量源码级/单元测试覆盖模式渲染条件、模型列表解析、知识库对账和查询组合；再运行类型检查、构建，并在 Electron 页面做一次桌面尺寸视觉检查。
