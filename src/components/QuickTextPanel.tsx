import { useState } from 'react'
import { ClipboardPaste, Play, Trash2, Wand2 } from 'lucide-react'
import { useQuickTextStore } from '../stores/quickTextStore'

interface QuickTextPanelProps {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  onRead: (text: string) => void
}

export default function QuickTextPanel({ showToast, onRead }: QuickTextPanelProps) {
  const { text, setText, clear } = useQuickTextStore()
  const [pasting, setPasting] = useState(false)

  const charCount = text.length

  const handlePaste = async () => {
    setPasting(true)
    try {
      const clipText = await navigator.clipboard.readText()
      if (!clipText.trim()) {
        showToast('warning', '剪贴板为空')
        return
      }
      setText(clipText)
      showToast('success', `已粘贴 ${clipText.length} 字`)
    } catch {
      showToast('error', '无法读取剪贴板，请手动粘贴')
    } finally {
      setPasting(false)
    }
  }

  const handleRead = () => {
    if (!text.trim()) {
      showToast('warning', '文本框为空，请先粘贴或导入文本')
      return
    }
    onRead(text)
    showToast('success', `开始朗读 ${text.length} 字`)
  }

  const handleClear = () => {
    clear()
    showToast('info', '已清空')
  }

  const handleTidy = async () => {
    if (!text.trim()) {
      showToast('warning', '文本框为空')
      return
    }
    try {
      // 与「清洗格式」的快速清洗共用同一套逻辑：主进程 enhancedClean
      // 会应用你在「设置 → 清洗」里编辑的 cleanRules（含去页码/页眉/空格/标点全角等）
      const res = await window.api?.enhancedClean(text)
      if (!res?.success) {
        showToast('error', '工整化失败')
        return
      }
      if (res.cleanedLength === text.length) {
        showToast('info', '文本已经很整洁，无需处理')
        return
      }
      setText(res.text)
      showToast('success', `已工整化: ${res.originalLength} → ${res.cleanedLength} 字（去页码/页眉/空格/合断行）`)
    } catch {
      showToast('error', '工整化异常')
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-dark-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface flex-shrink-0">
        <button
          onClick={handlePaste}
          disabled={pasting}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          title="从剪贴板粘贴"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          粘贴
        </button>
        <button
          onClick={handleTidy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800"
          title="一键工整：与「清洗格式」同逻辑（去页码/页眉/空格/标点全角/合断行，应用你设置里的清洗规则）"
        >
          <Wand2 className="w-3.5 h-3.5" />
          工整
        </button>
        <button
          onClick={handleRead}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90"
          title="朗读文本框内容"
        >
          <Play className="w-3.5 h-3.5" />
          朗读
        </button>
        <button
          onClick={handleClear}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="清空文本框"
        >
          <Trash2 className="w-3.5 h-3.5" />
          清空
        </button>
        <div className="flex-1" />
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {charCount} 字
        </span>
      </div>

      {/* Text area */}
      <div className="flex-1 overflow-hidden p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="OCR 识别结果将自动填入此处...&#10;也可点击「粘贴」从剪贴板导入"
          className="w-full h-full resize-none bg-transparent text-gray-800 dark:text-gray-200 text-sm leading-relaxed focus:outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600"
          style={{ fontSize: '16px', lineHeight: '1.8' }}
        />
      </div>
    </div>
  )
}
