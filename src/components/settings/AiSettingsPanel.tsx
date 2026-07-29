import { useEffect, useState } from 'react'
import { Ban, ChevronDown, Eye, EyeOff, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import type { AiEngine, AiProvider, AiSettings, OutlineBatchProgress } from '../../global'
import { PROVIDER_PRESETS, detectProvider } from '../../aiProvider'

interface AiSettingsPanelProps {
  value: AiSettings
  onChange: (value: AiSettings) => void
}

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

const btnClass =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors'

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

export default function AiSettingsPanel({ value, onChange }: AiSettingsPanelProps) {
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set())
  const [modelsMap, setModelsMap] = useState<Record<string, string[]>>({})
  const [modelsState, setModelsState] = useState<Record<string, AsyncState>>({})
  const [testState, setTestState] = useState<Record<string, AsyncState>>({})
  const [nmemTest, setNmemTest] = useState<AsyncState>({ status: 'idle' })
  const [syncState, setSyncState] = useState<AsyncState>({ status: 'idle' })
  const [dedupeState, setDedupeState] = useState<AsyncState>({ status: 'idle' })
  const [showAdvanced, setShowAdvanced] = useState(false)

  // ===== 批量大纲 =====
  const [outlineBatch, setOutlineBatch] = useState<{
    running: boolean
    progress: OutlineBatchProgress | null
    result: { succeeded: number; failed: number; skipped: number } | null
    error?: string
  }>({ running: false, progress: null, result: null })
  const [outlineForce, setOutlineForce] = useState(false)

  useEffect(() => {
    if (!window.api?.onOutlineBatchProgress) return
    const unsubscribe = window.api.onOutlineBatchProgress((progress) => {
      if (progress.phase === 'done') {
        setOutlineBatch({
          running: false,
          progress: null,
          result: { succeeded: progress.succeeded, failed: progress.failed, skipped: progress.skipped }
        })
      } else {
        setOutlineBatch({ running: true, progress, result: null })
      }
    })
    return unsubscribe
  }, [])

  const startOutlineBatch = async () => {
    setOutlineBatch({ running: true, progress: null, result: null, error: undefined })
    try {
      const result = await window.api.aiOutlineRegenerateAll({ force: outlineForce })
      if (!result.accepted) {
        setOutlineBatch({
          running: false,
          progress: null,
          result: null,
          error: result.reason === 'already-running' ? '已有任务在运行' : '启动失败'
        })
      }
    } catch (error) {
      setOutlineBatch({
        running: false,
        progress: null,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const cancelOutlineBatch = async () => {
    try {
      await window.api.aiOutlineCancelBatch()
    } catch {
      // 忽略：进度推送会自动结束
    }
  }

  const engines = value.engines?.length ? value.engines : [{ id: 'default', name: '默认引擎', ...value.llm }]

  const updateEngines = (next: AiEngine[]) => {
    onChange({ ...value, engines: next, llm: next[0] || value.llm })
  }

  const updateEngine = (id: string, partial: Partial<AiEngine>) => {
    updateEngines(engines.map((e) => (e.id === id ? { ...e, ...partial } : e)))
  }

  const addEngine = () => {
    updateEngines([
      ...engines,
      { id: newEngineId(), name: `引擎 ${engines.length + 1}`, baseUrl: '', apiKey: '', model: '', fallbackModel: '', temperature: 0.3, timeoutMs: 60000 }
    ])
  }

  const removeEngine = (id: string) => {
    if (engines.length <= 1) return
    const remaining = engines.filter((e) => e.id !== id)
    const taskAssignment = { ...value.taskAssignment }
    if (taskAssignment.chat === id) taskAssignment.chat = remaining[0].id
    if (taskAssignment.outline === id) taskAssignment.outline = remaining[0].id
    onChange({ ...value, engines: remaining, llm: remaining[0], taskAssignment })
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
        setModelsState((prev) => ({ ...prev, [engine.id]: { status: 'fail', error: result.error || '获取失败' } }))
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
        setTestState((prev) => ({ ...prev, [engine.id]: { status: 'fail', error: result.error || '连接失败' } }))
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
      // 默认只同步需要更新的书（整本一次），已同步的跳过，避免 MDM 重复
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
            error: skipped > 0 || failed > 0
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

  return (
    <div className="space-y-6">
      {/* ===== AI 引擎 ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">AI 引擎</h3>
          <button
            type="button"
            onClick={addEngine}
            className={`${btnClass} text-primary hover:bg-primary/10`}
          >
            <Plus className="h-3.5 w-3.5" />
            添加引擎
          </button>
        </div>

        {engines.map((engine) => {
          const models = engineModels(engine, modelsMap[engine.id] || [])
          const mState = modelsState[engine.id]
          const tState = testState[engine.id]
          return (
            <div
              key={engine.id}
              className="space-y-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800/50"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={engine.name}
                  onChange={(e) => updateEngine(engine.id, { name: e.target.value })}
                  className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-800 outline-none focus:border-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                {engines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEngine(engine.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    title="删除引擎"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* 提供商预设 */}
              <select
                value={engine.provider || detectProvider(engine.baseUrl)}
                onChange={(e) => {
                  const preset = PROVIDER_PRESETS.find((p) => p.provider === e.target.value)
                  if (preset && preset.baseUrl) {
                    updateEngine(engine.id, {
                      provider: preset.provider as AiProvider,
                      baseUrl: preset.baseUrl,
                      model: preset.defaultModel || engine.model,
                      fallbackModel: preset.defaultFallback || engine.fallbackModel
                    })
                  } else {
                    updateEngine(engine.id, { provider: e.target.value as AiProvider })
                  }
                }}
                className={inputClass}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.provider} value={p.provider}>{p.label}</option>
                ))}
              </select>

              {/* 服务地址：用 text 避免 type=url 对不完整输入的怪异校验；可省略 https:// */}
              <input
                type="text"
                value={engine.baseUrl}
                onChange={(e) => {
                  // 输入时保留原样，失焦再清洗；避免边输边 trim 导致光标跳动
                  updateEngine(engine.id, { baseUrl: e.target.value })
                }}
                onBlur={(e) => {
                  let next = e.target.value
                    .replace(/^\uFEFF/, '')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
                  // 去掉误粘贴的成对引号："https://..." → https://...
                  if (
                    (next.startsWith('"') && next.endsWith('"')) ||
                    (next.startsWith("'") && next.endsWith("'"))
                  ) {
                    next = next.slice(1, -1).trim()
                  }
                  next = next.replace(/\s+/g, '')
                  if (next !== engine.baseUrl) updateEngine(engine.id, { baseUrl: next })
                }}
                className={inputClass}
                placeholder="API 地址，如 https://api.deepseek.com/v1（不要带引号）"
                spellCheck={false}
                autoComplete="off"
              />
              {engine.baseUrl?.trim() ? (
                <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                  实际请求：{engine.baseUrl.replace(/^["']|["']$/g, '').replace(/\/+$/, '')}
                  /chat/completions
                </p>
              ) : (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  请填写服务地址（不要加引号），否则对话会失败
                </p>
              )}

              {/* API Key */}
              <div className="relative">
                <input
                  type={showKeys.has(engine.id) ? 'text' : 'password'}
                  value={engine.apiKey}
                  onChange={(e) => updateEngine(engine.id, { apiKey: e.target.value })}
                  className={`${inputClass} pr-8`}
                  placeholder="API Key"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => toggleKey(engine.id)}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-gray-400"
                >
                  {showKeys.has(engine.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* 获取模型 + 选择模型 + 测试连接 */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchModels(engine)}
                  disabled={mState?.status === 'loading'}
                  className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                >
                  <RefreshCw className={`h-3 w-3 ${mState?.status === 'loading' ? 'animate-spin' : ''}`} />
                  获取模型
                </button>

                <label className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">选择模型</span>
                  <select
                    value={engine.model}
                    onChange={(e) => updateEngine(engine.id, { model: e.target.value })}
                    className={`${inputClass} min-w-0 flex-1`}
                  >
                    {models.map((modelId) => (
                      <option key={modelId} value={modelId}>{modelId}</option>
                    ))}
                    {!engine.model && <option value="">未选择</option>}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => void testConnection(engine)}
                  disabled={tState?.status === 'loading'}
                  className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
                >
                  <Zap className="h-3 w-3" />
                  测试连接
                </button>
              </div>

              {/* 状态行 */}
              {(mState?.status === 'fail' || tState?.status === 'fail' || mState?.status === 'ok' || tState?.status === 'ok') && (
                <div className="flex items-center gap-3 text-xs">
                  {mState && mState.status !== 'idle' && (
                    <span className="text-gray-500">模型：{statusDot(mState)}</span>
                  )}
                  {tState && tState.status !== 'idle' && (
                    <span className="text-gray-500">连接：{statusDot(tState)}</span>
                  )}
                </div>
              )}

              {/* 备用模型 */}
              <input
                type="text"
                value={engine.fallbackModel}
                onChange={(e) => updateEngine(engine.id, { fallbackModel: e.target.value })}
                className={inputClass}
                placeholder="备用模型（可选）"
              />
            </div>
          )
        })}

        {/* 任务分配 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">AI 对话使用</span>
            <select
              value={value.taskAssignment?.chat || engines[0]?.id}
              onChange={(e) => updateTaskAssignment('chat', e.target.value)}
              className={inputClass}
            >
              {engines.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">大纲生成使用</span>
            <select
              value={value.taskAssignment?.outline || engines[0]?.id}
              onChange={(e) => updateTaskAssignment('outline', e.target.value)}
              className={inputClass}
            >
              {engines.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ===== 知识库 ===== */}
      <section className="space-y-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">知识库</h3>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">知识库地址</span>
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
            去重知识库
          </button>
          {statusDot(dedupeState)}
        </div>

        <div className="flex flex-col gap-2">
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
      </section>

      {/* ===== 章节大纲 ===== */}
      <section className="space-y-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">章节大纲</h3>
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          一键为书架中所有书的每一章生成大纲，后台串行执行，使用软件期间可继续运行。
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={outlineForce}
            onChange={(e) => setOutlineForce(e.target.checked)}
            disabled={outlineBatch.running}
            className="h-4 w-4 accent-primary"
          />
          强制重新生成（覆盖已有缓存）
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startOutlineBatch()}
            disabled={outlineBatch.running}
            className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
          >
            <RefreshCw className={`h-3 w-3 ${outlineBatch.running ? 'animate-spin' : ''}`} />
            {outlineBatch.running ? '生成中…' : '开始批量生成'}
          </button>
          <button
            type="button"
            onClick={() => void cancelOutlineBatch()}
            disabled={!outlineBatch.running}
            className={`${btnClass} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200`}
          >
            <Ban className="h-3 w-3" />
            停止
          </button>
        </div>

        {outlineBatch.progress && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800/50">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {outlineBatch.progress.bookTitle}
              <span className="ml-1 text-gray-400">
                （第 {outlineBatch.progress.bookIndex + 1} / {outlineBatch.progress.bookTotal} 本）
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              章节 {outlineBatch.progress.chapterIndex} / {outlineBatch.progress.chapterTotal}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${outlineBatch.progress.chapterTotal > 0
                    ? Math.round((outlineBatch.progress.chapterIndex / outlineBatch.progress.chapterTotal) * 100)
                    : 0}%`
                }}
              />
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-green-600">成功 {outlineBatch.progress.succeeded}</span>
              <span className="text-red-500">失败 {outlineBatch.progress.failed}</span>
              <span className="text-gray-400">跳过 {outlineBatch.progress.skipped}</span>
            </div>
          </div>
        )}

        {outlineBatch.result && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800/50">
            <div className="text-xs text-gray-700 dark:text-gray-200">批量任务已完成</div>
            <div className="mt-1 flex gap-3 text-xs">
              <span className="text-green-600">成功 {outlineBatch.result.succeeded}</span>
              <span className="text-red-500">失败 {outlineBatch.result.failed}</span>
              <span className="text-gray-400">跳过 {outlineBatch.result.skipped}</span>
            </div>
          </div>
        )}

        {outlineBatch.error && (
          <div className="text-xs text-red-500">{outlineBatch.error}</div>
        )}
      </section>

      {/* ===== 高级设置 ===== */}
      <section className="border-t border-gray-200 pt-5 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-100"
        >
          高级设置
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-5">
            {/* 引擎参数 */}
            {engines.map((engine) => (
              <div key={engine.id} className="space-y-2">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">{engine.name} 参数</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">温度</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={engine.temperature}
                      onChange={(e) => updateEngine(engine.id, { temperature: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">超时（秒）</span>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      value={Math.round(engine.timeoutMs / 1000)}
                      onChange={(e) => updateEngine(engine.id, { timeoutMs: Math.max(5000, Number(e.target.value) * 1000) })}
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>
            ))}

            {/* 提示词（全部可编辑） */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">提示词</h4>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">系统提示词</span>
                <textarea
                  rows={3}
                  value={value.chat.systemPrompt}
                  onChange={(e) => updateChat({ systemPrompt: e.target.value })}
                  className={`${inputClass} resize-y leading-6`}
                />
              </label>
              {([
                ['evidencePrompt', '书内证据提示词'],
                ['readerContextPrompt', '阅读上下文提示词'],
                ['selectionPrompt', '选区引用提示词'],
                ['fullTextInjectPrompt', '本章注入提示词（按当前章，可多轮）']
              ] as const).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
                  <textarea
                    rows={2}
                    value={value.chat[key]}
                    onChange={(e) => updateChat({ [key]: e.target.value })}
                    className={`${inputClass} resize-y leading-6`}
                  />
                </label>
              ))}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
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
                <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
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
                <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  大纲生成提示词（须要求中文与逻辑顺序）
                </span>
                <textarea
                  rows={5}
                  value={value.chat.outlineSystemPrompt}
                  onChange={(e) => updateChat({ outlineSystemPrompt: e.target.value })}
                  className={`${inputClass} resize-y font-mono text-[11px] leading-5`}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  本章注入字数上限（按当前章计，超过则不注入本章、仍检索；默认 5 万）
                </span>
                <input
                  type="number"
                  min={1000}
                  max={200000}
                  step={1000}
                  value={value.chat.fullTextMaxChars ?? 50000}
                  onChange={(e) =>
                    updateChat({
                      fullTextMaxChars: Math.max(1000, Math.min(200000, Number(e.target.value) || 50000))
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>

            {/* 路由规则 */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">路由规则</h4>
              {([
                ['greetingPatterns', '问候语路由正则'],
                ['chapterPatterns', '当前章路由正则'],
                ['bookWidePatterns', '全书路由正则']
              ] as const).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
                  <textarea
                    rows={2}
                    value={value.chat[key].join('\n')}
                    onChange={(e) =>
                      updateChat({
                        [key]: e.target.value.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
                      })
                    }
                    className={`${inputClass} resize-y font-mono leading-6`}
                  />
                </label>
              ))}
            </div>

            {/* 检索与对话参数 */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">检索与对话</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">检索条数</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={value.retrieval.topK}
                    onChange={(e) => updateRetrieval({ topK: Math.min(20, Math.max(1, Number(e.target.value))) })}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">上下文字符上限</span>
                  <input
                    type="number"
                    min="1000"
                    max="50000"
                    step="1000"
                    value={value.retrieval.maxContextChars}
                    onChange={(e) => updateRetrieval({ maxContextChars: Math.min(50000, Math.max(1000, Number(e.target.value))) })}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">保留对话条数</span>
                  <input
                    type="number"
                    min="2"
                    max="100"
                    step="2"
                    value={value.chat.maxHistoryMessages}
                    onChange={(e) => updateChat({ maxHistoryMessages: Math.max(2, Number(e.target.value)) })}
                    className={inputClass}
                  />
                </label>
              </div>
            </div>

            {/* 知识库超时 */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">知识库超时</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ['healthTimeoutMs', '连接超时'],
                  ['searchTimeoutMs', '检索超时'],
                  ['ingestTimeoutMs', '导入超时'],
                  ['statusCacheMs', '状态缓存']
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}（秒）</span>
                    <input
                      type="number"
                      min="1"
                      max="600"
                      value={Math.round(value.nmem[key] / 1000)}
                      onChange={(e) => updateNmem({ [key]: Math.max(1000, Number(e.target.value) * 1000) })}
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
