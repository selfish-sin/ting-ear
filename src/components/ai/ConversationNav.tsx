import { useEffect, useState } from 'react'
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import { useAiStore } from '../../stores/aiStore'
import { cn } from '../../utils/cn'

/**
 * ChatGPT 式对话列表（侧栏）：
 * - 一排会话标题，点切换
 * - 悬停显示完整标题 / 时间 / 条数（不用夸张放大动画）
 * - 顶部「新对话」
 */
export default function ConversationNav() {
  const {
    conversations,
    activeConvId,
    isStreaming,
    loadConversations,
    newConversation,
    switchConversation,
    deleteConversation,
    renameConversation
  } = useAiStore()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  const submitRename = async (id: string) => {
    const ok = await renameConversation(id, renameDraft)
    if (ok) {
      setRenamingId(null)
      setRenameDraft('')
    }
  }

  return (
    <div className="flex h-full w-[9.5rem] flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50/90 dark:border-dark-border dark:bg-dark-muted/30">
      <div className="flex-shrink-0 border-b border-gray-200 p-1.5 dark:border-dark-border">
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => void newConversation()}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-medium text-primary shadow-sm ring-1 ring-gray-200 transition hover:bg-primary/5 disabled:opacity-40 dark:bg-dark-surface dark:ring-dark-border"
          title="新建对话"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          新对话
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-[10px] text-gray-400">暂无会话</p>
        ) : (
          conversations.map((conv) => {
            const active = conv.id === activeConvId
            const hovered = hoverId === conv.id
            return (
              <div
                key={conv.id}
                className="relative"
                onMouseEnter={() => setHoverId(conv.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {renamingId === conv.id ? (
                  <div className="rounded-md bg-white p-1 ring-1 ring-primary/30 dark:bg-dark-surface">
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename(conv.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => void submitRename(conv.id)}
                      className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-800 focus:border-primary focus:outline-none dark:border-dark-border dark:bg-dark-surface dark:text-gray-100"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isStreaming}
                    onClick={() => void switchConversation(conv.id)}
                    className={cn(
                      'group flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-gray-600 hover:bg-white hover:shadow-sm dark:text-gray-300 dark:hover:bg-dark-surface'
                    )}
                    title={`${conv.title}\n${new Date(conv.createdAt).toLocaleString()} · ${conv.messageCount} 条`}
                  >
                    <span className="truncate text-[11px] font-medium leading-tight">
                      {conv.title || '新对话'}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 truncate text-[10px] leading-tight',
                        active ? 'text-primary/70' : 'text-gray-400'
                      )}
                    >
                      {new Date(conv.createdAt).toLocaleDateString()} · {conv.messageCount} 条
                    </span>
                  </button>
                )}

                {/* 悬停操作：不放大整块，只浮出小按钮（比 ChatGPT 夸张动画更克制） */}
                {hovered && renamingId !== conv.id && (
                  <div className="absolute right-0.5 top-0.5 flex gap-0.5 rounded bg-white/95 p-0.5 shadow-sm ring-1 ring-gray-200 dark:bg-dark-surface dark:ring-dark-border">
                    <button
                      type="button"
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-primary dark:hover:bg-white/10"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingId(conv.id)
                        setRenameDraft(conv.title)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteConversation(conv.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
