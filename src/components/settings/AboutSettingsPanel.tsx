import { ExternalLink } from 'lucide-react'

export default function AboutSettingsPanel() {
  return (
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-xl bg-primary flex items-center justify-center">
                <span className="text-white text-2xl font-bold">听</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">听伴 TingEar</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">v1.0.0</p>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                一个轻量 Windows 桌面 TTS 朗读伴侣，专为本地个人阅读设计。
                所有数据只存在你的电脑里，不联网、无广告。
              </p>
              <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1">
                <p>技术栈：Electron 28 + React 18 + TypeScript + Vite</p>
                <p>TTS 引擎：千问3-TTS-Flash + Windows 系统 TTS</p>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-primary">
                <ExternalLink className="w-3.5 h-3.5" />
                <span>MIT 开源协议</span>
              </div>
            </div>
  )
}
