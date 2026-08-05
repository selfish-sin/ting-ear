import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Copy,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  UserRound,
  Volume2
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiChatMessage, AiSourceRef } from '../../global'
import { cn } from '../../utils/cn'
import CitationPopover from './CitationPopover'
import ReasoningBlock from './ReasoningBlock'
import EvidencePanel from './EvidencePanel'

interface ChatMessagesProps {
  messages: AiChatMessage[]
  isStreaming: boolean
  onNavigateSource?: (source: AiSourceRef) => void
  onSpeakRaw?: (text: string) => Promise<void>
  onStopRaw?: () => void
  onCopy?: (messageId: string) => Promise<boolean>
  onDelete?: (messageId: string) => Promise<void>
  onEdit?: (messageId: string, newText: string) => Promise<boolean>
  onRegenerate?: (messageId: string) => Promise<boolean>
  onRetry?: (messageId: string) => Promise<boolean>
}

function withCitationLinks(content: string, sources: AiSourceRef[]): string {
  if (sources.length === 0) return content
  const available = new Set(sources.map((source) => source.index))
  return content.replace(/\[(\d+)](?!\()/g, (match, value: string) => {
    const index = Number(value)
    return available.has(index) ? `[${index}](#ting-ear-citation-${index})` : match
  })
}

function ActionButton({
  label,
  onClick,
  children,
  danger = false,
  onUserBubble = false
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  onUserBubble?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors',
        onUserBubble
          ? danger
            ? 'text-white/80 hover:bg-white/15 hover:text-white'
            : 'text-white/80 hover:bg-white/15 hover:text-white'
          : danger
            ? 'text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-950/30 dark:hover:text-red-400'
            : 'text-gray-500 hover:bg-gray-100 hover:text-primary dark:text-gray-400 dark:hover:bg-white/5'
      )}
      title={label}
      aria-label={label}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

export default function ChatMessages({
  messages,
  isStreaming,
  onNavigateSource = () => undefined,
  onSpeakRaw,
  onStopRaw,
  onCopy,
  onDelete,
  onEdit,
  onRegenerate,
  onRetry
}: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const toggleSpeech = (messageId: string, content: string) => {
    if (!onSpeakRaw) return
    if (speakingMessageId === messageId) {
      onStopRaw?.()
      setSpeakingMessageId(null)
      return
    }
    setSpeakingMessageId(messageId)
    void onSpeakRaw(content).finally(() => {
      setSpeakingMessageId((current) => (current === messageId ? null : current))
    })
  }

  const handleCopy = async (messageId: string) => {
    if (!onCopy) return
    const ok = await onCopy(messageId)
    if (ok) {
      setCopiedId(messageId)
      window.setTimeout(() => {
        setCopiedId((current) => (current === messageId ? null : current))
      }, 1500)
    }
  }

  const startEdit = (messageId: string, content: string) => {
    setEditingId(messageId)
    setEditDraft(content)
  }

  const submitEdit = async (messageId: string) => {
    if (!onEdit) return
    const ok = await onEdit(messageId, editDraft)
    if (ok) {
      setEditingId(null)
      setEditDraft('')
    }
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <Bot className="mx-auto mb-2 h-8 w-8 text-emerald-600/70" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">开始对话</p>
          <p className="mt-1 text-xs text-gray-400">可提问当前章节、全书内容，或引用选中文字</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <div className="space-y-4">
        {messages.map((message, index) => {
          const content = message.parts.map((part) => part.text).join('')
          const isUser = message.role === 'user'
          const isLastAssistant =
            !isUser &&
            index === messages.length - 1 &&
            message.role === 'assistant'
          const showActions =
            !isStreaming &&
            message.status !== 'streaming' &&
            (message.status === 'complete' || message.status === 'error')

          return (
            <div
              key={message.id}
              id={`ai-msg-${message.id}`}
              className={cn('flex scroll-mt-3 gap-2.5', isUser && 'flex-row-reverse')}
            >
              <div
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                  isUser
                    ? 'bg-primary/10 text-primary'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                )}
              >
                {isUser ? <UserRound className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </div>
              <div
                className={cn(
                  'min-w-0 max-w-[85%] text-sm leading-6',
                  isUser
                    ? 'rounded-lg bg-primary px-3 py-2 text-white'
                    : 'text-gray-700 dark:text-gray-200'
                )}
              >
                {isUser ? (
                  editingId === message.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-md border border-white/30 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-white/50"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null)
                            setEditDraft('')
                          }}
                          className="rounded px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitEdit(message.id)}
                          disabled={!editDraft.trim()}
                          className="rounded bg-white/20 px-2 py-1 text-xs font-medium text-white hover:bg-white/30 disabled:opacity-50"
                        >
                          保存并重发
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{content}</p>
                  )
                ) : (
                  <div className="ai-markdown break-words">
                    <EvidencePanel
                      status={message.retrievalStatus}
                      sources={message.sources}
                      webSources={message.webSources}
                      webSearchUsed={message.webSearchUsed}
                      toolTraces={message.toolTraces}
                      error={message.retrievalError}
                      onNavigateSource={onNavigateSource}
                    />
                    {message.reasoning && (
                      <ReasoningBlock
                        reasoning={message.reasoning}
                        defaultOpen={message.status === 'streaming'}
                      />
                    )}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => {
                          const match = /^#ting-ear-citation-(\d+)$/.exec(href || '')
                          const source = match
                            ? message.sources?.find((item) => item.index === Number(match[1]))
                            : undefined
                          return source ? (
                            <CitationPopover source={source} onNavigate={onNavigateSource} />
                          ) : (
                            <span>{children}</span>
                          )
                        }
                      }}
                    >
                      {withCitationLinks(content, message.sources || [])}
                    </ReactMarkdown>
                    {message.status === 'streaming' && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-emerald-600 align-middle" />
                    )}
                    {message.status === 'error' && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message.error}</p>
                    )}
                  </div>
                )}

                {showActions && (
                  <div
                    className={cn(
                      'mt-1.5 flex flex-wrap items-center gap-0.5',
                      isUser && 'justify-end'
                    )}
                  >
                    {onCopy && content && message.status === 'complete' && (
                      <ActionButton
                        label={copiedId === message.id ? '已复制' : '复制'}
                        onUserBubble={isUser}
                        onClick={() => void handleCopy(message.id)}
                      >
                        {copiedId === message.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </ActionButton>
                    )}

                    {isUser && onEdit && editingId !== message.id && (
                      <ActionButton
                        label="编辑"
                        onUserBubble
                        onClick={() => startEdit(message.id, content)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}

                    {!isUser && message.status === 'complete' && content && onSpeakRaw && (
                      <ActionButton
                        label={speakingMessageId === message.id ? '停止' : '朗读'}
                        onClick={() => toggleSpeech(message.id, content)}
                      >
                        {speakingMessageId === message.id ? (
                          <Square className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </ActionButton>
                    )}

                    {!isUser &&
                      isLastAssistant &&
                      message.status === 'complete' &&
                      onRegenerate && (
                        <ActionButton label="重新生成" onClick={() => void onRegenerate(message.id)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </ActionButton>
                      )}

                    {!isUser && message.status === 'error' && onRetry && (
                      <ActionButton label="重试" onClick={() => void onRetry(message.id)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}

                    {onDelete && (
                      <ActionButton
                        label="删除"
                        danger
                        onUserBubble={isUser}
                        onClick={() => void onDelete(message.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
    </div>
  )
}
