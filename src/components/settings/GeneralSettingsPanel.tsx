import { useEffect, useState } from 'react'
import { Ban, Database, FolderOpen, Check, AlertCircle, RefreshCw, RotateCcw, ChevronDown, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBookStore } from '../../stores/bookStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useLogStore } from '../../stores/logStore'
import {
  SHORTCUT_ACTION_LIST,
  keyToAccelerator,
  acceleratorToKeys,
  acceleratorPreview,
  isModifierKey,
  requiresModifier
} from '../../shortcuts'
import type { OutlineBatchProgress, ShortcutAction } from '../../global'

export type SettingsToast = (type: 'success' | 'error' | 'warning' | 'info', message: string) => void

interface Props {
  showToast: SettingsToast
}

/** 可折叠次要区块 */
function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        {title}
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

export default function GeneralSettingsPanel({ showToast }: Props) {
  const { settings, setSettings, setAlwaysOnTop, setFloatingBallEnabled, setTheme, setOpacity, setFontSize, setShortcuts } = useSettingsStore()

  // --- 数据目录 ---
  const [dataDir, setDataDir] = useState('')
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [editingDir, setEditingDir] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [dirValid, setDirValid] = useState<null | { valid: boolean; error?: string; path?: string }>(null)
  const [dirValidating, setDirValidating] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [dirHistory, setDirHistory] = useState<string[]>([])

  // --- 快捷键捕获 ---
  const [capturingKey, setCapturingKey] = useState<ShortcutAction | null>(null)
  const [previewAcc, setPreviewAcc] = useState('')

  // --- 章节大纲批量 ---
  const [outlineBatch, setOutlineBatch] = useState<{
    running: boolean
    progress: OutlineBatchProgress | null
    result: { succeeded: number; failed: number; skipped: number } | null
    error?: string
  }>({ running: false, progress: null, result: null })
  const [outlineForce, setOutlineForce] = useState(false)

  useEffect(() => {
    Promise.all([window.api?.dataDirGet(), window.api?.dataDirGetDefault()]).then(([current, def]) => {
      if (current) setDataDir(current)
      if (def) setDefaultDataDir(def)
    })
    setDirHistory(settings.dataDirHistory || [])
  }, [settings.dataDirHistory])

  useEffect(() => {
    if (!window.api?.onOutlineBatchProgress) return
    const unsubscribe = window.api.onOutlineBatchProgress((progress) => {
      if (progress.phase === 'done') {
        setOutlineBatch({ running: false, progress: null, result: { succeeded: progress.succeeded, failed: progress.failed, skipped: progress.skipped } })
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
        setOutlineBatch({ running: false, progress: null, result: null, error: result.reason === 'already-running' ? '已有任务在运行' : '启动失败' })
      }
    } catch (error) {
      setOutlineBatch({ running: false, progress: null, result: null, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const cancelOutlineBatch = async () => {
    try { await window.api.aiOutlineCancelBatch() } catch { /* 进度推送会自动结束 */ }
  }

  useEffect(() => {
    if (!capturingKey) return
    window.api?.applyShortcuts({})
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingKey(null)
        setPreviewAcc('')
        return
      }
      if (isModifierKey(e.key)) {
        setPreviewAcc(acceleratorPreview(e))
        return
      }
      const acc = keyToAccelerator(e)
      if (!acc) return
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
      window.api?.applyShortcuts((useSettingsStore.getState().settings.shortcuts || {}) as Record<string, string>)
    }
  }, [capturingKey, setShortcuts, showToast])

  // --- 数据目录操作 ---
  const handleOpenDir = async (path?: string) => {
    const result = await window.api?.dataDirOpen(path)
    if (!result?.success) showToast('error', result?.error || '无法打开文件夹')
  }

  const validateDir = async (path: string) => {
    if (!path.trim()) { setDirValid(null); return }
    setDirValidating(true)
    try {
      const result = await window.api?.dataDirValidate(path)
      setDirValid(result || null)
    } catch {
      setDirValid({ valid: false, error: '验证失败', path })
    } finally {
      setDirValidating(false)
    }
  }

  const handleSelectDir = async () => {
    const result = await window.api?.dataDirSelect()
    if (result?.success && result.path) {
      setDirInput(result.path)
      validateDir(result.path)
    }
  }

  const handleDirInputChange = (value: string) => {
    setDirInput(value)
    setDirValid(null)
    window.setTimeout(() => validateDir(value), 400)
  }

  const handleSaveDir = async () => {
    if (!dirValid?.valid) { showToast('error', '路径无效，无法保存'); return }
    const newPath = dirValid.path || dirInput
    if (newPath === dataDir) { showToast('info', '路径未变化'); setEditingDir(false); return }
    const shouldMigrate = window.confirm(
      `是否将现有数据迁移到新位置？\n\n旧路径: ${dataDir}\n新路径: ${newPath}\n\n点击「确定」迁移数据（推荐）\n点击「取消」仅切换路径（数据需手动迁移）`
    )
    if (shouldMigrate) {
      setMigrating(true)
      try {
        const result = await window.api?.dataDirMigrate(newPath)
        if (!result?.success) { showToast('error', result?.error || '数据迁移失败'); setMigrating(false); return }
        showToast('success', result.migrated ? '数据迁移完成' : '无需迁移')
      } catch (e) { showToast('error', `迁移失败: ${String(e)}`); setMigrating(false); return }
      setMigrating(false)
    }
    const oldPath = dataDir
    const history = [...(settings.dataDirHistory || []), oldPath].filter(Boolean)
    setSettings({ dataDir: newPath, dataDirHistory: history })
    setDataDir(newPath)
    setDirHistory(history)
    setEditingDir(false)
    setDirInput('')
    setDirValid(null)
    showToast('success', '数据目录已更新，重启应用后完全生效')
  }

  return (
    <div className="space-y-5">
      {/* ===== 外观（平铺） ===== */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">外观</h3>
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
              {t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">正文字号: {settings.fontSize.body}px</span>
            <input
              type="range" min="14" max="24" step="1"
              value={settings.fontSize.body}
              onChange={(e) => setFontSize(parseInt(e.target.value), settings.fontSize.title)}
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">书名字号: {settings.fontSize.title}px</span>
            <input
              type="range" min="16" max="28" step="1"
              value={settings.fontSize.title}
              onChange={(e) => setFontSize(settings.fontSize.body, parseInt(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">窗口透明度: {Math.round(settings.windowOpacity * 100)}%</span>
            <input
              type="range" min="0.4" max="1.0" step="0.05"
              value={settings.windowOpacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </label>
        </div>
      </div>

      {/* ===== 窗口行为（平铺） ===== */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">窗口行为</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={settings.windowAlwaysOnTop} onChange={(e) => setAlwaysOnTop(e.target.checked)} className="h-4 w-4 accent-primary" />
            窗口置顶
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={settings.floatingBallEnabled} onChange={(e) => setFloatingBallEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
            显示悬浮窗
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={settings.autoResume === true} onChange={(e) => setSettings({ autoResume: e.target.checked })} className="h-4 w-4 accent-primary" />
            启动时恢复上次阅读
          </label>
        </div>
      </div>

      {/* ===== 章节大纲（平铺） ===== */}
      <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">章节大纲</h3>
            <span className="text-[11px] text-gray-400">
              {outlineBatch.running ? '批量生成中…' : outlineBatch.result ? `上次：成功 ${outlineBatch.result.succeeded} / 失败 ${outlineBatch.result.failed}` : '批量生成书架全部大纲'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void startOutlineBatch()}
              disabled={outlineBatch.running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <RefreshCw className={`h-3 w-3 ${outlineBatch.running ? 'animate-spin' : ''}`} />
              {outlineBatch.running ? '生成中…' : '开始批量生成'}
            </button>
            <button
              onClick={() => void cancelOutlineBatch()}
              disabled={!outlineBatch.running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Ban className="h-3 w-3" />
              停止
            </button>
          </div>
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={outlineForce} onChange={(e) => setOutlineForce(e.target.checked)} disabled={outlineBatch.running} className="h-3.5 w-3.5 accent-primary" />
          强制重新生成（覆盖已有缓存）
        </label>

        {outlineBatch.progress && (
          <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800/50">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {outlineBatch.progress.bookTitle}
              <span className="ml-1 text-gray-400">（第 {outlineBatch.progress.bookIndex + 1} / {outlineBatch.progress.bookTotal} 本）</span>
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">章节 {outlineBatch.progress.chapterIndex} / {outlineBatch.progress.chapterTotal}</div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div className="h-full bg-primary transition-all" style={{ width: `${outlineBatch.progress.chapterTotal > 0 ? Math.round((outlineBatch.progress.chapterIndex / outlineBatch.progress.chapterTotal) * 100) : 0}%` }} />
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-green-600">成功 {outlineBatch.progress.succeeded}</span>
              <span className="text-red-500">失败 {outlineBatch.progress.failed}</span>
              <span className="text-gray-400">跳过 {outlineBatch.progress.skipped}</span>
            </div>
          </div>
        )}

        {outlineBatch.result && (
          <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800/50">
            <div className="text-xs text-gray-700 dark:text-gray-200">批量任务已完成</div>
            <div className="mt-1 flex gap-3 text-xs">
              <span className="text-green-600">成功 {outlineBatch.result.succeeded}</span>
              <span className="text-red-500">失败 {outlineBatch.result.failed}</span>
              <span className="text-gray-400">跳过 {outlineBatch.result.skipped}</span>
            </div>
          </div>
        )}

        {outlineBatch.error && <div className="mt-2 text-xs text-red-500">{outlineBatch.error}</div>}
      </div>

      {/* ===== 快捷键（折叠） ===== */}
      <Collapsible title="快捷键">
        <div className="space-y-3">
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
            {SHORTCUT_ACTION_LIST.map((item) => {
              const current = settings.shortcuts?.[item.key] || ''
              const isCapturing = capturingKey === item.key
              return (
                <div key={item.key} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-700 dark:text-gray-200">{item.label}</div>
                    <div className="text-[11px] text-gray-400 truncate">{item.description}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        if (isCapturing) { setCapturingKey(null); setPreviewAcc('') }
                        else { setPreviewAcc(''); setCapturingKey(item.key) }
                      }}
                      onDoubleClick={() => {
                        if (isCapturing || !current) return
                        setShortcuts({ ...(settings.shortcuts || {}), [item.key]: '' })
                        showToast('info', `已清除「${item.label}」`)
                      }}
                      title={isCapturing ? '再次点击取消' : current ? '单击重新设置 · 双击清除' : '单击设置快捷键'}
                      className={`min-w-[110px] h-8 px-2.5 rounded-lg border transition-all flex items-center justify-center gap-1 ${
                        isCapturing
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-gray-200 dark:border-gray-700 hover:border-primary/40'
                      }`}
                    >
                      {isCapturing ? (
                        previewAcc ? (
                          <span className="flex items-center gap-0.5">
                            {acceleratorToKeys(previewAcc).map((k, i) => (
                              <kbd key={i} className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded text-[11px] font-medium bg-primary/15 text-primary border border-primary/30">{k}</kbd>
                            ))}
                            <span className="text-[10px] text-primary/70 ml-0.5">…</span>
                          </span>
                        ) : (
                          <span className="text-xs text-primary">按下快捷键…</span>
                        )
                      ) : current ? (
                        acceleratorToKeys(current).map((k, i) => (
                          <kbd key={i} className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600">{k}</kbd>
                        ))
                      ) : (
                        <span className="text-xs text-gray-400">未设置</span>
                      )}
                    </button>
                    {current && !isCapturing && (
                      <button
                        onClick={() => setShortcuts({ ...(settings.shortcuts || {}), [item.key]: '' })}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        title="清除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">单击设置 · 双击清除 · Esc 取消</p>
            <button
              onClick={() => { setShortcuts({}); showToast('success', '已恢复默认快捷键') }}
              className="px-2.5 py-1 text-xs border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              恢复默认
            </button>
          </div>
        </div>
      </Collapsible>

      {/* ===== 数据与存储（折叠） ===== */}
      <Collapsible title="数据与存储">
        <div className="space-y-5">
          {/* 数据目录 */}
          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">数据目录</h4>
            {!editingDir ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Database className="w-4 h-4 text-gray-400 shrink-0" />
                  <code
                    className="flex-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-900 rounded text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors truncate"
                    title={dataDir || '加载中...'}
                    onClick={() => handleOpenDir(dataDir)}
                  >
                    {dataDir || '%APPDATA%/听伴/'}
                  </code>
                  <button onClick={() => handleOpenDir(dataDir)} className="p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="在文件管理器中打开">
                    <FolderOpen className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setEditingDir(true); setDirInput(dataDir); setDirValid(null) }} className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded">
                    更改
                  </button>
                </div>
                {dirHistory.length > 0 && (
                  <div>
                    <button onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      <ChevronDown className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
                      历史路径 ({dirHistory.length})
                    </button>
                    {showHistory && (
                      <div className="mt-1 space-y-1">
                        {dirHistory.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] px-2 py-1 bg-gray-50 dark:bg-gray-900/50 rounded">
                            <code className="flex-1 truncate text-gray-500 dark:text-gray-400">{p}</code>
                            <button onClick={() => { setDirInput(p); setEditingDir(true); validateDir(p) }} className="text-primary hover:underline shrink-0" title="恢复到此路径">
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text" value={dirInput}
                    onChange={(e) => handleDirInputChange(e.target.value)}
                    placeholder="输入或选择文件夹路径..."
                    className="flex-1 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                  <button onClick={handleSelectDir} className="flex items-center gap-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0">
                    <FolderOpen className="w-3.5 h-3.5" />
                    浏览
                  </button>
                </div>
                {dirValidating && <div className="text-[11px] text-gray-400 flex items-center gap-1"><span className="animate-pulse">●</span> 验证中...</div>}
                {dirValid && !dirValidating && (
                  <div className={`text-[11px] flex items-center gap-1 ${dirValid.valid ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {dirValid.valid ? <><Check className="w-3 h-3" /> 路径有效: {dirValid.path}</> : <><AlertCircle className="w-3 h-3" /> {dirValid.error}: {dirValid.path}</>}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveDir} disabled={!dirValid?.valid || migrating} className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50">
                    {migrating ? '迁移中...' : '保存'}
                  </button>
                  <button onClick={() => { setEditingDir(false); setDirInput(''); setDirValid(null) }} className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:underline">取消</button>
                  {dataDir !== defaultDataDir && (
                    <button onClick={() => { setDirInput(defaultDataDir); validateDir(defaultDataDir) }} className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 hover:text-primary">
                      <RotateCcw className="w-3 h-3" /> 恢复默认
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 设置迁移 */}
          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">设置迁移</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  const result = await window.api?.exportSettings()
                  if (result?.success) showToast('success', result.filePath ? `设置已导出：${result.filePath}` : '设置已导出')
                  else if (result?.error && result.error !== '已取消') showToast('error', result.error)
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5"
              >
                导出设置
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('导入将覆盖当前设置（数据目录保持不变）。继续？')) return
                  const result = await window.api?.importSettings()
                  if (result?.success) { await useSettingsStore.getState().loadSettings(); showToast('success', '设置已导入，部分项可能需重启生效') }
                  else if (result?.error && result.error !== '已取消') showToast('error', result.error)
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5"
              >
                导入设置
              </button>
            </div>
          </div>

          {/* 数据管理 */}
          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">数据管理</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  if (!window.confirm('确定清除书架数据？（书籍、封面、编辑记录）')) return
                  await window.api?.clearCache('books')
                  useBookStore.getState().loadBooks()
                  showToast('success', '书架数据已清除并刷新')
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200"
              >
                书籍 & 封面
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('确定清除收听历史？')) return
                  await window.api?.clearCache('history')
                  useHistoryStore.getState().loadHistory()
                  showToast('success', '收听历史已清除并刷新')
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200"
              >
                收听历史
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('确定清除语音缓存？（Edge / 千问已合成的音频）')) return
                  await window.api?.clearCache('audio')
                  showToast('success', '语音缓存已清除')
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200"
              >
                语音缓存
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('确定清除日志？')) return
                  await window.api?.clearCache('logs')
                  showToast('success', '日志已清除')
                }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200"
              >
                日志
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('⚠️ 确定删除全部书籍与数据？\n\n书架、历史、缓存、日志、AI 对话全部清空。\n朗读设置与清洗规则会保留。')) return
                  const bookStore = useBookStore.getState()
                  bookStore.setCurrentBook(null)
                  bookStore.setBooks([])
                  await window.api?.saveProgress([])
                  const result = await window.api?.clearCache('all')
                  if (result && !result.success) { showToast('error', `部分清除失败：${result.error || '未知错误'}`); return }
                  useHistoryStore.getState().loadHistory()
                  useLogStore.getState().loadLogs()
                  showToast('success', '全部书籍与数据已删除（设置保留）')
                }}
                className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                删除全部
              </button>
            </div>
          </div>
        </div>
      </Collapsible>
    </div>
  )
}
