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
import type { AiEngine, AiMcpServerConfig, AiProvider, AiSettings } from '../../global'
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

/** 引擎显示名：有自定义名用自定义名，否则自动拼 provider-model */
function engineDisplayName(engine: AiEngine): string {
  if (engine.name) return engine.name
  const pid = engine.provider || detectProvider(engine.baseUrl)
  const short = pid || '自定义'
  if (engine.model) return `${short}-${engine.model}`
  return '自定义引擎'
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
  const [embedTest, setEmbedTest] = useState<AsyncState>({ status: 'idle' })
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [embedModelsState, setEmbedModelsState] = useState<AsyncState>({ status: 'idle' })
  const [mcpProbe, setMcpProbe] = useState<Record<string, AsyncState>>({})
  const [mcpListState, setMcpListState] = useState<AsyncState & { tools?: string[] }>({
    status: 'idle'
  })
  /** 当前展开编辑的引擎；null = 只显示缩略卡 */
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  /**
   * 子分类（避免一长页）：
   * models=对话模型 · tools=知识/联网/学术服务 · chat=检索与提示词 · advanced=超时与模式
   */
  const [subTab, setSubTab] = useState<'models' | 'tools' | 'chat' | 'advanced'>('models')

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
        name: '',
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

  const updateEmbedding = (partial: Partial<AiSettings['embedding']>) => {
    onChange({ ...value, embedding: { ...value.embedding, ...partial } })
  }

  const updateMcp = (partial: Partial<AiSettings['mcp']>) => {
    onChange({
      ...value,
      mcp: {
        enabled: value.mcp?.enabled ?? false,
        servers: value.mcp?.servers ?? [],
        ...partial
      }
    })
  }

  const updateMcpServer = (id: string, partial: Partial<AiMcpServerConfig>) => {
    const servers = (value.mcp?.servers || []).map((s) =>
      s.id === id ? { ...s, ...partial } : s
    )
    updateMcp({ servers })
  }

  const updateAgent = (partial: Partial<AiSettings['agent']>) => {
    onChange({
      ...value,
      agent: {
        mode: value.agent?.mode || 'auto',
        maxToolRounds: value.agent?.maxToolRounds ?? 4,
        ...partial
      }
    })
  }

  const probeMcpServer = async (server: AiMcpServerConfig) => {
    setMcpProbe((prev) => ({ ...prev, [server.id]: { status: 'loading' } }))
    try {
      const result = await window.api?.aiMcpProbe?.(server)
      if (result?.ok) {
        setMcpProbe((prev) => ({
          ...prev,
          [server.id]: {
            status: 'ok',
            error: `可用 · ${result.toolCount} 个工具${result.tools?.length ? `：${result.tools.slice(0, 6).join(', ')}` : ''}`
          }
        }))
      } else {
        setMcpProbe((prev) => ({
          ...prev,
          [server.id]: { status: 'fail', error: result?.error || '探测失败' }
        }))
      }
    } catch (error) {
      setMcpProbe((prev) => ({
        ...prev,
        [server.id]: {
          status: 'fail',
          error: error instanceof Error ? error.message : String(error)
        }
      }))
    }
  }

  const listMcpTools = async () => {
    setMcpListState({ status: 'loading' })
    try {
      const result = await window.api?.aiMcpListTools?.()
      if (result?.success) {
        const count = result.tools?.length || 0
        const detail =
          result.message ||
          (count > 0
            ? `已加载 ${count} 个 MCP 工具`
            : '无可用 MCP 工具（检查总开关、各服务启用、command/URL）')
        // 0 工具但有错误信息 → 标红，避免「看起来成功其实全失败」
        if (count === 0 && (result.message || result.error)) {
          setMcpListState({ status: 'fail', error: detail })
        } else {
          setMcpListState({
            status: 'ok',
            tools: (result.tools || []).map((t) => t.exposedName),
            error: detail
          })
        }
      } else {
        setMcpListState({ status: 'fail', error: result?.error || '列出失败' })
      }
    } catch (error) {
      setMcpListState({
        status: 'fail',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const updateWebSearch = (partial: Partial<AiSettings['webSearch']>) => {
    onChange({
      ...value,
      webSearch: {
        ...value.webSearch,
        enabled: value.webSearch?.enabled ?? false,
        prompt: value.webSearch?.prompt || '',
        ...partial
      }
    })
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
        const groups = result.groups ?? 0
        const scanned = result.scanned ?? 0
        let msg: string
        if (removed > 0) {
          msg = `已删除 ${removed} 个重复源（扫描 ${scanned}，${groups} 本）`
        } else if (groups > 0) {
          msg = `已检查 ${groups} 本，无重复源（共 ${scanned} 条）`
        } else if (scanned > 0) {
          msg = `扫到 ${scanned} 条源，但没有带 bookId 的听伴书`
        } else {
          msg = '知识库为空或未能列出源'
        }
        setDedupeState({ status: 'ok', error: msg })
      } else {
        setDedupeState({ status: 'fail', error: result.error || '去重失败' })
      }
    } catch (error) {
      setDedupeState({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const testEmbedding = async () => {
    setEmbedTest({ status: 'loading' })
    try {
      const config = {
        baseUrl: value.embedding.baseUrl,
        apiKey: value.embedding.apiKey,
        model: value.embedding.model,
        fallbackModel: '',
        temperature: 0,
        timeoutMs: 30000
      }
      const result = await window.api.aiTestModel(config)
      if (result.success) {
        if (result.models) setEmbedModels(result.models)
        setEmbedTest({ status: 'ok' })
      } else {
        setEmbedTest({ status: 'fail', error: result.error || '连接失败' })
      }
    } catch (error) {
      setEmbedTest({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const fetchEmbedModels = async () => {
    setEmbedModelsState({ status: 'loading' })
    try {
      const config = {
        baseUrl: value.embedding.baseUrl,
        apiKey: value.embedding.apiKey,
        model: value.embedding.model,
        fallbackModel: '',
        temperature: 0,
        timeoutMs: 30000
      }
      const result = await window.api.aiListModels(config)
      if (result.success && result.models) {
        setEmbedModels(result.models)
        setEmbedModelsState({ status: 'ok' })
      } else {
        setEmbedModelsState({ status: 'fail', error: result.error || '获取失败' })
      }
    } catch (error) {
      setEmbedModelsState({ status: 'fail', error: error instanceof Error ? error.message : String(error) })
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
    engineDisplayName(engines.find((e) => e.id === (value.taskAssignment?.chat || engines[0]?.id)) || engines[0])
  const outlineEngineName =
    engineDisplayName(engines.find((e) => e.id === (value.taskAssignment?.outline || engines[0]?.id)) || engines[0])

  const subTabs: Array<{ id: typeof subTab; label: string; hint: string }> = [
    { id: 'models', label: '模型', hint: '对话/大纲引擎' },
    { id: 'tools', label: '工具服务', hint: '知识库·联网·学术' },
    { id: 'chat', label: '对话', hint: '引用条数·提示词' },
    { id: 'advanced', label: '高级', hint: '超时·匹配规则' }
  ]

  const toolOn = (on: boolean) =>
    on
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'

  return (
    <div className="space-y-3">
      {/* 子导航：像 Cherry 一样分区，避免一屏塞满 */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900/40">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-center transition-colors ${
              subTab === t.id
                ? 'bg-white text-primary shadow-sm dark:bg-gray-800'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            title={t.hint}
          >
            <span className="block text-xs font-medium">{t.label}</span>
            <span className="mt-0.5 hidden text-[10px] text-gray-400 sm:block">{t.hint}</span>
          </button>
        ))}
      </div>

      {/* ===== 模型 ===== */}
      {subTab === 'models' && (
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
                            {engineDisplayName(engine)}
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
                          {/* 模型名支持任意手输，datalist 仅提供已获取的建议 */}
                          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                            {PROVIDER_PRESETS.find((p) => p.provider === (editingEngine.provider || detectProvider(editingEngine.baseUrl)))?.label || '自定义'} 模型
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
                        <p className="w-full text-[10px] text-gray-400 dark:text-gray-500 -mt-1">
                          可直接输入任意模型名，不限于下拉列表
                        </p>

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
                  className={`${btnClass} w-full justify-center bg-primary text-[rgb(var(--on-primary-rgb))] hover:bg-primary/90`}
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
                      {engineDisplayName(e)}
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
                      {engineDisplayName(e)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
      </section>
      )}

      {/* ===== 工具服务（统一管理：内置知识 + 联网 + 学术，类 MCP 卡片） ===== */}
      {subTab === 'tools' && (
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">工具与服务</h3>
          <p className="mt-0.5 text-[11px] leading-5 text-gray-400">
            内置工具（书内检索 / 联网 / 学术）会注册给模型，由模型真实 tool call 调用。
            下方 MCP 宿主可 stdio/HTTP 拉起外部进程（如 Zotero）。Agent 模式默认 auto。
          </p>
        </div>

        {/* 总览条：网格保证 nmem / MCP 等不被挤没 */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.retrieval.enabled)}`}>
            书内检索 {value.retrieval.enabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.nmem.enabled)}`}>
            nmem {value.nmem.enabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(Boolean(value.embedding.baseUrl))}`}>
            本地向量 {value.embedding.baseUrl ? '已配' : '未配'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.webSearch?.enabled ?? false)}`}>
            联网 {value.webSearch?.enabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.webSearch?.academicEnabled ?? false)}`}>
            学术 S2 {value.webSearch?.academicEnabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.webSearch?.sciverseEnabled ?? false)}`}>
            SciVerse {value.webSearch?.sciverseEnabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn(value.mcp?.enabled ?? false)}`}>
            MCP {value.mcp?.enabled ? '开' : '关'}
          </span>
          <span className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${toolOn((value.agent?.mode || 'auto') !== 'prefetch')}`}>
            Agent {value.agent?.mode || 'auto'}
          </span>
        </div>

        {/* 联网条数：提到工具页顶部，避免滚到很下面才看见 */}
        <div className={`${cardClass} flex flex-wrap items-end gap-3`}>
          <label className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-300">
              每次联网搜索条数
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={value.webSearch?.maxResults ?? 5}
              onChange={(e) =>
                updateWebSearch({
                  maxResults: Math.min(10, Math.max(1, Number(e.target.value) || 5))
                })
              }
              className={inputClass}
            />
          </label>
          <p className="max-w-xs pb-1 text-[10px] leading-4 text-gray-400">
            默认 5 条够用。范围 1～10。对话顶栏「联网」旁也会显示当前条数。
          </p>
        </div>

        {/* Agent 模式 */}
        <div className={`${cardClass} space-y-2`}>
          <div className="text-xs font-medium text-gray-800 dark:text-gray-100">工具调用模式</div>
          <p className="text-[10px] text-gray-400">
            auto：有可用工具时让模型自己选工具；tools：强制 agent；prefetch：旧行为（宿主先查再答）。
          </p>
          <div className="flex flex-wrap gap-2">
            {([
              ['auto', '自动 (推荐)'],
              ['tools', '强制工具'],
              ['prefetch', '预检索']
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateAgent({ mode })}
                className={`${btnClass} border ${
                  (value.agent?.mode || 'auto') === mode
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            最大工具轮数
            <input
              type="number"
              min={1}
              max={8}
              value={value.agent?.maxToolRounds ?? 4}
              onChange={(e) =>
                updateAgent({ maxToolRounds: Math.min(8, Math.max(1, Number(e.target.value) || 4)) })
              }
              className="w-16 rounded border border-gray-200 px-2 py-1 dark:border-gray-600 dark:bg-gray-700"
            />
          </label>
        </div>

        {/* MCP 宿主 */}
        <div className={`${cardClass} space-y-2.5`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-gray-800 dark:text-gray-100">
                MCP 协议宿主（stdio / HTTP）
              </div>
              <p className="text-[10px] text-gray-400">
                真拉起外部 MCP 进程。工具名形如 mcp_zotero_search_items，对话中可被模型调用。
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={value.mcp?.enabled ?? false}
                onChange={(e) => updateMcp({ enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-primary"
              />
              总开关
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void listMcpTools()}
              disabled={mcpListState.status === 'loading'}
              className={`${btnClass} border border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
            >
              <RefreshCw className={`h-3 w-3 ${mcpListState.status === 'loading' ? 'animate-spin' : ''}`} />
              列出已启用工具
            </button>
            {mcpListState.status === 'ok' && (
              <span className="text-[10px] text-emerald-600">{mcpListState.error}</span>
            )}
            {mcpListState.status === 'fail' && (
              <span className="text-[10px] text-red-500">{mcpListState.error}</span>
            )}
          </div>
          {(value.mcp?.servers || []).map((server) => (
            <div
              key={server.id}
              className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-900/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-800 dark:text-gray-100">
                    {server.name || server.id}
                  </div>
                  {server.description ? (
                    <p className="text-[10px] text-gray-400">{server.description}</p>
                  ) : null}
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(e) => updateMcpServer(server.id, { enabled: e.target.checked })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  启用
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[10px] text-gray-500">
                  传输
                  <select
                    value={server.transport}
                    onChange={(e) =>
                      updateMcpServer(server.id, {
                        transport: e.target.value === 'http' ? 'http' : 'stdio'
                      })
                    }
                    className={`${inputClass} mt-0.5`}
                  >
                    <option value="stdio">stdio（本地进程）</option>
                    <option value="http">HTTP JSON-RPC</option>
                  </select>
                </label>
                {server.transport === 'stdio' ? (
                  <>
                    <label className="text-[10px] text-gray-500">
                      command
                      <input
                        type="text"
                        value={server.command || ''}
                        onChange={(e) => updateMcpServer(server.id, { command: e.target.value })}
                        placeholder="uvx / npx / python"
                        className={`${inputClass} mt-0.5`}
                        spellCheck={false}
                      />
                    </label>
                    <label className="text-[10px] text-gray-500 sm:col-span-2">
                      args（空格分隔）
                      <input
                        type="text"
                        value={(server.args || []).join(' ')}
                        onChange={(e) =>
                          updateMcpServer(server.id, {
                            args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : []
                          })
                        }
                        placeholder="zotero-mcp"
                        className={`${inputClass} mt-0.5`}
                        spellCheck={false}
                      />
                    </label>
                  </>
                ) : (
                  <label className="text-[10px] text-gray-500 sm:col-span-2">
                    URL
                    <input
                      type="text"
                      value={server.url || ''}
                      onChange={(e) => updateMcpServer(server.id, { url: e.target.value })}
                      placeholder="http://127.0.0.1:3000/mcp"
                      className={`${inputClass} mt-0.5`}
                      spellCheck={false}
                    />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void probeMcpServer(server)}
                  disabled={mcpProbe[server.id]?.status === 'loading'}
                  className={`${btnClass} border border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                >
                  <Zap className="h-3 w-3" />
                  测试连通
                </button>
                {mcpProbe[server.id]?.status === 'ok' && (
                  <span className="text-[10px] text-emerald-600">{mcpProbe[server.id]?.error}</span>
                )}
                {mcpProbe[server.id]?.status === 'fail' && (
                  <span className="text-[10px] text-red-500">{mcpProbe[server.id]?.error}</span>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const id = `mcp-${Date.now().toString(36)}`
              updateMcp({
                servers: [
                  ...(value.mcp?.servers || []),
                  {
                    id,
                    name: '自定义 MCP',
                    enabled: false,
                    transport: 'stdio',
                    command: '',
                    args: [],
                    env: {},
                    timeoutMs: 30000,
                    description: ''
                  }
                ]
              })
            }}
            className={`${btnClass} border border-dashed border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300`}
          >
            <Plus className="h-3 w-3" />
            添加 MCP 服务
          </button>
        </div>

        <div className="space-y-2">
          {/* 卡片：书内检索总闸 */}
          <div className={cardClass}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-800 dark:text-gray-100">书内检索总开关</div>
                <div className="text-[10px] text-gray-400">关闭后对话不再查知识库（仍可用本章正文）</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={value.retrieval.enabled}
                  onChange={(e) => updateRetrieval({ enabled: e.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {value.retrieval.enabled ? '已启用' : '已关闭'}
              </label>
            </div>
          </div>

        <div className="mt-0 space-y-2">
          {/* 检索总开关已上移；下方保留嵌入与 nmem 详情 */}

          {/* 嵌入模型（本地向量） */}
          <div className={`${cardClass} space-y-2.5`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">嵌入模型（本地向量检索）</span>
              <span className="text-[10px] text-gray-400">
                {value.embedding.baseUrl ? hostHint(value.embedding.baseUrl) : '未配置'}
                {value.embedding.model ? ` · ${value.embedding.model}` : ''}
              </span>
            </div>

            <input
              type="text"
              value={value.embedding.baseUrl}
              onChange={(e) => updateEmbedding({ baseUrl: e.target.value })}
              className={inputClass}
              placeholder="API 地址，如 https://api.openai.com/v1"
              spellCheck={false}
            />

            <div className="relative">
              <input
                type={showKeys.has('embedding') ? 'text' : 'password'}
                value={value.embedding.apiKey}
                onChange={(e) => updateEmbedding({ apiKey: e.target.value })}
                className={`${inputClass} pr-8`}
                placeholder="API Key"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => toggleKey('embedding')}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
              >
                {showKeys.has('embedding') ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchEmbedModels()}
                disabled={embedModelsState.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <RefreshCw className={`h-3 w-3 ${embedModelsState.status === 'loading' ? 'animate-spin' : ''}`} />
                获取模型
              </button>

              <label className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">模型</span>
                <input
                  type="text"
                  list="embedding-models"
                  value={value.embedding.model}
                  onChange={(e) => updateEmbedding({ model: e.target.value })}
                  placeholder="text-embedding-3-small"
                  className={`${inputClass} min-w-0 flex-1`}
                  spellCheck={false}
                />
                <datalist id="embedding-models">
                  {(embedModels.length ? embedModels : ['text-embedding-3-small', 'text-embedding-3-large', 'embedding-3', 'embedding-2']).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>

              <button
                type="button"
                onClick={() => void testEmbedding()}
                disabled={embedTest.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <Zap className="h-3 w-3" />
                测试连接
              </button>
            </div>

            {(embedTest.status !== 'idle' || embedModelsState.status !== 'idle') && (
              <div className="flex items-center gap-3 text-xs">
                {embedModelsState.status !== 'idle' && <span className="text-gray-500">模型：{statusDot(embedModelsState)}</span>}
                {embedTest.status !== 'idle' && <span className="text-gray-500">连接：{statusDot(embedTest)}</span>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-gray-500">向量维度（0=模型默认）</span>
                <input
                  type="number"
                  min={0}
                  value={value.embedding.dimension}
                  onChange={(e) => updateEmbedding({ dimension: Number(e.target.value) || 0 })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-gray-500">批量条数</span>
                <input
                  type="number"
                  min={1}
                  value={value.embedding.batchSize}
                  onChange={(e) => updateEmbedding({ batchSize: Math.max(1, Number(e.target.value) || 32) })}
                  className={inputClass}
                />
              </label>
            </div>
          </div>

          {/* nmem 外部知识库 */}
          <div className={`${cardClass} space-y-2.5`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">nmem 外部知识库</span>
              <span className="text-[10px] text-gray-400">{hostHint(value.nmem.baseUrl)}</span>
            </div>

            <input
              type="url"
              value={value.nmem.baseUrl}
              onChange={(e) => updateNmem({ baseUrl: e.target.value })}
              className={inputClass}
              placeholder="http://127.0.0.1:14242"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void testNmem()}
                disabled={nmemTest.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <Zap className="h-3 w-3" />
                测试连接
              </button>
              {statusDot(nmemTest)}

              <button
                type="button"
                onClick={() => void syncAll()}
                disabled={syncState.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <RefreshCw className={`h-3 w-3 ${syncState.status === 'loading' ? 'animate-spin' : ''}`} />
                立即同步
              </button>
              {statusDot(syncState)}

              <button
                type="button"
                onClick={() => void dedupe()}
                disabled={dedupeState.status === 'loading'}
                className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
              >
                <Trash2 className={`h-3 w-3 ${dedupeState.status === 'loading' ? 'animate-spin' : ''}`} />
                去重
              </button>
              {statusDot(dedupeState)}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={value.nmem.autoIngest}
                onChange={(e) => updateNmem({ autoIngest: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              自动同步新书
            </label>
          </div>

          <p className="text-[10px] text-gray-400">
            引用条数 / 提示词请到上方「对话」分类调整。
          </p>
        </div>
        </div>

      {/* 外部检索服务（联网 + 学术） */}
      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">外部检索服务</h4>
          <span className="truncate text-[10px] text-gray-400">
            {value.webSearch?.enabled ? '联网开' : '联网关'} · {value.webSearch?.backend || 'auto'}
          </span>
        </div>
        <p className="text-[10px] leading-5 text-gray-400">
          与对话模型独立。Ollama 限额可切智谱 / DDG；学术用 Semantic Scholar（免 Key）或 SciVerse（需 Token）。
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={value.webSearch?.enabled ?? false}
              onChange={(e) => updateWebSearch({ enabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            默认启用联网搜索（对话栏也可随时开关）
          </label>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">搜索后端</span>
              <select
                value={value.webSearch?.backend || 'auto'}
                onChange={(e) =>
                  updateWebSearch({
                    backend: e.target.value as NonNullable<AiSettings['webSearch']['backend']>
                  })
                }
                className={inputClass}
              >
                <option value="auto">自动切换（推荐：Ollama → 智谱 → DDG）</option>
                <option value="ollama">仅 Ollama Cloud</option>
                <option value="zhipu">仅智谱独立搜索</option>
                <option value="ddg">仅 DuckDuckGo（免费无 Key）</option>
                <option value="zhipu-native">智谱原生 tool（旧，需对话引擎是智谱）</option>
                <option value="none">关闭真实搜索</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">
                每次搜索条数（同上，1～10）
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={value.webSearch?.maxResults ?? 5}
                onChange={(e) =>
                  updateWebSearch({
                    maxResults: Math.min(10, Math.max(1, Number(e.target.value) || 5))
                  })
                }
                className={inputClass}
              />
            </label>
          </div>

          <div className={`${cardClass} space-y-2`}>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              Ollama Cloud 搜索
            </span>
            <p className="text-[10px] text-gray-400">
              POST https://ollama.com/api/web_search · 在 ollama.com/settings/keys 申请
            </p>
            <div className="relative">
              <input
                type={showKeys.has('ollama-ws') ? 'text' : 'password'}
                autoComplete="off"
                value={value.webSearch?.ollamaApiKey || ''}
                onChange={(e) => updateWebSearch({ ollamaApiKey: e.target.value })}
                placeholder="Ollama API Key"
                className={`${inputClass} pr-8`}
              />
              <button
                type="button"
                onClick={() => toggleKey('ollama-ws')}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
              >
                {showKeys.has('ollama-ws') ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <input
              type="text"
              value={value.webSearch?.ollamaBaseUrl || 'https://ollama.com'}
              onChange={(e) => updateWebSearch({ ollamaBaseUrl: e.target.value })}
              placeholder="https://ollama.com"
              className={inputClass}
              spellCheck={false}
            />
          </div>

          <div className={`${cardClass} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  Semantic Scholar 学术检索（免费）
                </span>
                <p className="text-[10px] text-gray-400">
                  官方 Graph API，覆盖论文/引用。对话中注册为 semantic_scholar 工具，由模型按需调用。
                  无需 Key 即可用；可选 Key 提高配额。
                </p>
              </div>
              <label className="flex flex-shrink-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={value.webSearch?.academicEnabled ?? true}
                  onChange={(e) => updateWebSearch({ academicEnabled: e.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                启用
              </label>
            </div>
            <div className="relative">
              <input
                type={showKeys.has('s2-key') ? 'text' : 'password'}
                autoComplete="off"
                value={value.webSearch?.semanticScholarApiKey || ''}
                onChange={(e) => updateWebSearch({ semanticScholarApiKey: e.target.value })}
                placeholder="可选 API Key（semanticscholar.org/product/api）"
                className={`${inputClass} pr-8`}
              />
              <button
                type="button"
                onClick={() => toggleKey('s2-key')}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
              >
                {showKeys.has('s2-key') ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className={`${cardClass} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  SciVerse 学术元搜索
                </span>
                <p className="text-[10px] text-gray-400">
                  sciverse.space（上海 AI Lab OpenDataLab）。结构化论文元数据：标题/DOI/年份/期刊。
                  需 Bearer Token，有免费起步配额。文档：sciverse.space/docs
                </p>
              </div>
              <label className="flex flex-shrink-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={value.webSearch?.sciverseEnabled ?? false}
                  onChange={(e) => updateWebSearch({ sciverseEnabled: e.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                启用
              </label>
            </div>
            <div className="relative">
              <input
                type={showKeys.has('sciverse-key') ? 'text' : 'password'}
                autoComplete="off"
                value={value.webSearch?.sciverseApiKey || ''}
                onChange={(e) => updateWebSearch({ sciverseApiKey: e.target.value })}
                placeholder="Token（sci_…，控制台申请）"
                className={`${inputClass} pr-8`}
              />
              <button
                type="button"
                onClick={() => toggleKey('sciverse-key')}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
              >
                {showKeys.has('sciverse-key') ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {value.webSearch?.sciverseEnabled && !value.webSearch?.sciverseApiKey?.trim() && (
              <p className="text-[10px] text-amber-600">已启用但未填 Token，检索不会调用 SciVerse</p>
            )}
          </div>

          <div className={`${cardClass} space-y-2`}>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              智谱独立搜索（不绑对话模型）
            </span>
            <p className="text-[10px] text-gray-400">
              单独调 glm-4-flash + search-pro。填这里的 Key 即可；不填则尝试用「引擎列表」里智谱引擎的
              Key。对话仍可用 DeepSeek / OpenAI 等。
            </p>
            <div className="relative">
              <input
                type={showKeys.has('zhipu-ws') ? 'text' : 'password'}
                autoComplete="off"
                value={value.webSearch?.zhipuApiKey || ''}
                onChange={(e) => updateWebSearch({ zhipuApiKey: e.target.value })}
                placeholder="智谱 API Key（可选，专用搜索）"
                className={`${inputClass} pr-8`}
              />
              <button
                type="button"
                onClick={() => toggleKey('zhipu-ws')}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
              >
                {showKeys.has('zhipu-ws') ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <input
              type="text"
              value={
                value.webSearch?.zhipuBaseUrl || 'https://open.bigmodel.cn/api/paas/v4'
              }
              onChange={(e) => updateWebSearch({ zhipuBaseUrl: e.target.value })}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
              className={inputClass}
              spellCheck={false}
            />
          </div>

          <div className={`${cardClass} space-y-2`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  偏好外部源（标签/书签）
                </span>
                <p className="text-[10px] text-gray-400">
                  仅作展示偏好与备注，不改变搜索引擎本身。本地默认已通过。
                </p>
              </div>
              <button
                type="button"
                className={`${btnClass} bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200`}
                onClick={() => {
                  const id = `src-${Date.now().toString(36)}`
                  updateWebSearch({
                    customSources: [
                      ...(value.webSearch?.customSources || []),
                      {
                        id,
                        name: '',
                        url: '',
                        sourceType: '网页',
                        status: 'approved',
                        createdAt: new Date().toISOString()
                      }
                    ]
                  })
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
            {(value.webSearch?.customSources || []).map((src, idx) => (
              <div
                key={src.id}
                className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border border-gray-100 p-2 dark:border-gray-700"
              >
                <input
                  type="text"
                  placeholder="名称（如 新华社）"
                  value={src.name}
                  onChange={(e) => {
                    const list = [...(value.webSearch?.customSources || [])]
                    list[idx] = { ...list[idx], name: e.target.value }
                    updateWebSearch({ customSources: list })
                  }}
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder="域名或 URL"
                  value={src.url}
                  onChange={(e) => {
                    const list = [...(value.webSearch?.customSources || [])]
                    list[idx] = { ...list[idx], url: e.target.value }
                    updateWebSearch({ customSources: list })
                  }}
                  className={inputClass}
                />
                <button
                  type="button"
                  title="删除"
                  className="icon-btn h-9 w-9 text-red-500"
                  onClick={() => {
                    updateWebSearch({
                      customSources: (value.webSearch?.customSources || []).filter(
                        (_, i) => i !== idx
                      )
                    })
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-500">联网提示词</span>
            <textarea
              rows={2}
              value={value.webSearch?.prompt || ''}
              onChange={(e) => updateWebSearch({ prompt: e.target.value })}
              className={`${inputClass} resize-y leading-6`}
            />
          </label>
        </div>
      </div>
      </section>
      )}

      {/* ===== 对话参数 ===== */}
      {subTab === 'chat' && (
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">对话与引用</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            控制每轮带多少书内记忆、历史消息，以及系统提示词。
          </p>
        </div>

        <div className={`${cardClass} space-y-2.5`}>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">检索与引用参数</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[11px] text-gray-500">本轮引用条数 topK</span>
              <input
                type="number"
                min={1}
                max={20}
                value={value.retrieval.topK}
                onChange={(e) =>
                  updateRetrieval({
                    topK: Math.min(20, Math.max(1, Number(e.target.value) || 1))
                  })
                }
                className={inputClass}
              />
              <span className="mt-0.5 block text-[10px] text-gray-400">默认 6</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-gray-500">证据字符上限</span>
              <input
                type="number"
                min={1000}
                max={50000}
                step={1000}
                value={value.retrieval.maxContextChars}
                onChange={(e) =>
                  updateRetrieval({
                    maxContextChars: Math.min(
                      50000,
                      Math.max(1000, Number(e.target.value) || 1000)
                    )
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-gray-500">本章注入上限</span>
              <input
                type="number"
                min={1000}
                max={200000}
                step={1000}
                value={value.chat.fullTextMaxChars ?? 15000}
                onChange={(e) =>
                  updateChat({
                    fullTextMaxChars: Math.max(
                      1000,
                      Math.min(200000, Number(e.target.value) || 15000)
                    )
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-gray-500">保留历史条数</span>
              <input
                type="number"
                min={2}
                max={100}
                step={2}
                value={value.chat.maxHistoryMessages}
                onChange={(e) =>
                  updateChat({ maxHistoryMessages: Math.max(2, Number(e.target.value) || 2) })
                }
                className={inputClass}
              />
            </label>
          </div>
        </div>

        <div className={`${cardClass} space-y-3`}>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">提示词</span>
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
              ['fullTextInjectPrompt', '本章注入提示词']
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
            <span className="mb-1 block text-[11px] font-medium text-gray-500">大纲生成提示词</span>
            <textarea
              rows={3}
              value={value.chat.outlineSystemPrompt}
              onChange={(e) => updateChat({ outlineSystemPrompt: e.target.value })}
              className={`${inputClass} resize-y font-mono text-[11px] leading-5`}
            />
          </label>
        </div>
      </section>
      )}

      {/* ===== 高级 ===== */}
      {subTab === 'advanced' && (
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">高级</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">问题分类正则、超时与重复参数（一般不用改）。</p>
        </div>
        <div className="space-y-4">
            <div className={`${cardClass} space-y-3`}>
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">问题分类正则</h4>
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
      </section>
      )}
    </div>
  )
}
