import { useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2, BookOpen, X } from 'lucide-react'
import type { EditRecord } from '../global'

interface EditHistoryDialogProps {
  records: EditRecord[]
  bookTitle: string
  initialIndex?: number
  onSelect: (record: EditRecord) => void
  onDelete: (recordId: string) => void
  onClose: () => void
}

/**
 * 编辑记录浏览器——前后翻页查看处理记录。
 */
export default function EditHistoryDialog({
  records,
  bookTitle,
  initialIndex = 0,
  onSelect,
  onDelete,
  onClose
}: EditHistoryDialogProps) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, records.length - 1)))
  const record = records[index]
  if (!record) return null

  const hasPrev = index > 0
  const hasNext = index < records.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{bookTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">编辑记录 · {records.length} 条</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Record detail */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs px-2 py-0.5 rounded ${
              record.type === 'ai-clean'
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
                : record.type === 'manual'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                : 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
            }`}>
              {record.type === 'ai-clean' ? 'AI 清洗' : record.type === 'manual' ? '手动' : '清洗'}
            </span>
            <span className="text-xs text-gray-400">{index + 1} / {records.length}</span>
          </div>

          <h3 className="text-base font-medium text-gray-800 dark:text-gray-200 mb-1">{record.label}</h3>
          <p className="text-xs text-gray-400 mb-4">{record.sentenceCount} 句</p>

          {/* Preview: first 5 sentences */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-32 overflow-y-auto text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {record.sentences.slice(0, 5).map((s, i) => (
              <span key={i}>{s}</span>
            ))}
            {record.sentences.length > 5 && (
              <span className="text-gray-400"> ...（共 {record.sentences.length} 句）</span>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <button
              onClick={() => setIndex((i) => i - 1)}
              disabled={!hasPrev}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-xs text-gray-400 w-16 text-center">
              {index + 1}/{records.length}
            </span>
            <button
              onClick={() => setIndex((i) => i + 1)}
              disabled={!hasNext}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => {
              onDelete(record.id)
              // 删除后跳转到上一条或下一条
              if (records.length <= 1) {
                onClose()
              } else if (index >= records.length - 1) {
                setIndex(Math.max(0, index - 1))
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            关闭
          </button>
          <button
            onClick={() => { onSelect(record); onClose() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            <BookOpen className="w-3.5 h-3.5" />
            使用此版本
          </button>
        </div>
      </div>
    </div>
  )
}
