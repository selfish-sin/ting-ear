import { useEffect, useState } from 'react'
import { Check, History, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react'
import { useAiStore } from '../../stores/aiStore'
import { cn } from '../../utils/cn'

/**
 * 对话历史：
 * - 默认：顶栏图标 + 下拉
 * - embedded：嵌入侧栏浮层，只渲染列表（由父级控制开关）
 */
export default function ConversationHistory({
  embedded = false,
  onPicked
}: {
  embedded?: boolean
  onPicked?: () => void
} = {}) {
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const {
    conversations,
    activeConvId,
    loadConversations,
    newConversation,
    switchConversation,
    deleteConversation,
    renameConversation
  } = useAiStore()

  useEffect(() => {
    if (embedded) {
      setRenamingId(null)
      void loadConversations()
    }
  }, [embedded, loadConversations])

  const handleOpen = () => {
    setOpen(true)
    setRenamingId(null)
    void loadConversations()
  }

  const startRename = (id: string, title: string) => {
    setRenamingId(id)
    setRenameDraft(title)
  }

  const submitRename = async (id: string) => {
    const ok = await renameConversation(id, renameDraft)
    if (ok) {
      setRenamingId(null)
      setRenameDraft('')
    }
  }

  const close = () => {
    setOpen(false)
    onPicked?.()
  }

  const list = (
    <>
      <button
        type="button"
        onClick={() => {
          void newConversation()
          close()
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/5"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        新建对话
      </button>

      <div className="my-1 border-t border-gray-100 dark:border-dark-border" />

      {conversations.length === 0 ? (
        <p className="px-3 py-3 text-center text-[11px] text-gray-400">暂无对话记录</p>
      ) : (
        <div className={embedded ? '' : 'max-h-72 overflow-y-auto'}>
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                'group flex items-center gap-1 px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/5',
                conv.id === activeConvId && 'bg-primary/5'
              )}
            >
              {renamingId === conv.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-1">
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitRename(conv.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-800 focus:border-primary focus:outline-none dark:border-dark-border dark:bg-dark-surface dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => void submitRename(conv.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-primary hover:bg-primary/10"
                    title="确认"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                    title="取消"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void switchConversation(conv.id)
                      close()
                    }}
                    className="min-w-0 flex-1 px-1 text-left"
                    title={`${conv.title}\n${new Date(conv.createdAt).toLocaleString()} · ${conv.messageCount} 条消息`}
                  >
                    <span
                      className={cn(
                        'block truncate text-[11px] leading-tight',
                        conv.id === activeConvId
                          ? 'font-medium text-primary'
                          : 'text-gray-700 dark:text-gray-300'
                      )}
                    >
                      {conv.title}
                    </span>
                    <span className="block text-[10px] text-gray-400">
                      {new Date(conv.createdAt).toLocaleDateString()} · {conv.messageCount} 条
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(conv.id, conv.title)}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition-all hover:text-primary group-hover:opacity-100"
                    title="重命名"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteConversation(conv.id)}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                    title="删除对话"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="py-1">{list}</div>
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
          open
            ? 'bg-primary/10 text-primary'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200'
        )}
        title="对话历史"
      >
        <History className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-raised">
            {list}
          </div>
        </>
      )}
    </div>
  )
}
