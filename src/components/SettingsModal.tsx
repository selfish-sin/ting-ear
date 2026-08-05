import { useState } from 'react'
import { X } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import CleanRulesSettings from './CleanRulesSettings'
import AiSettingsPanel from './settings/AiSettingsPanel'
import BackgroundSettingsPanel from './settings/BackgroundSettingsPanel'
import GeneralSettingsPanel from './settings/GeneralSettingsPanel'
import TtsSettingsPanel from './settings/TtsSettingsPanel'
import { mergeAiSettings } from '../aiSettings'

interface SettingsModalProps {
  onClose: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

type Tab = 'general' | 'background' | 'tts' | 'ai' | 'clean'

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'general', label: '常规' },
  { key: 'background', label: '背景' },
  { key: 'tts', label: '朗读' },
  { key: 'ai', label: 'AI' },
  { key: 'clean', label: '清洗' }
]

export default function SettingsModal({ onClose, showToast }: SettingsModalProps) {
  const { settings, setSettings } = useSettingsStore()
  const [activeTab, setActiveTab] = useState<Tab>('general')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* 仅遮罩，不响应点击关闭 —— 必须点右上角/底部关闭按钮 */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      <div className="relative z-10 flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label="关闭设置"
            title="关闭设置"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 标签可横向滚动，窄窗不挤成两行 */}
        <div className="flex overflow-x-auto border-b border-gray-200 px-2 dark:border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                activeTab === tab.key
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'general' && <GeneralSettingsPanel showToast={showToast} />}
          {activeTab === 'background' && <BackgroundSettingsPanel showToast={showToast} />}
          {activeTab === 'ai' && (
            <AiSettingsPanel value={mergeAiSettings(settings.ai)} onChange={(ai) => setSettings({ ai })} />
          )}
          {activeTab === 'tts' && <TtsSettingsPanel showToast={showToast} />}
          {activeTab === 'clean' && <CleanRulesSettings showToast={showToast} />}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-2.5 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm text-[rgb(var(--on-primary-rgb))] hover:bg-primary/90"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
