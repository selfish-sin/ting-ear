import { useEffect, useState } from 'react'
import { Database, FolderOpen, Check, AlertCircle, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useBookStore } from '../../stores/bookStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useLogStore } from '../../stores/logStore'

export type SettingsToast = (type: 'success' | 'error' | 'warning' | 'info', message: string) => void

interface Props {
  showToast: SettingsToast
}

export default function GeneralSettingsPanel({ showToast }: Props) {
  const { settings, setSettings, setAlwaysOnTop, setFloatingBallEnabled } = useSettingsStore()
  const { resetToQwenTTS } = usePlayerStore()

  const [dataDir, setDataDir] = useState('')
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [editingDir, setEditingDir] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [dirValid, setDirValid] = useState<null | { valid: boolean; error?: string; path?: string }>(null)
  const [dirValidating, setDirValidating] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [dirHistory, setDirHistory] = useState<string[]>([])

  useEffect(() => {
    Promise.all([window.api?.dataDirGet(), window.api?.dataDirGetDefault()]).then(([current, def]) => {
      if (current) setDataDir(current)
      if (def) setDefaultDataDir(def)
    })
    setDirHistory(settings.dataDirHistory || [])
  }, [settings.dataDirHistory])

  const handleOpenDir = async (path?: string) => {
    const result = await window.api?.dataDirOpen(path)
    if (!result?.success) showToast('error', result?.error || '无法打开文件夹')
  }

  const validateDir = async (path: string) => {
    if (!path.trim()) {
      setDirValid(null)
      return
    }
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
    if (!dirValid?.valid) {
      showToast('error', '路径无效，无法保存')
      return
    }
    const newPath = dirValid.path || dirInput
    if (newPath === dataDir) {
      showToast('info', '路径未变化')
      setEditingDir(false)
      return
    }
    const shouldMigrate = window.confirm(
      `是否将现有数据迁移到新位置？\n\n旧路径: ${dataDir}\n新路径: ${newPath}\n\n点击「确定」迁移数据（推荐）\n点击「取消」仅切换路径（数据需手动迁移）`
    )
    if (shouldMigrate) {
      setMigrating(true)
      try {
        const result = await window.api?.dataDirMigrate(newPath)
        if (!result?.success) {
          showToast('error', result?.error || '数据迁移失败')
          setMigrating(false)
          return
        }
        showToast('success', result.migrated ? '数据迁移完成' : '无需迁移')
      } catch (e) {
        showToast('error', `迁移失败: ${String(e)}`)
        setMigrating(false)
        return
      }
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

  const handleRestoreDir = async (oldPath: string) => {
    setDirInput(oldPath)
    setEditingDir(true)
    await validateDir(oldPath)
  }

  const handleRestoreDefault = async () => {
    setDirInput(defaultDataDir)
    setEditingDir(true)
    await validateDir(defaultDataDir)
  }

  const handleCancelEdit = () => {
    setEditingDir(false)
    setDirInput('')
    setDirValid(null)
  }

  return (
            <div className="space-y-5">
              {/* Data directory */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">数据存储</h3>
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
                      <button
                        onClick={() => handleOpenDir(dataDir)}
                        className="p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="在文件管理器中打开"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingDir(true)
                          setDirInput(dataDir)
                          setDirValid(null)
                        }}
                        className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                      >
                        更改
                      </button>
                    </div>
                    {dirHistory.length > 0 && (
                      <div>
                        <button
                          onClick={() => setShowHistory((v) => !v)}
                          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          历史路径 ({dirHistory.length})
                        </button>
                        {showHistory && (
                          <div className="mt-1 space-y-1">
                            {dirHistory.map((p, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px] px-2 py-1 bg-gray-50 dark:bg-gray-900/50 rounded">
                                <code className="flex-1 truncate text-gray-500 dark:text-gray-400">{p}</code>
                                <button
                                  onClick={() => handleRestoreDir(p)}
                                  className="text-primary hover:underline shrink-0"
                                  title="恢复到此路径"
                                >
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
                        type="text"
                        value={dirInput}
                        onChange={(e) => handleDirInputChange(e.target.value)}
                        placeholder="输入或选择文件夹路径..."
                        className="flex-1 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                      />
                      <button
                        onClick={handleSelectDir}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shrink-0"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        浏览
                      </button>
                    </div>
                    {/* 验证状态 */}
                    {dirValidating && (
                      <div className="text-[11px] text-gray-400 flex items-center gap-1">
                        <span className="animate-pulse">●</span> 验证中...
                      </div>
                    )}
                    {dirValid && !dirValidating && (
                      <div className={`text-[11px] flex items-center gap-1 ${dirValid.valid ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                        {dirValid.valid ? (
                          <><Check className="w-3 h-3" /> 路径有效: {dirValid.path}</>
                        ) : (
                          <><AlertCircle className="w-3 h-3" /> {dirValid.error}: {dirValid.path}</>
                        )}
                      </div>
                    )}
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveDir}
                        disabled={!dirValid?.valid || migrating}
                        className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {migrating ? '迁移中...' : '保存'}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:underline"
                      >
                        取消
                      </button>
                      {dataDir !== defaultDataDir && (
                        <button
                          onClick={handleRestoreDefault}
                          className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 hover:text-primary"
                        >
                          <RotateCcw className="w-3 h-3" />
                          恢复默认
                        </button>
                      )}
                    </div>
                    {dirInput && dirInput !== dataDir && dirValid?.valid && (
                      <p className="text-[11px] text-amber-500 dark:text-amber-400">
                        ⚠️ 更改路径后建议重启应用以确保所有功能正常工作
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 设置迁移 */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">设置迁移</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  导出/导入朗读、AI、清洗规则与快捷键等（含 API Key，请自行保管）。不会改动数据目录。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await window.api?.exportSettings()
                      if (result?.success) {
                        showToast('success', result.filePath ? `设置已导出：${result.filePath}` : '设置已导出')
                      } else if (result?.error && result.error !== '已取消') {
                        showToast('error', result.error)
                      }
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    导出设置
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('导入将覆盖当前设置（数据目录保持不变）。继续？')) return
                      const result = await window.api?.importSettings()
                      if (result?.success) {
                        await useSettingsStore.getState().loadSettings()
                        showToast('success', '设置已导入，部分项可能需重启生效')
                      } else if (result?.error && result.error !== '已取消') {
                        showToast('error', result.error)
                      }
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    导入设置
                  </button>
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

                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={settings.autoResume === true}
                    onChange={(e) => setSettings({ autoResume: e.target.checked })}
                  />
                  启动时恢复上次阅读
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

              {/* 数据管理 */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">数据管理</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  删除书籍、封面、历史等本地数据。朗读设置与清洗规则不受影响。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除书架数据？（书籍、封面、编辑记录）')) return
                      await window.api?.clearCache('books')
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
                      await window.api?.clearCache('history')
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
                      await window.api?.clearCache('audio')
                      showToast('success', '语音缓存已清除')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    🔊 语音缓存
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定清除日志？')) return
                      await window.api?.clearCache('logs')
                      showToast('success', '日志已清除')
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    📋 日志
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('⚠️ 确定删除全部书籍与数据？\n\n书架、历史、缓存、日志、AI 对话全部清空。\n朗读设置与清洗规则会保留。')) return
                      // 1. 先清空内存状态，防止自动保存把旧数据写回
                      const bookStore = useBookStore.getState()
                      bookStore.setCurrentBook(null)
                      bookStore.setBooks([])
                      // 2. 通过正常保存通道持久化空书架
                      await window.api?.saveProgress([])
                      // 3. 清除其余文件（封面、音频缓存、大纲、历史等）
                      const result = await window.api?.clearCache('all')
                      if (result && !result.success) {
                        showToast('error', `部分清除失败：${result.error || '未知错误'}`)
                        return
                      }
                      // 4. 刷新各 store
                      useHistoryStore.getState().loadHistory()
                      useLogStore.getState().loadLogs()
                      showToast('success', '全部书籍与数据已删除（设置保留）')
                    }}
                    className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    删除全部书籍与数据
                  </button>
                </div>
              </div>
            </div>
  )
}
