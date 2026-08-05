import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ReasoningBlockProps {
  reasoning: string
  /** 流式输出中默认展开，完成后可收起 */
  defaultOpen?: boolean
}

/**
 * 展示模型原生思考链（DeepSeek-R1 等的 reasoning_content）。
 * 与回答正文分离，可折叠。
 */
export default function ReasoningBlock({ reasoning, defaultOpen = false }: ReasoningBlockProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (!reasoning.trim()) return null

  return (
    <div className="mb-2 rounded-md border border-violet-200 bg-violet-50/80 text-xs dark:border-violet-900/50 dark:bg-violet-950/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-medium text-violet-800 dark:text-violet-300"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3.5 w-3.5" />
        <span>思考过程</span>
        <span className="ml-auto text-[10px] font-normal text-violet-500">
          {open ? '收起' : '展开'} · {reasoning.length} 字
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-violet-200 px-2.5 py-2 whitespace-pre-wrap leading-5 text-violet-900/90 dark:border-violet-900/40 dark:text-violet-200/90">
          {reasoning}
        </div>
      )}
    </div>
  )
}
