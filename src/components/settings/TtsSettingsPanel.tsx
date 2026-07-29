import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plus, Trash2, TestTube, Lock, Download, Copy } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePlayerStore } from '../../stores/playerStore'
import VoiceSelector from '../VoiceSelector'
import type { TTSEngineConfig } from '../../global'
import type { SettingsToast } from './GeneralSettingsPanel'

interface Props {
  showToast: SettingsToast
}

export default function TtsSettingsPanel({ showToast }: Props) {
  const { settings, setSettings, setApiKey, setEndpoint } = useSettingsStore()
  const { setSpeed, setVolume } = usePlayerStore()
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [engines, setEngines] = useState<TTSEngineConfig[]>([])
  const [showAddEngine, setShowAddEngine] = useState(false)
  const [engineForm, setEngineForm] = useState<Partial<TTSEngineConfig>>({
    type: 'http', name: '', apiUrl: '', apiKey: '', voices: []
  })
  const [engineVoicesInput, setEngineVoicesInput] = useState('')
  const [engineTesting, setEngineTesting] = useState<string | null>(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [deployJson, setDeployJson] = useState('')
  const [deployImporting, setDeployImporting] = useState(false)
  const [deployTemplateExpanded, setDeployTemplateExpanded] = useState(false)

  const loadEngines = async () => {
    const list = await window.api?.ttsGetEngines()
    if (list) setEngines(list)
  }

  useEffect(() => {
    void loadEngines()
  }, [])

  const handleTestConnection = async () => {
    setTesting(true)
    try {
      const result = await window.api?.ttsSynthesize('测试', settings.voiceId, 1, 0.5, settings.ttsEngine)
      if (result?.success) showToast('success', 'API 连接成功')
      else if (result?.fallback) showToast('warning', `API 不可用：${result.error || '未知'}，将使用离线 TTS`)
      else showToast('error', result?.error || '连接失败')
    } catch (error) {
      showToast('error', `测试失败: ${String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
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

              {/* Default volume（默认音量仍建议 ≤100%；播放时可临时增强到 200%） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  默认音量: {Math.round(settings.defaultVolume * 100)}%
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    （播放时可增强至 200%）
                  </span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={Math.min(1, settings.defaultVolume)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    setSettings({ defaultVolume: val })
                    setVolume(val)
                  }}
                  className="w-full"
                />
              </div>
            </div>
  )
}
