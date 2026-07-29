import { useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap
} from 'lucide-react'
import type { AiEngine, AiProvider, AiSettings } from '../../global'
import { PROVIDER_PRESETS, detectProvider } from '../../aiProvider'

interface AiSettingsPanelProps {
  value: AiSettings
  onChange: (value: AiSettings) => void
}

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

const btnClass =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors'

const cardClass =
  'rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-600 dark:bg-gray-800/60'

type AsyncState = { status: 'idle' | 'loading' | 'ok' | 'fail'; error?: string }

let engineIdCounter = 0
function newEngineId(): string {
  return `engine-${Date.now()}-${++engineIdCounter}`
}

function engineModels(engine: AiEngine, fetched: string[]): string[] {
  const set = new Set<string>()
  if (engine.model) set.add(engine.model)
  if (engine.fallbackModel) set.add(engine.fallbackModel)
  for (const modelId of fetched) set.add(modelId)
  return [...set]
}

function providerLabel(engine: AiEngine): string {
  const id = engine.provider || detectProvider(engine.baseUrl)
  return PROVIDER_PRESETS.find((p) => p.provider === id)?.label || id || '自定义'
}

function hostHint(url: string): string {
  const cleaned = (url || '').replace(/^["']|["']$/g, '').trim()
  if (!cleaned) return '未配置地址'
  try {
    const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
    return new URL(withProto).host
  } catch {
    return cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned
  }
}

function maskKey(key: string): string {
  const t = (key || '').trim()
  if (!t) return '未填 Key'
  if (t.length <= 8) return '已配置 ···'
  return `${t.slice(0, 3)}···${t.slice(-4)}`
}

export default function AiSettingsPanel({ value, onChange }: AiSettingsPanelProps) {
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set())
  const [modelsMap, setModelsMap] = useState<Record<string, string[]>>({})
  const [modelsState, setModelsState] = useState<Record<string, AsyncState>>({})
  const [testState, setTestState] = useState<Record<string, AsyncState>>({})
  const [nmemTest, setNmemTest] = useState<AsyncState>({ status: 'idle' })
  const [syncState, setSyncState] = useState<AsyncState>({ status: 'idle' })
  const [dedupeState, setDedupeState] = useState<AsyncState>({ status: 'idle' })
  /** 当前展开编辑的引擎；null = 只显示缩略卡 */
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  /** 高级设置折叠 */
  const [showAdvanced, setShowAdvanced] = useState(false)

  const engines = value.engines?.length ? value.engines : [{ id: 'default', name: '默认引擎', ...value.llm }]
  const editingEngine = engines.find((e) => e.id === editingEngineId) || null

  const updateEngines = (next: AiEngine[]) => {
    onChange({ ...value, engines: next, llm: next[0] || value.llm })
  }

  const updateEngine = (id: string, partial: Partial<AiEngine>) => {
    updateEngines(engines.map((e) => (e.id === id ? { ...e, ...partial } : e)))
  }

  const addEngine = () => {
    const id = newEngineId()
    updateEngines([
      ...engines,
      {
        id,
        name: `引擎 ${engines.length + 1}`,
        baseUrl: '',
        apiKey: '',
        model: '',
        fallbackModel: '',
        temperature: 0.3,
        timeoutMs: 60000
      }
    ])
    setEditingEngineId(id)
  }

  const removeEngine = (id: string) => {
    if (engines.length <= 1) return
    const remaining = engines.filter((e) => e.id !== id)
    const taskAssignment = { ...value.taskAssignment }
    if (taskAssignment.chat === id) taskAssignment.chat = remaining[0].id
    if (taskAssignment.outline === id) taskAssignment.outline = remaining[0].id
    onChange({ ...value, engines: remaining, llm: remaining[0], taskAssignment })
    if (editingEngineId === id) setEditingEngineId(null)
  }

  const updateTaskAssignment = (task: 'chat' | 'outline', engineId: string) => {
    onChange({ ...value, taskAssignment: { ...value.taskAssignment, [task]: engineId } })
  }

  const updateChat = (partial: Partial<AiSettings['chat']>) => {
    onChange({ ...value, chat: { ...value.chat, ...partial } })
  }

  const updateNmem = (partial: Partial<AiSettings['nmem']>) => {
    onChange({ ...value, nmem: { ...value.nmem, ...partial } })
  }

  const updateRetrieval = (partial: Partial<AiSettings['retrieval']>) => {
    onChange({ ...value, retrieval: { ...value.retrieval, ...partial } })
  }

  const toggleKey = (id: string) => {
    setShowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fetchModels = async (engine: AiEngine) => {
    setModelsState((prev) => ({ ...prev, [engine.id]: { status: 'loading' } }))
    try {
      const result = await window.api.aiListModels(engine)
      if (result.success && result.models) {
        setModelsMap((prev) => ({ ...prev, [engine.id]: result.models! }))
        setModelsState((prev) => ({ ...prev, [engine.id]: { status: 'ok' } }))
      } else {
        setModelsState((prev) => ({
          ...prev,
          [engine.id]: { status: 'fail', error: result.error || '获取失败' }
        }))
      }
    } catch (error) {
      setModelsState((prev) => ({
        ...prev,
        [engine.id]: { status: 'fail', error: error instanceof Error ? error.message : String(error) }
      }))
    }
  }

  const testConnection = async (engine: AiEngine) => {
    setTestState((prev) => ({ ...prev, [engine.id]: { status: 'loading' } }))
    try {
      const result = await window.api.aiTestModel(engine)
      if (result.success) {
        if (result.models) setModelsMap((prev) => ({ ...prev, [engine.id]: result.models! }))
        setTestState((prev) => ({ ...prev, [engine.id]: { status: 'ok' } }))
      } else {
        setTestState((prev) => ({
          ...prev,
          [engine.id]: { status: 'fail', error: result.error || '连接失败' }
        }))
      }
    } catch (error) {
      setTestState((prev) => ({
        ...prev,
        [engine.id]: { status: 'fail', error: error instanceof Error ? error.message : String(error) }
      }))
    }
  }

  const testNmem = async () => {
    setNmemTest({ status: 'loading' })
    try {
      const result = await window.api.aiNmemStatus(true)
      if (result.status === 'online') {
        setNmemTest({ status: 'ok' })
      } else {
        setNmemTest({ status: 'fail', error: result.error || '知识库离线' })
      }
    } catch (error) {
      setNmemTest({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const syncAll = async () => {
    setSyncState({ status: 'loading' })
    try {
      const result = await window.api.aiNmemSyncAll(false)
      if (result.success) {
        const synced = result.synced ?? 0
        const skipped = result.skipped ?? 0
        const failed = result.failed ?? 0
        if (failed > 0 && synced === 0) {
          setSyncState({ status: 'fail', error: `${failed} 本失败` })
        } else {
          setSyncState({
            status: 'ok',
            error:
              skipped > 0 || failed > 0
                ? `成功 ${synced}，跳过 ${skipped}${failed ? `，失败 ${failed}` : ''}`
                : undefined
          })
        }
      } else {
        setSyncState({ status: 'fail', error: result.error || '同步失败' })
      }
    } catch (error) {
      setSyncState({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const dedupe = async () => {
    setDedupeState({ status: 'loading' })
    try {
      const result = await window.api.aiNmemDedupe()
      if (result.success) {
        const removed = result.removed ?? 0
        setDedupeState({
          status: 'ok',
          error: removed > 0 ? `已删除 ${removed} 个重复源` : '无重复源'
        })
      } else {
        setDedupeState({ status: 'fail', error: result.error || '去重失败' })
      }
    } catch (error) {
      setDedupeState({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const statusDot = (state: AsyncState | undefined) => {
    if (!state || state.status === 'idle') return null
    if (state.status === 'loading') return <span className="text-xs text-gray-400">进行中…</span>
    if (state.status === 'ok') {
      return (
        <span className="text-xs text-green-600">
          {state.error ? `成功（${state.error}）` : '成功'}
        </span>
      )
    }
    return <span className="text-xs text-red-500">{state.error || '失败'}</span>
  }

  const chatEngineName =
    engines.find((e) => e.id === (value.taskAssignment?.chat || engines[0]?.id))?.name || '—'
  const outlineEngineName =
    engines.find((e) => e.id === (value.taskAssignment?.outline || engines[0]?.id))?.name || '—'

  return (
    <div className="space-y-4">
      {/* ===== AI 引擎：缩略卡列表 + 点编辑进详情 ===== */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">AI 引擎</h3>
            <span className="truncate text-[11px] text-gray-400">
              {engines.length} 个 · 对话 {chatEngineName} · 大纲 {outlineEngineName}
            </span>
          </div>
          <button
            type="button"
            onClick={addEngine}
            className={`${btnClass} shrink-0 text-primary hover:bg-primary/10`}
          >
            <Plus className="h-3.5 w-3.5" />
            添加引擎
          </button>
        </div>

        <div className="space-y-2.5">
            {/* 缩略卡网格 */}
            {!editingEngine && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {engines.map((engine) => {
                  const tState = testState[engine.id]
                  const roles: string[] = []
                  if ((value.taskAssignment?.chat || engines[0]?.id) === engine.id) roles.push('对话')
                  if ((value.taskAssignment?.outline || engines[0]?.id) === engine.id) roles.push('大纲')
                  return (
                    <div key={engine.id} className={cardClass}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                            {engine.name || '未命名引擎'}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
                            {providerLabel(engine)} · {engine.model || '未选模型'}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-gray-400">
                            {hostHint(engine.baseUrl)} · {maskKey(engine.apiKey)}
                          </div>
                          {roles.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {roles.map((r) => (
                                <span
                                  key={r}
                                  className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                          {tState && tState.status !== 'idle' && (
                            <div className="mt-1">{statusDot(tState)}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingEngineId(engine.id)}
                            className={`${btnClass} border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                            title="编辑引擎"
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                          {engines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeEngine(engine.id)}
                              className="flex h-7 w-full items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                              title="删除引擎"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 详情编辑：只展开当前一张，避免整页被表单撑满 */}
            {editingEngine && (
              <div className={`${cardClass} space-y-2.5 border-primary/30`}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingEngineId(null)}
                    className={`${btnClass} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    返回列表
                  </button>
                  <span className="truncate text-xs text-gray-400">编辑引擎</span>
                  {engines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEngine(editingEngine.id)}
                      className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="删除引擎"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={editingEngine.name}
                  onChange={(e) => updateEngine(editingEngine.id, { name: e.target.value })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-800 outline-none focus:border-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="引擎名称"
                />

                <select
                  value={editingEngine.provider || detectProvider(editingEngine.baseUrl)}
                  onChange={(e) => {
                    const preset = PROVIDER_PRESETS.find((p) => p.provider === e.target.value)
                    if (preset && preset.baseUrl) {
                      updateEngine(editingEngine.id, {
                        provider: preset.provider as AiProvider,
                        baseUrl: preset.baseUrl,
                        model: preset.defaultModel || editingEngine.model,
                        fallbackModel: preset.defaultFallback || editingEngine.fallbackModel
                      })
                    } else {
                      updateEngine(editingEngine.id, { provider: e.target.value as AiProvider })
                    }
                  }}
                  className={inputClass}
                >
                  {PROVIDER_PRESETS.map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.label}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={editingEngine.baseUrl}
                  onChange={(e) => updateEngine(editingEngine.id, { baseUrl: e.target.value })}
                  onBlur={(e) => {
                    let next = e.target.value
                      .replace(/^\uFEFF/, '')
                      .replace(/[\u200B-\u200D\uFEFF]/g, '')
                      .trim()
                    if (
                      (next.startsWith('"') && next.endsWith('"')) ||
                      (next.startsWith("'") && next.endsWith("'"))
                    ) {
                      next = next.slice(1, -1).trim()
                    }
                    next = next.replace(/\s+/g, '')
                    if (next !== editingEngine.baseUrl) {
                      updateEngine(editingEngine.id, { baseUrl: next })
                    }
                  }}
                  className={inputClass}
                  placeholder="API 地址，如 https://api.deepseek.com/v1（不要带引号）"
                  spellCheck={false}
                  autoComplete="off"
                />
                {editingEngine.baseUrl?.trim() ? (
                  <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                    实际请求：
                    {editingEngine.baseUrl.replace(/^["']|["']$/g, '').replace(/\/+$/, '')}
                    /chat/completions
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    请填写服务地址（不要加引号），否则对话会失败
                  </p>
                )}

                <div className="relative">
                  <input
                    type={showKeys.has(editingEngine.id) ? 'text' : 'password'}
                    value={editingEngine.apiKey}
                    onChange={(e) => updateEngine(editingEngine.id, { apiKey: e.target.value })}
                    className={`${inputClass} pr-8`}
                    placeholder="API Key"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKey(editingEngine.id)}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
                  >
                    {showKeys.has(editingEngine.id) ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {(() => {
                  const models = engineModels(editingEngine, modelsMap[editingEngine.id] || [])
                  const mState = modelsState[editingEngine.id]
                  const tState = testState[editingEngine.id]
                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void fetchModels(editingEngine)}
                          disabled={mState?.status === 'loading'}
                          className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${mState?.status === 'loading' ? 'animate-spin' : ''}`}
                          />
                          获取模型
                        </button>

                        <label className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                            模型
                          </span>
                          <input
                            type="text"
                            list={`models-${editingEngine.id}`}
                            value={editingEngine.model}
                            onChange={(e) =>
                              updateEngine(editingEngine.id, { model: e.target.value })
                            }
                            placeholder={
                              PROVIDER_PRESETS.find((p) => p.provider === (editingEngine.provider || detectProvider(editingEngine.baseUrl)))?.defaultModel ||
                              '输入模型名'
                            }
                            className={`${inputClass} min-w-0 flex-1`}
                            spellCheck={false}
                          />
                          <datalist id={`models-${editingEngine.id}`}>
                            {models.map((modelId) => (
                              <option key={modelId} value={modelId} />
                            ))}
                          </datalist>
                        </label>

                        <button
                          type="button"
                          onClick={() => void testConnection(editingEngine)}
                          disabled={tState?.status === 'loading'}
                          className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                        >
                          <Zap className="h-3 w-3" />
                          测试连接
                        </button>
                      </div>

                      {(mState?.status === 'fail' ||
                        tState?.status === 'fail' ||
                        mState?.status === 'ok' ||
                        tState?.status === 'ok') && (
                        <div className="flex items-center gap-3 text-xs">
                          {mState && mState.status !== 'idle' && (
                            <span className="text-gray-500">模型：{statusDot(mState)}</span>
                          )}
                          {tState && tState.status !== 'idle' && (
                            <span className="text-gray-500">连接：{statusDot(tState)}</span>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}

                <input
                  type="text"
                  value={editingEngine.fallbackModel}
                  onChange={(e) =>
                    updateEngine(editingEngine.id, { fallbackModel: e.target.value })
                  }
                  className={inputClass}
                  placeholder="备用模型（可选）"
                />

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">温度</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={editingEngine.temperature}
                      onChange={(e) =>
                        updateEngine(editingEngine.id, { temperature: Number(e.target.value) })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">超时（秒）</span>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      value={Math.round(editingEngine.timeoutMs / 1000)}
                      onChange={(e) =>
                        updateEngine(editingEngine.id, {
                          timeoutMs: Math.max(5000, Number(e.target.value) * 1000)
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => setEditingEngineId(null)}
                  className={`${btnClass} w-full justify-center bg-primary text-white hover:bg-primary/90`}
                >
                  完成编辑
                </button>
              </div>
            )}

            {/* 任务分配：始终紧凑一行 */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">AI 对话使用</span>
                <select
                  value={value.taskAssignment?.chat || engines[0]?.id}
                  onChange={(e) => updateTaskAssignment('chat', e.target.value)}
                  className={inputClass}
                >
                  {engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">大纲生成使用</span>
                <select
                  value={value.taskAssignment?.outline || engines[0]?.id}
                  onChange={(e) => updateTaskAssignment('outline', e.target.value)}
                  className={inputClass}
                >
                  {engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
      </section>

      {/* ===== 知识库 ===== */}
      <section className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">知识库</h3>
          <span className="truncate text-[11px] text-gray-400">
            {hostHint(value.nmem.baseUrl)}
            {value.nmem.autoIngest ? ' · 自动同步' : ''}
            {value.retrieval.enabled ? ' · 书内检索开' : ' · 检索关'}
          </span>
        </div>

        <div className="mt-2.5 space-y-2.5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">知识库地址</span>
              <input
                type="url"
                value={value.nmem.baseUrl}
                onChange={(e) => updateNmem({ baseUrl: e.target.value })}
                className={inputClass}
                placeholder="http://127.0.0.1:14242"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void testNmem()}
                disabled={nmemTest.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <Zap className="h-3 w-3" />
                测试知识库
              </button>
              {statusDot(nmemTest)}

              <button
                type="button"
                onClick={() => void syncAll()}
                disabled={syncState.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <RefreshCw
                  className={`h-3 w-3 ${syncState.status === 'loading' ? 'animate-spin' : ''}`}
                />
                立即同步
              </button>
              {statusDot(syncState)}

              <button
                type="button"
                onClick={() => void dedupe()}
                disabled={dedupeState.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <Trash2
                  className={`h-3 w-3 ${dedupeState.status === 'loading' ? 'animate-spin' : ''}`}
                />
                去重知识库
              </button>
              {statusDot(dedupeState)}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={value.nmem.autoIngest}
                  onChange={(e) => updateNmem({ autoIngest: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                自动同步新书
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={value.retrieval.enabled}
                  onChange={(e) => updateRetrieval({ enabled: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                启用书内检索
              </label>
            </div>
          </div>
      </section>

      {/* ===== 高级设置 ===== */}
      <section className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-100"
        >
          高级设置
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${
              showAdvanced ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4">
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">提示词</h4>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">系统提示词</span>
                <textarea
                  rows={3}
                  value={value.chat.systemPrompt}
                  onChange={(e) => updateChat({ systemPrompt: e.target.value })}
                  className={`${inputClass} resize-y leading-6`}
                />
              </label>
              {(
                [
                  ['evidencePrompt', '书内证据提示词'],
                  ['readerContextPrompt', '阅读上下文提示词'],
                  ['selectionPrompt', '选区引用提示词'],
                  ['fullTextInjectPrompt', '本章注入提示词（按当前章，可多轮）']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">{label}</span>
                  <textarea
                    rows={2}
                    value={value.chat[key]}
                    onChange={(e) => updateChat({ [key]: e.target.value })}
                    className={`${inputClass} resize-y leading-6`}
                  />
                </label>
              ))}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">
                  联网搜索后端（与模型厂商解耦）
                </span>
                <select
                  value={value.webSearch?.backend || 'auto'}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      webSearch: {
                        ...value.webSearch,
                        enabled: value.webSearch?.enabled ?? false,
                        prompt: value.webSearch?.prompt || '',
                        backend: e.target.value as 'auto' | 'zhipu-native' | 'none'
                      }
                    })
                  }
                  className={inputClass}
                >
                  <option value="auto">自动（智谱用原生搜索，其它仅提示）</option>
                  <option value="zhipu-native">智谱原生搜索 tool</option>
                  <option value="none">仅提示词（不下发 tool）</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">
                  联网搜索提示词
                </span>
                <textarea
                  rows={2}
                  value={value.webSearch?.prompt || ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      webSearch: {
                        ...value.webSearch,
                        enabled: value.webSearch?.enabled ?? false,
                        backend: value.webSearch?.backend ?? 'auto',
                        prompt: e.target.value
                      }
                    })
                  }
                  className={`${inputClass} resize-y leading-6`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">
                  大纲生成提示词（须要求中文与逻辑顺序）
                </span>
                <textarea
                  rows={4}
                  value={value.chat.outlineSystemPrompt}
                  onChange={(e) => updateChat({ outlineSystemPrompt: e.target.value })}
                  className={`${inputClass} resize-y font-mono text-[11px] leading-5`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">
                  本章注入字数上限（默认 5 万）
                </span>
                <input
                  type="number"
                  min={1000}
                  max={200000}
                  step={1000}
                  value={value.chat.fullTextMaxChars ?? 50000}
                  onChange={(e) =>
                    updateChat({
                      fullTextMaxChars: Math.max(
                        1000,
                        Math.min(200000, Number(e.target.value) || 50000)
                      )
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">路由规则</h4>
              {(
                [
                  ['greetingPatterns', '问候语路由正则'],
                  ['chapterPatterns', '当前章路由正则'],
                  ['bookWidePatterns', '全书路由正则']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">{label}</span>
                  <textarea
                    rows={2}
                    value={value.chat[key].join('\n')}
                    onChange={(e) =>
                      updateChat({
                        [key]: e.target.value
                          .split(/\r?\n/)
                          .map((p) => p.trim())
                          .filter(Boolean)
                      })
                    }
                    className={`${inputClass} resize-y font-mono leading-6`}
                  />
                </label>
              ))}
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">检索与对话</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">检索条数</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={value.retrieval.topK}
                    onChange={(e) =>
                      updateRetrieval({
                        topK: Math.min(20, Math.max(1, Number(e.target.value)))
                      })
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">
                    上下文字符上限
                  </span>
                  <input
                    type="number"
                    min="1000"
                    max="50000"
                    step="1000"
                    value={value.retrieval.maxContextChars}
                    onChange={(e) =>
                      updateRetrieval({
                        maxContextChars: Math.min(50000, Math.max(1000, Number(e.target.value)))
                      })
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">
                    保留对话条数
                  </span>
                  <input
                    type="number"
                    min="2"
                    max="100"
                    step="2"
                    value={value.chat.maxHistoryMessages}
                    onChange={(e) =>
                      updateChat({ maxHistoryMessages: Math.max(2, Number(e.target.value)) })
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">知识库超时</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['healthTimeoutMs', '连接超时'],
                    ['searchTimeoutMs', '检索超时'],
                    ['ingestTimeoutMs', '导入超时'],
                    ['statusCacheMs', '状态缓存']
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">
                      {label}（秒）
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="600"
                      value={Math.round(value.nmem[key] / 1000)}
                      onChange={(e) =>
                        updateNmem({ [key]: Math.max(1000, Number(e.target.value) * 1000) })
                      }
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
