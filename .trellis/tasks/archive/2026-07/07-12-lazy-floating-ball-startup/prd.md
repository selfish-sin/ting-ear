# 启动时按需创建悬浮球

## Goal

减少听伴启动时不必要的渲染进程：主窗口启动时不立即创建悬浮球窗口，仅在用户实际需要悬浮球时创建。

## Background

- 受控启动确认只存在一个 Electron 主实例，不存在同一次启动创建两个主进程的问题。
- Electron 的 GPU、网络服务和渲染子进程属于框架正常行为。
- `floatingBallEnabled` 原先会在设置加载后触发 `showFloatingBall()`，导致启动时创建第二个 `BrowserWindow`。

## Requirements

- R1: 常规启动只创建主窗口，不在启动阶段创建悬浮球 `BrowserWindow`。
- R2: 关闭主窗口到托盘，或通过设置/命令显式显示时，按现有 IPC 链路创建和操作悬浮球。
- R3: 不修改 Electron 固有子进程、OCR Python 子进程或 TTS 行为。
- R4: 悬浮球显示 helper 必须幂等，重复显示不能创建多个窗口。

## Acceptance Criteria

- [x] AC1: 启动应用并保持主窗口打开时，只有主窗口对应的 renderer，没有悬浮球 renderer。
- [x] AC2: 关闭主窗口到托盘后，悬浮球按设置正常出现。
- [x] AC3: 隐藏后再次显示悬浮球不会重复创建窗口。
- [x] AC4: `npm run typecheck`、`npm run lint`、`npm test` 和 `npm run build` 通过。

## Decision

- 已启用悬浮球时，在主窗口关闭到托盘后自动创建；启动阶段保持单独的主窗口。
