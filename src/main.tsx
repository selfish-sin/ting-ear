import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FloatingBallWindow } from './components/FloatingBall'
import ScreenshotOverlay from './components/ScreenshotOverlay'
import { SubtitleWindow } from './components/SubtitleWindow'
import './styles/globals.css'

// 辅助窗口提前分流：避免挂载完整 App 树（hooks/store/IPC 全部跳过）
const hash = window.location.hash
let Root = App
if (hash === '#/floating') Root = FloatingBallWindow
else if (hash === '#/screenshot') Root = ScreenshotOverlay
else if (hash === '#/subtitle') Root = SubtitleWindow

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)
