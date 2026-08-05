import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ListTree } from 'lucide-react'
import type { AiChatMessage } from '../../global'
import { cn } from '../../utils/cn'

interface TurnNavProps {
  messages: AiChatMessage[]
}

/**
 * 单对话内多轮快速导航：列出本会话用户提问，点击滚到对应气泡。
 * （不是会话列表；会话列表仍用顶栏「历史」展开）
 */
export default function TurnNav({ messages }: TurnNavProps) {
  const [open, setOpen] = useState(false)

  const turns = useMemo(() => {
    const items: Array<{ id: string; index: number; preview: string }> = []
    let n = 0
    for (const m of messages) {
      if (m.role !== 'user') continue
      n += 1
      const text = m.parts.map((p) => p.text).join('').trim().replace(/\s+/g, ' ')
      items.push({
        id: m.id,
        index: n,
        preview: text.length > 36 ? `${text.slice(0, 36)}…` : text || `提问 ${n}`
      })
    }
    return items
  }, [messages])

  if (turns.length < 2) return null

  const scrollTo = (id: string) => {
    document.getElementById(`ai-msg-${id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  }

  return (
    <div className="flex-shrink-0 border-b border-gray-100 dark:border-gray-700/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-gray-500 transition hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5"
      >
        <ListTree className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          本轮导航 · {turns.length} 问
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="max-h-36 space-y-0.5 overflow-y-auto border-t border-gray-100 px-2 py-1.5 dark:border-gray-700/50">
          {turns.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => scrollTo(t.id)}
              className={cn(
                'flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition',
                'text-gray-600 hover:bg-primary/5 hover:text-primary dark:text-gray-300'
              )}
              title={t.preview}
            >
              <span className="mt-0.5 flex-shrink-0 rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                Q{t.index}
              </span>
              <span className="min-w-0 flex-1 truncate leading-relaxed">{t.preview}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
