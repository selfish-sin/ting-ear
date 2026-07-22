import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, ExternalLink, Database, Plus, Trash2, TestTube, Lock, Download, Copy } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useHistoryStore } from '../stores/historyStore'
import VoiceSelector from './VoiceSelector'
import CleanRulesSettings from './CleanRulesSettings'
import { SHORTCUT_ACTION_LIST, keyToAccelerator, acceleratorToKeys, acceleratorPreview, isModifierKey, requiresModifier } from '../shortcuts'
import type { TTSEngineConfig, ShortcutAction } from '../global'

interface SettingsModalProps {
  onClose: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

type Tab = 'general' | 'tts' | 'appearance' | 'clean' | 'shortcuts' | 'about'

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'general', label: '常规' },
  { key: 'tts', label: '朗读' },
  { key: 'appearance', label: '外观' },
  { key: 'clean', label: '清洗' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'about', label: '关于' }
]

export default function SettingsModal({ onClose, showToast }: SettingsModalProps) {
  const { settings, setSettings, setTheme, setOpacity, setAlwaysOnTop, setFontSize, setApiKey, setEndpoint, setFloatingBallEnabled, setShortcuts } =
    useSettingsStore()
  const { setSpeed, setVolume, resetToQwenTTS } = usePlayerStore()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [capturingKey, setCapturingKey] = useState<ShortcutAction | null>(null)
  // 捕获过程中的实时预览：显示已按下的修饰键组合（按主键前先看到 "Ctrl+Alt"）
  const [previewAcc, setPreviewAcc] = useState('')

  // Engine management state
  const [engines, setEngines] = useState<TTSEngineConfig[]>([])
  const [showAddEngine, setShowAddEngine] = useState(false)
  const [engineForm, setEngineForm] = useState<Partial<TTSEngineConfig>>({
    type: 'http',
    name: '',
    apiUrl: '',
    apiKey: '',
    voices: []
  })
  const [engineVoicesInput, setEngineVoicesInput] = useState('')
  const [engineTesting, setEngineTesting] = useState<string | null>(null)

  // 一键部署 state
  const [showDeploy, setShowDeploy] = useState(false)
  const [deployJson, setDeployJson] = useState('')
  const [deployImporting, setDeployImporting] = useState(false)
  const [deployTemplateExpanded, setDeployTemplateExpanded] = useState(false)

  const loadEngines = async () => {
    const list = await window.api?.ttsGetEngines()
    if (list) setEngines(list)
  }

  useEffect(() => {
    if (activeTab === 'tts') loadEngines()
  }, [activeTab])

  // 快捷键捕获：点击某条后，监听下一次键盘输入
  // 捕获快捷键期间，临时停用主进程的全部全局快捷键，
  // 否则按到已被注册的键（如 Ctrl+Alt+P）会直接触发播放
  useEffect(() => {
    if (!capturingKey) return
    window.api?.applyShortcuts({})
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingKey(null)
        setPreviewAcc('')
        showToast('info', '已取消设置')
        return
      }
      // 纯修饰键（Ctrl/Alt/Shift…）单独按下：先更新预览、继续等待主键，
      // 让用户能实时看到已经按住的修饰键（如 "Ctrl+Alt"）。
      if (isModifierKey(e.key)) {
        setPreviewAcc(acceleratorPreview(e))
        return
      }
      const acc = keyToAccelerator(e)
      // 主键（字母/方向键/Space 等）按下时，该次 keydown 已携带完整修饰键状态，
      // 因此可在此瞬间直接捕获完整组合键（如 Ctrl+Space）。
      if (!acc) return
      // 强制要求修饰键：避免把方向键/Space 等单键绑成全局快捷键，
      // 否则会覆盖播放器内的方向键行为（如单按 ←/→ 跳句）。
      if (!requiresModifier(acc)) {
        showToast('warning', '快捷键需包含 Ctrl / Alt / Shift 等修饰键')
        return
      }
      setShortcuts({ ...(useSettingsStore.getState().settings.shortcuts || {}), [capturingKey]: acc })
      setPreviewAcc('')
      setCapturingKey(null)
      showToast('success', `已设置：${acc}`)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      // 捕获结束：恢复全局快捷键（使用当前已保存的设置）
      window.api?.applyShortcuts((useSettingsStore.getState().settings.shortcuts || {}) as Record<string, string>)
    }
  }, [capturingKey, setShortcuts, showToast])

  const handleTestConnection = async () => {
    setTesting(true)
    try {
      // 触发一次最小 TTS 请求；引擎/音色由 VoiceSelector 同步切换
      const result = await window.api?.ttsSynthesize('测试', settings.voiceId, 1, 0.5, settings.ttsEngine)
      if (result?.success) {
        showToast('success', 'API 连接成功')
      } else if (result?.fallback) {
        showToast('warning', `API 不可用：${result.error || '未知'}，将使用离线 TTS`)
      } else {
        showToast('error', result?.error || '连接失败')
      }
    } catch (error) {
      showToast('error', `测试失败: ${String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">设置</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <div className="space-y-5">
              {/* Data directory */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">数据存储</h3>
                <div className="flex items-center gap-2 text-xs">
                  <Database className="w-4 h-4 text-gray-400" />
                  <code className="flex-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-900 rounded text-gray-600 dark:text-gray-400">
                    %APPDATA%/听伴/
                  </code>
                </div>
              </div>

              {/* Window behavior */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">窗口行为</h3>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.windowAlwaysOnTop}
                    onChange={(e) => setAlwaysOnTop(e.target.checked)}
                  />
                  窗口置顶
                </label>

                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={settings.floatingBallEnabled}
                    onChange={(e) => setFloatingBallEnabled(e.target.checked)}
                  />
                  显示悬浮窗
                </label>
              </div>

              {/* Reset TTS engine */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">TTS 引擎</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  如果离线 TTS 降级后想重新使用千问 TTS，可点击下方按钮重置。
                </p>
                <button
                  onClick={() => {
                    resetToQwenTTS()
                    showToast('success', '已重置为千问 TTS 模式')
                  }}
                  className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
                >
                  重置 TTS 引擎
                </button>
              </div>

              {/* 清除缓存 */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">清除缓存</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  清理本地数据，不会影响模型配置和朗读设置
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除书架数据？（书籍、封面、编辑记录）')) return
                      await (window.api as any)?.clearCache('books')
                      useBookStore.getState().loadBooks()
                      showToast('success', '书架数据已清除并刷新')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    🗑 书籍 & 封面
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除收听历史？')) return
                      await (window.api as any)?.clearCache('history')
                      useHistoryStore.getState().loadHistory()
                      showToast('success', '收听历史已清除并刷新')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    🕐 收听历史
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除语音缓存？（Edge / 千问已合成的音频）')) return
                      await (window.api as any)?.clearCache('audio')
                      showToast('success', '语音缓存已清除')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    🔊 语音缓存
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除日志？')) return
                      await (window.api as any)?.clearCache('logs')
                      showToast('success', '日志已清除')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    📋 日志 & 书签
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('⚠️ 确定清除全部数据？\n\n书架、历史、缓存、日志全部清空。\n模型配置和朗读设置会保留。')) return
                      await (window.api as any)?.clearCache('all')
                      useBookStore.getState().loadBooks()
                      useHistoryStore.getState().loadHistory()
                      showToast('success', '全部缓存已清除并刷新（模型配置保留）')
                    }}
                    className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    全部清除（保留设置）
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tts' && (
            <div className="space-y-5">
              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  千问 API Key
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={settings.qwenApiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-xxxxxxxx"
                      className="w-full px-3 py-2 pr-10 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {testing ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  🔒 Key 仅存储在本地，不会上传至任何服务器
                </p>
              </div>

              {/* Endpoint */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  API Endpoint
                </label>
                <input
                  type="text"
                  value={settings.qwenEndpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
              </div>

              {/* Voice：复用 ControlBar 同款下沉式下拉（引擎名头部 + 性别/语言徽章 + 试听） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  默认音色
                </label>
                <VoiceSelector showToast={showToast} />
                <p className="text-xs text-gray-400 mt-1">
                  选择音色会自动切换所属 TTS 引擎；千问音色需配置 API Key。
                </p>
              </div>

              {/* Engine Management */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">引擎管理</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowDeploy((v) => !v); setShowAddEngine(false) }}
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      一键部署
                    </button>
                    <button
                      onClick={() => { setShowAddEngine((v) => !v); setShowDeploy(false) }}
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      新增引擎
                    </button>
                  </div>
                </div>

                {/* Add engine form */}
                {showAddEngine && (
                  <div className="mb-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 space-y-2">
                    {/* URL — with auto-detect button */}
                    <div className="flex gap-1">
                      <input
                        type="text" placeholder="API URL（必填）"
                        value={engineForm.apiUrl || ''}
                        onChange={(e) => setEngineForm((f) => ({ ...f, apiUrl: e.target.value }))}
                        className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded font-mono"
                      />
                      <button
                        onClick={async () => {
                          const url = engineForm.apiUrl
                          if (!url) { showToast('warning', '请先输入 API URL'); return }
                          setEngineTesting('_probe')
                          try {
                            const probe = await window.api?.ttsProbeEngineUrl(url, engineForm.apiKey)
                            if (probe) {
                              setEngineForm((f) => ({
                                ...f,
                                name: f.name || probe.suggestedName,
                                type: probe.suggestedType
                              }))
                              showToast('success', `检测到 ${probe.isOpenAICompatible ? 'OpenAI 兼容' : 'HTTP'} 接口，名称建议: ${probe.suggestedName}`)
                            }
                          } catch { showToast('warning', '探测失败') }
                          finally { setEngineTesting(null) }
                        }}
                        disabled={engineTesting === '_probe'}
                        className="shrink-0 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
                        title="自动检测引擎类型和建议名称"
                      >
                        {engineTesting === '_probe' ? '...' : '🔍 检测'}
                      </button>
                    </div>

                    {/* Name — auto-suggested when URL is probed */}
                    <input
                      type="text" placeholder="引擎名称（自动从 URL 推断）"
                      value={engineForm.name || ''}
                      onChange={(e) => setEngineForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded"
                    />

                    {/* Type — auto-suggested when URL is probed */}
                    <select
                      value={engineForm.type || 'http'}
                      onChange={(e) => setEngineForm((f) => ({ ...f, type: e.target.value as TTSEngineConfig['type'] }))}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded"
                    >
                      <option value="http">HTTP（通用）</option>
                      <option value="openai">OpenAI 兼容（/v1/audio/speech）</option>
                      <option value="local">本地</option>
                    </select>

                    {/* API Key */}
                    <input
                      type="password" placeholder="API Key（可选）"
                      value={engineForm.apiKey || ''}
                      onChange={(e) => setEngineForm((f) => ({ ...f, apiKey: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded"
                    />

                    {/* Voice section — auto-discover or manual */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-400">音色列表</span>
                        <button
                          onClick={async () => {
                            if (!engineForm.apiUrl) {
                              showToast('warning', '请先填写 API URL')
                              return
                            }
                            setEngineTesting('_discover')
                            try {
                              const result = await window.api?.ttsDiscoverVoicesForConfig({
                                ...engineForm,
                                id: '_probe',
                                name: engineForm.name || '临时探测',
                                enabled: true,
                                type: engineForm.type || 'http'
                              })
                              if (result && result.voices.length > 0) {
                                setEngineVoicesInput(result.voices.map((v) => v.id).join(', '))
                                setEngineForm((f) => ({ ...f, voices: result.voices }))
                                showToast('success', `自动发现 ${result.voices.length} 个音色`)
                              } else {
                                showToast('warning', result?.error || '未发现音色，请手动输入')
                              }
                            } catch (error) {
                              const msg = error instanceof Error ? error.message : String(error)
                              showToast('warning', `音色发现失败：${msg}`)
                            }
                            finally { setEngineTesting(null) }
                          }}
                          disabled={engineTesting === '_discover'}
                          className="text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                          {engineTesting === '_discover' ? '发现中…' : '🔍 自动发现'}
                        </button>
                      </div>
                      <input
                        type="text" placeholder="音色 ID（逗号分隔；可点「自动发现」尝试获取）"
                        value={engineVoicesInput}
                        onChange={(e) => setEngineVoicesInput(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded"
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!engineForm.name || !engineForm.apiUrl) {
                            showToast('warning', '名称和 API URL 为必填')
                            return
                          }
                          const voiceIds = engineVoicesInput.split(',').map((s) => s.trim()).filter(Boolean)
                          const discoveredVoices = engineForm.voices || []
                          const voices = voiceIds.map((id) => (
                            discoveredVoices.find((voice) => voice.id === id) || { id, name: id }
                          ))
                          const newEngine: TTSEngineConfig = {
                            ...engineForm,
                            id: `custom-${Date.now()}`,
                            name: engineForm.name,
                            enabled: true,
                            type: engineForm.type || 'http',
                            voices: voices.length > 0 ? voices : undefined
                          } as TTSEngineConfig
                          await window.api?.ttsAddEngine(newEngine)
                          setShowAddEngine(false)
                          setEngineForm({ type: 'http', name: '', apiUrl: '', apiKey: '', voices: [] })
                          setEngineVoicesInput('')
                          showToast('success', '引擎已添加')
                          loadEngines()
                        }}
                        className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setShowAddEngine(false)}
                        className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:underline"
                      >
                        取消
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">
                      提示：先填 URL → 点「检测」自动推断类型和名称 → 点「自动发现」获取音色列表。保存后可在音色选择器中使用。
                    </p>
                  </div>
                )}

                {/* === 一键部署面板 === */}
                {showDeploy && (
                  <div className="mb-3 p-3 border border-primary/30 dark:border-primary/40 rounded-lg bg-primary/5 dark:bg-primary/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">一键部署引擎</span>
                      <span className="text-[10px] text-gray-400">支持 curl / Python / JSON</span>
                    </div>

                    <textarea
                      placeholder={`直接粘贴 curl 命令、Python 代码或 JSON 配置…
如：
curl https://api.openai.com/v1/audio/speech \\
  -H "Authorization: Bearer sk-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Hello world","voice":"alloy"}'

或：
requests.post("https://api.openai.com/v1/audio/speech",
  headers={"Authorization": "Bearer sk-xxx"},
  json={"model":"tts-1","input":"Hello","voice":"alloy"})`}
                      value={deployJson}
                      onChange={(e) => setDeployJson(e.target.value)}
                      rows={8}
                      className="w-full px-2.5 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded font-mono resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
                      spellCheck={false}
                    />

                    {/* 模板展开 */}
                    <div>
                      <button
                        onClick={() => setDeployTemplateExpanded((v) => !v)}
                        className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                      >
                        {deployTemplateExpanded ? '▾' : '▸'} 还是手动填 JSON？（展开配置模板）
                      </button>
                      {deployTemplateExpanded && (
                        <pre className="mt-1 p-2 text-[10px] bg-gray-100 dark:bg-gray-900 rounded text-gray-500 dark:text-gray-400 overflow-x-auto font-mono leading-relaxed">
{`{
  "name": "引擎名称（必填）",
  "apiUrl": "https://api.example.com/v1/audio/speech（必填）",
  "type": "openai",
  "apiKey": "你的 API Key",
  "requestMethod": "POST",
  "requestTemplate": { "model": "tts-1", "input": "{text}", "voice": "{voice}" },
  "responseAudioField": "audio",
  "responseFormat": "base64",
  "voices": [
    { "id": "voice1", "name": "显示名", "language": "zh-CN", "gender": "female" }
  ]
}`}
                        </pre>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!deployJson.trim()) {
                            showToast('warning', '请先粘贴 curl / Python / JSON 配置')
                            return
                          }
                          setDeployImporting(true)
                          try {
                            const result = await window.api?.ttsImportEngine(deployJson)
                            if (result?.success) {
                              const fmt = result.detectedFormat
                                ? `（识别为 ${result.detectedFormat} 格式）`
                                : ''
                              showToast('success', `引擎「${result.config?.name}」部署成功${fmt}`)
                              setDeployJson('')
                              setShowDeploy(false)
                              loadEngines()
                            } else {
                              showToast('error', result?.error || '部署失败')
                            }
                          } catch (error) {
                            const msg = error instanceof Error ? error.message : String(error)
                            showToast('error', `部署请求失败：${msg}`)
                          } finally {
                            setDeployImporting(false)
                          }
                        }}
                        disabled={deployImporting}
                        className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        {deployImporting ? '部署中...' : '导入部署'}
                      </button>
                      <button
                        onClick={() => { setShowDeploy(false); setDeployJson('') }}
                        className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:underline"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => {
                          setDeployJson(`curl https://api.example.com/v1/audio/speech \\
  -H "Authorization: Bearer 填入你的 Key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Hello","voice":"alloy"}'`)
                        }}
                        className="ml-auto px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        填入模板
                      </button>
                    </div>
                  </div>
                )}

                {/* Engine list */}
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {engines.map((eng) => {
                    const isBuiltin = ['qwen', 'edge', 'system'].includes(eng.type)
                    return (
                      <div
                        key={eng.id}
                        className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-2">
                          {isBuiltin && <Lock className="w-3 h-3 text-gray-400" />}
                          <span className="text-gray-700 dark:text-gray-300">{eng.name}</span>
                          <span className="text-gray-400">({eng.type})</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => {
                              setEngineTesting(eng.id)
                              const ok = await window.api?.ttsTestEngine(eng.id)
                              if (ok) showToast('success', `${eng.name} 连接成功`)
                              else showToast('error', `${eng.name} 连接失败`)
                              setEngineTesting(null)
                            }}
                            disabled={engineTesting === eng.id}
                            className="p-1 text-gray-400 hover:text-primary rounded"
                            title="测试连接"
                          >
                            {engineTesting === eng.id ? (
                              <span className="text-xs">...</span>
                            ) : (
                              <TestTube className="w-3 h-3" />
                            )}
                          </button>
                          {!isBuiltin && (
                            <>
                              <button
                                onClick={async () => {
                                  const curl = await window.api?.ttsExportEngine(eng.id)
                                  if (curl) {
                                    try {
                                      await navigator.clipboard.writeText(curl)
                                      showToast('success', 'curl 命令已复制到剪贴板')
                                    } catch {
                                      setDeployJson(curl)
                                      setShowDeploy(true)
                                      showToast('info', '已填入部署面板，可手动复制')
                                    }
                                  } else {
                                    showToast('error', '导出失败')
                                  }
                                }}
                                className="p-1 text-gray-400 hover:text-primary rounded"
                                title="导出部署配置"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                onClick={async () => {
                                  await window.api?.ttsDeleteEngine(eng.id)
                                  showToast('success', '引擎已删除')
                                  loadEngines()
                                }}
                                className="p-1 text-gray-400 hover:text-red-500 rounded"
                                title="删除引擎"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Default speed */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  默认语速: {settings.defaultSpeed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={settings.defaultSpeed}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    setSettings({ defaultSpeed: val })
                    setSpeed(val)
                  }}
                  className="w-full"
                />
              </div>

              {/* Default volume */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  默认音量: {Math.round(settings.defaultVolume * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.defaultVolume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    setSettings({ defaultVolume: val })
                    setVolume(val)
                  }}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-5">
              {/* Theme */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">主题</label>
                <div className="flex gap-3">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                        settings.theme === t
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary/30'
                      }`}
                    >
                      {t === 'light' ? '☀️ 浅色' : t === 'dark' ? '🌙 深色' : '💻 跟随系统'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Window opacity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  窗口透明度: {Math.round(settings.windowOpacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0.4"
                  max="1.0"
                  step="0.05"
                  value={settings.windowOpacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Font size */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  正文字号: {settings.fontSize.body}px
                </label>
                <input
                  type="range"
                  min="14"
                  max="24"
                  step="1"
                  value={settings.fontSize.body}
                  onChange={(e) => setFontSize(parseInt(e.target.value), settings.fontSize.title)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  书名字号: {settings.fontSize.title}px
                </label>
                <input
                  type="range"
                  min="16"
                  max="28"
                  step="1"
                  value={settings.fontSize.title}
                  onChange={(e) => setFontSize(settings.fontSize.body, parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}


          {activeTab === 'clean' && (
            <CleanRulesSettings showToast={showToast} />
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">全局快捷键</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    即使焦点在其它窗口，也能控制听伴播放。修改即时生效并自动保存。
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShortcuts({})
                    showToast('success', '已恢复默认快捷键')
                  }}
                  className="shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  恢复默认
                </button>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                {SHORTCUT_ACTION_LIST.map((item) => {
                  const current = settings.shortcuts?.[item.key] || ''
                  const isCapturing = capturingKey === item.key
                  return (
                    <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-700 dark:text-gray-200">{item.label}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{item.description}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            if (isCapturing) {
                              // 再次点击正在捕获的条目 → 取消捕获
                              setCapturingKey(null)
                              setPreviewAcc('')
                              showToast('info', '已取消设置')
                            } else {
                              setPreviewAcc('')
                              setCapturingKey(item.key)
                            }
                          }}
                          onDoubleClick={() => {
                            // 双击已设置的条目 → 直接清空该快捷键（仅在非捕获态）
                            if (isCapturing || !current) return
                            setShortcuts({ ...(settings.shortcuts || {}), [item.key]: '' })
                            showToast('info', `已清除「${item.label}」`)
                          }}
                          title={isCapturing ? '再次点击取消' : current ? '单击重新设置 · 双击清除' : '单击设置快捷键'}
                          className={`min-w-[130px] h-9 px-3 rounded-lg border transition-all duration-150 flex items-center justify-center gap-1 ${
                            isCapturing
                              ? 'border-primary bg-primary/10 text-primary animate-capture'
                              : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:scale-[1.02] active:scale-[0.98]'
                          }`}
                        >
                          {isCapturing ? (
                            previewAcc ? (
                              <span className="flex items-center gap-1">
                                {acceleratorToKeys(previewAcc).map((k, i) => (
                                  <kbd
                                    key={i}
                                    className="inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded-md text-xs font-medium
                                      bg-primary/15 text-primary border border-primary/30 shadow-sm"
                                  >
                                    {k}
                                  </kbd>
                                ))}
                                <span className="text-[11px] text-primary/70 ml-0.5">…</span>
                              </span>
                            ) : (
                              <span className="text-xs text-primary">按下快捷键…</span>
                            )
                          ) : current ? (
                            acceleratorToKeys(current).map((k, i) => (
                              <kbd
                                key={i}
                                className="inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded-md text-xs font-medium
                                  bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200
                                  border border-gray-200 dark:border-gray-600 shadow-sm"
                              >
                                {k}
                              </kbd>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400">未设置</span>
                          )}
                        </button>
                        {current && !isCapturing && (
                          <button
                            onClick={() => {
                              const next = { ...(settings.shortcuts || {}), [item.key]: '' }
                              setShortcuts(next)
                            }}
                            title="清除此快捷键"
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                提示：建议搭配 Ctrl / Alt / Shift 等修饰键，避免与系统或其它软件冲突。
                单击条目后直接按下想要的按键组合即可，按住修饰键时会实时预览；
                再次单击正在捕获的条目、或按 Esc 可取消；双击已设置的条目可快速清除。
              </p>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-xl bg-primary flex items-center justify-center">
                <span className="text-white text-2xl font-bold">听</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">听伴 TingEar</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">v2.0.0 · 2026-07-02</p>
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
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
