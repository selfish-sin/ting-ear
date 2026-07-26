import { useEffect, useRef, useState } from 'react'
import { Bot, Square, UserRound, Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiChatMessage, AiSourceRef } from '../../global'
import { cn } from '../../utils/cn'
import CitationPopover from './CitationPopover'
import RetrievalCard from './RetrievalCard'

interface ChatMessagesProps {
  messages: AiChatMessage[]
  isStreaming: boolean
  onNavigateSource?: (source: AiSourceRef) => void
  onSpeakRaw?: (text: string) => Promise<void>
  onStopRaw?: () => void
}

function withCitationLinks(content: string, sources: AiSourceRef[]): string {
  if (sources.length === 0) return content
  const available = new Set(sources.map((source) => source.index))
  return content.replace(/\[(\d+)](?!\()/g, (match, value: string) => {
    const index = Number(value)
    return available.has(index) ? `[${index}](#ting-ear-citation-${index})` : match
  })
}

export default function ChatMessages({
  messages,
  isStreaming,
  onNavigateSource = () => undefined,
  onSpeakRaw,
  onStopRaw
}: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <Bot className="mx-auto mb-2 h-8 w-8 text-emerald-600/70" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">开始对话</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <div className="space-y-4">
        {messages.map((message) => {
          const content = message.parts.map((part) => part.text).join('')
          const isUser = message.role === 'user'
          return (
            <div key={message.id} className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
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
                  <p className="whitespace-pre-wrap break-words">{content}</p>
                ) : (
                  <div className="ai-markdown break-words">
                    {message.retrievalStatus && (
                      <RetrievalCard
                        status={message.retrievalStatus}
                        sources={message.sources || []}
                        error={message.retrievalError}
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
                    {message.status === 'complete' && content && onSpeakRaw && (
                      <button
                        type="button"
                        onClick={() => toggleSpeech(message.id, content)}
                        className="mt-2 inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-primary dark:text-gray-400 dark:hover:bg-white/5"
                        aria-label={
                          speakingMessageId === message.id ? '停止朗读回答' : '朗读回答'
                        }
                      >
                        {speakingMessageId === message.id ? (
                          <Square className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                        {speakingMessageId === message.id ? '停止' : '朗读'}
                      </button>
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
