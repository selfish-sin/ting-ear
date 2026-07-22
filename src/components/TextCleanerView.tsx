import { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  Loader2,
  Check,
  RotateCcw,
  Edit3,
  Save,
  FileText,
  Scissors,
  History,
  Combine,
  X
} from 'lucide-react'
import { useTextCleanStore } from '../stores/textCleanStore'
import { useBookStore } from '../stores/bookStore'
import EditHistoryDialog from './EditHistoryDialog'
import { formatFullTime } from '../utils/timeFormat'
import { splitReadableSentences } from '../utils/bookData'
import type { ToastItem, EditRecord } from '../global'

interface TextCleanerViewProps {
  showToast: (type: ToastItem['type'], message: string) => void
  onBackToShelf: () => void
  onOpenVersion: (book: import('../global').BookData, recordId: string) => void
}

/**
 * 文本清洗视图。
 *
 * 左：原始文本（只读）
 * 右：清洗结果（逐句分块，便于检查断句）
 * 工具栏：快速清洗 / 手动编辑 / 应用 / 撤销
 */
export default function TextCleanerView({
  showToast,
  onBackToShelf,
  onOpenVersion
}: TextCleanerViewProps) {
  const {
    sourceText,
    sourceBookId,
    cleanedText,
    isCleaning,
    progress,
    setCleanedText,
    setIsCleaning,
    setProgress
  } = useTextCleanStore()
  const [manualMode, setManualMode] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const taskIdRef = useRef<string | null>(null)
  // 记录最近一次产生 cleanedText 的操作来源，用于「应用」时标记记录类型
  const cleanOpRef = useRef<'quick' | 'manual' | 'none'>('none')
  const [showHistory, setShowHistory] = useState(false)
  const [pendingRecords, setPendingRecords] = useState<EditRecord[]>([])
  // 撤销栈：每个快照是一段 cleanedText
  const [undoStack, setUndoStack] = useState<string[]>([])
  // 手动编辑模式：逐句可编辑数组
  const [manualSentences, setManualSentences] = useState<string[]>([])
  // 编辑历史弹窗
  const [showManualHistory, setShowManualHistory] = useState(false)
  // 多选句子
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())

  // 监听清洗进度
  useEffect(() => {
    const cleanup = window.api?.onCleanProgress((p) => {
      setProgress(p)
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // 监听清洗完成
  useEffect(() => {
    const cleanup = window.api?.onCleanComplete((data) => {
      if (data.taskId !== taskIdRef.current) return
      setIsCleaning(false)
      if (data.cancelled) return
      if (data.error) {
        showToast('error', `清洗失败: ${data.error}`)
        return
      }
      // 撤销栈
      if (cleanedText) setUndoStack((s) => [...s, cleanedText])
      setCleanedText(data.text || '')
      setProgress({
        current: data.stats?.chunksUsed || 0,
        total: data.stats?.chunksUsed || 0,
        phase: 'done'
      })

      // 异常块提示：部分块因模型输出异常（复读/误删）已自动回退到正则清洗
      const anomaly = data.stats?.anomalyChunks || 0
      const regex = data.stats?.regexChunks || 0
      const total = data.stats?.chunksUsed || 0
      if (anomaly > 0) {
        showToast(
          'warning',
          `AI 清洗完成（${data.stats?.originalLength} → ${data.stats?.cleanedLength} 字），其中 ${anomaly}/${total} 块模型输出异常已回退正则清洗`
        )
      } else if (regex > 0 && regex === total) {
        showToast('info', `文本较短，已用规则清洗 · ${data.stats?.cleanedLength} 字`)
      } else {
        showToast(
          'success',
          `AI 清洗完成: ${data.stats?.originalLength} → ${data.stats?.cleanedLength} 字`
        )
      }
    })
    return () => {
      cleanup?.()
    }
  }, [showToast])

  useEffect(() => {
    setEditDraft(cleanedText || sourceText)
  }, [cleanedText, sourceText])

  // === 快速清洗（纯正则，秒出）===
  const handleQuickClean = async () => {
    const before = manualMode ? editDraft : sourceText
    if (!before?.trim()) {
      showToast('warning', '没有文本可处理')
      return
    }
    try {
      const res = await window.api?.enhancedClean(before)
      if (!res?.success) {
        showToast('error', '快速清洗失败')
        return
      }
      if (res.cleanedLength === before.length) {
        showToast('info', '文本已经很整洁，无需处理')
        return
      }
      // 撤销栈：保存当前状态，并清空旧审校疑点（文本已变）
      if (cleanedText) setUndoStack((s) => [...s, cleanedText])
      setCleanedText(res.text)
      cleanOpRef.current = 'quick'
      showToast(
        'success',
        `快速清洗完成: ${res.originalLength} → ${res.cleanedLength} 字（去页码/页眉/空格/合断行）`
      )
    } catch (e) {
      showToast('error', `快速清洗异常: ${String(e)}`)
    }
  }

  // === 应用清洗结果：保存到书架，回书架自动展开预选页 ===
  const handleApply = async () => {
    if (!cleanedText) {
      showToast('warning', '请先执行清洗')
      return
    }
    const sentences = splitReadableSentences(cleanedText)
    if (sentences.length === 0) {
      showToast('warning', '清洗结果没有可朗读内容')
      return
    }
    const isManual = cleanOpRef.current === 'manual'
    const type: EditRecord['type'] = isManual ? 'manual' : 'trim-spaces'
    const record: EditRecord = {
      id: `edit_${Date.now()}`,
      type,
      label: `${isManual ? '手动' : '清洗'} · ${formatFullTime(new Date())}`,
      timestamp: new Date().toISOString(),
      sentenceCount: sentences.length,
      sentences
    }

    // 导入快速文本供朗读
    const { useQuickTextStore } = await import('../stores/quickTextStore')
    useQuickTextStore.getState().setText(cleanedText)

    if (sourceBookId) {
      const books = useBookStore.getState().books
      const book = books.find((b) => b.id === sourceBookId)
      if (book) {
        // 同类型去重：找到已存在的同类型记录并替换（只保留一条）
        const oldIndex = (book.editHistory || []).findIndex((r) => r.type === type)
        let history: EditRecord[]
        if (oldIndex >= 0) {
          history = [...(book.editHistory || [])]
          history[oldIndex] = record
        } else {
          history = [...(book.editHistory || []), record]
        }
        const saved = await useBookStore
          .getState()
          .updateBookAndPersist({ ...book, editHistory: history.slice(-20) })
        if (!saved) {
          showToast('error', '保存清洗记录失败，原书内容未修改')
          return
        }
        useTextCleanStore.getState().setOpenBookAfterApply(sourceBookId)
        showToast('success', `已保存 · ${sentences.length} 句`)
      }
    } else {
      showToast('success', `已导入快速文本 · ${sentences.length} 句，可朗读或导出`)
    }
    // 回到书架 → 自动展开预选页
    onBackToShelf()
  }

  // === 记录选择：手动历史 → 恢复到编辑区；应用历史 → 切成那个版本回书架 ===
  const handleSelectRecord = (record: EditRecord, fromManual?: boolean) => {
    if (!sourceBookId) return
    if (fromManual) {
      // 手动编辑历史：恢复句子到编辑区
      setManualSentences(record.sentences)
      showToast('info', `已恢复「${record.label}」`)
    } else {
      // 应用历史：统一交给 App 激活版本，避免绕过播放器状态复位。
      const books = useBookStore.getState().books
      const book = books.find((b: { id: string }) => b.id === sourceBookId)
      if (book) onOpenVersion(book, record.id)
    }
    setShowHistory(false)
    setShowManualHistory(false)
  }

  const handleDeleteRecord = async (recordId: string) => {
    if (!sourceBookId) return
    const books = useBookStore.getState().books
    const book = books.find((b: { id: string }) => b.id === sourceBookId)
    if (book) {
      const history = (book.editHistory || []).filter((r: EditRecord) => r.id !== recordId)
      const saved = await useBookStore
        .getState()
        .updateBookAndPersist({ ...book, editHistory: history })
      if (!saved) {
        showToast('error', '删除记录失败，书架数据未修改')
        return
      }
      setPendingRecords(history)
    }
  }

  // === 撤销 (Ctrl+Z) ===
  const handleUndo = () => {
    if (undoStack.length === 0) {
      setCleanedText('')
      showToast('info', '已回到初始状态')
      return
    }
    const prev = undoStack[undoStack.length - 1]
    setUndoStack((s) => s.slice(0, -1))
    setCleanedText(prev)
    showToast('info', `已撤销 · 剩余 ${undoStack.length - 1} 步`)
  }

  // === 手动模式：内联编辑句子卡片 ===
  const handleToggleManual = () => {
    if (!manualMode) {
      // 进入编辑：从 cleanedText（无则 sourceText）分句填入
      const text = cleanedText || sourceText
      setManualSentences(splitReadableSentences(text))
      setEditDraft(text)
    } else {
      // 退出编辑：如果有改动，先提示
      const joined = manualSentences.join('')
      if (joined !== cleanedText && joined && sourceText) {
        if (cleanedText) setUndoStack((s) => [...s, cleanedText])
        setCleanedText(joined)
        cleanOpRef.current = 'manual'
      }
    }
    setManualMode(!manualMode)
  }

  // === 单句修改 ===
  const handleSentenceEdit = (index: number, value: string) => {
    setManualSentences((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  // === 多选切换 ===
  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // === 合并选中句子 ===
  const handleMergeSelected = () => {
    if (selectedIndices.size < 2) return
    const sorted = [...selectedIndices].sort((a, b) => a - b)
    const mergedText = sorted.map((i) => manualSentences[i]).join('')
    const newSentences = [...manualSentences]
    newSentences[sorted[0]] = mergedText
    for (let i = sorted.length - 1; i > 0; i--) {
      newSentences.splice(sorted[i], 1)
    }
    setManualSentences(newSentences)
    setSelectedIndices(new Set([sorted[0]]))
    showToast('info', `已合并 ${sorted.length} 句`)
  }

  // === 删除选中句子 ===
  const handleDeleteSelected = () => {
    if (selectedIndices.size === 0) return
    setManualSentences((prev) => prev.filter((_, i) => !selectedIndices.has(i)))
    setSelectedIndices(new Set())
    showToast('info', `已删除 ${selectedIndices.size} 句`)
  }

  // === 手动编辑保存：持久化当前句子快照到书的 editHistory（同类型只保留一条）===
  const handleManualSave = async () => {
    const joined = manualSentences.join('')
    if (!joined) {
      showToast('warning', '没有内容可保存')
      return
    }
    if (cleanedText) setUndoStack((s) => [...s, cleanedText])
    setCleanedText(joined)
    cleanOpRef.current = 'manual'

    if (sourceBookId) {
      const sentences = splitReadableSentences(joined)
      if (sentences.length === 0) {
        showToast('warning', '没有可朗读内容可保存')
        return
      }
      const record: EditRecord = {
        id: `edit_${Date.now()}`,
        type: 'manual',
        label: `手动 · ${formatFullTime(new Date())}`,
        timestamp: new Date().toISOString(),
        sentenceCount: sentences.length,
        sentences
      }
      const books = useBookStore.getState().books
      const book = books.find((b) => b.id === sourceBookId)
      if (book) {
        const oldIndex = (book.editHistory || []).findIndex((r) => r.type === 'manual')
        let history: EditRecord[]
        if (oldIndex >= 0) {
          history = [...(book.editHistory || [])]
          history[oldIndex] = record
        } else {
          history = [...(book.editHistory || []), record]
        }
        const saved = await useBookStore
          .getState()
          .updateBookAndPersist({ ...book, editHistory: history.slice(-20) })
        if (!saved) {
          showToast('error', '保存手动编辑失败，原书内容未修改')
          return
        }
      }
    }
    showToast('success', `已保存 ${manualSentences.length} 句`)
  }

  if (!sourceText) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
        <FileText className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-lg mb-2">没有待清洗文本</p>
        <p className="text-sm">从书架右键选择「清洗格式」或从快速文本粘贴内容</p>
        <button
          onClick={onBackToShelf}
          className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          返回书架
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900 min-h-0 overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          文本清洗
          {sourceBookId && <span className="text-xs text-gray-400 font-normal">· 来自书架</span>}
        </h2>

        <div className="flex-1" />

        {/* 快速清洗（纯正则，秒出）*/}
        <button
          onClick={handleQuickClean}
          disabled={isCleaning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-40"
        >
          <Scissors className="w-3.5 h-3.5" />
          快速清洗
        </button>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />

        {/* 手动模式 */}
        <button
          onClick={handleToggleManual}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
            manualMode
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          {manualMode ? '编辑中' : '手动编辑'}
        </button>

        {/* 撤销 (Ctrl+Z) */}
        {cleanedText && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            撤销
          </button>
        )}

        {/* 应用 */}
        {cleanedText && (
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            应用
          </button>
        )}

        {/* 返回 */}
        <button
          onClick={onBackToShelf}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          返回
        </button>
      </div>

      {/* 进度条 */}
      {isCleaning && progress && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/20">
          <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            {progress.phase === 'chunking' && '规则清洗中...'}
            {progress.phase === 'done' && '✓ 清洗完成'}
          </div>
          <div className="mt-1 h-1 bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '10%'
              }}
            />
          </div>
        </div>
      )}

      {/* 文本区域 */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧：原始文本 / 手动编辑 */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700 min-h-0">
          <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 flex-shrink-0">
            原始文本 · {sourceText.length} 字
          </div>
          <div className="flex-1 p-4 overflow-y-auto text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono min-h-0">
            {sourceText}
          </div>
        </div>

        {/* 右侧：清洗结果 */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-1.5 bg-green-50 dark:bg-green-900/10 border-b border-gray-200 dark:border-gray-700 text-xs text-green-700 dark:text-green-400 flex-shrink-0">
            清洗结果 ·{' '}
            {manualMode ? '编辑中' : cleanedText ? `${cleanedText.length} 字` : '等待处理'}
          </div>
          {manualMode ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* 手动编辑工具栏 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-green-100 dark:bg-green-900/30 border-b-2 border-green-300 dark:border-green-700 flex-shrink-0">
                <span className="text-xs text-green-700 dark:text-green-300">
                  {manualSentences.length} 句
                  {selectedIndices.size > 0 ? ` · 已选 ${selectedIndices.size}` : ''}
                </span>
                <div className="flex-1" />
                <button
                  onClick={handleMergeSelected}
                  disabled={selectedIndices.size < 2}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-30 border border-blue-200 dark:border-blue-800"
                >
                  <Combine className="w-3 h-3" /> 合并
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedIndices.size < 1}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-30 border border-red-200 dark:border-red-800"
                >
                  <X className="w-3 h-3" /> 删除
                </button>
                <button
                  onClick={handleManualSave}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  <Save className="w-3 h-3" /> 保存
                </button>
                <button
                  onClick={() => {
                    if (!sourceBookId) {
                      showToast('warning', '需要从书架打开才有历史记录')
                      return
                    }
                    const books = useBookStore.getState().books
                    const book = books.find((b) => b.id === sourceBookId)
                    setPendingRecords((book?.editHistory || []).filter((r) => r.type === 'manual'))
                    setShowManualHistory(true)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
                >
                  <History className="w-3 h-3" /> 编辑历史
                </button>
                <button
                  onClick={handleToggleManual}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
                >
                  退出编辑
                </button>
              </div>
              {/* 可编辑句子卡片列表 */}
              <div className="flex-1 p-4 overflow-y-auto min-h-0">
                <div className="flex flex-col gap-2 leading-relaxed">
                  {manualSentences.map((s, i) => (
                    <div
                      key={i}
                      className={`flex gap-2 rounded-lg bg-white dark:bg-gray-800 border px-3 py-2 transition-colors ${
                        selectedIndices.has(i)
                          ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
                          : 'border-green-200 dark:border-green-800'
                      }`}
                    >
                      {/* 多选勾 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSelect(i)
                        }}
                        className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-1 transition-colors ${
                          selectedIndices.has(i)
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-gray-300 dark:border-gray-500 hover:border-blue-400'
                        }`}
                      >
                        {selectedIndices.has(i) && (
                          <span className="text-[10px] leading-none">✓</span>
                        )}
                      </button>
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs flex items-center justify-center mt-1">
                        {i + 1}
                      </span>
                      <div
                        contentEditable
                        suppressContentEditableWarning={true}
                        onInput={(e) => handleSentenceEdit(i, e.currentTarget.textContent || '')}
                        className="flex-1 text-sm text-gray-800 dark:text-gray-200 outline-none min-h-[1.5rem] whitespace-pre-wrap"
                        spellCheck={false}
                      >
                        {s}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 p-4 overflow-y-auto text-sm text-gray-800 dark:text-gray-200 min-h-0">
              {cleanedText ? (
                <div className="flex flex-col gap-2 leading-relaxed">
                  {splitReadableSentences(cleanedText).map((s, i) => (
                    <div
                      key={i}
                      className="flex gap-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2 hover:border-primary/40 transition-colors"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span className="flex-1 whitespace-pre-wrap">{s}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">点击「快速清洗」秒出规则结果</p>
                    <p className="text-xs mt-1">清洗后在此逐句检查断句效果，可手动编辑</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* 编辑记录浏览器 */}
      {showHistory && sourceBookId && (
        <EditHistoryDialog
          records={pendingRecords}
          bookTitle={(() => {
            const b = useBookStore.getState().books.find((x) => x.id === sourceBookId)
            return b?.title || '书籍'
          })()}
          initialIndex={pendingRecords.length - 1}
          onSelect={(r) => handleSelectRecord(r)}
          onDelete={handleDeleteRecord}
          onClose={() => setShowHistory(false)}
        />
      )}
      {/* 手动编辑历史 */}
      {showManualHistory && sourceBookId && (
        <EditHistoryDialog
          records={pendingRecords}
          bookTitle={`${(() => {
            const b = useBookStore.getState().books.find((x) => x.id === sourceBookId)
            return b?.title || '书籍'
          })()} · 手动编辑记录`}
          initialIndex={0}
          onSelect={(r) => handleSelectRecord(r, true)}
          onDelete={handleDeleteRecord}
          onClose={() => setShowManualHistory(false)}
        />
      )}
    </div>
  )
}
