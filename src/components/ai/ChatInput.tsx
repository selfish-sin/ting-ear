import { useState, type RefObject } from 'react'
import { Send, Square } from 'lucide-react'
import QuoteChips from './QuoteChips'

interface ChatInputProps {
  isStreaming: boolean
  isConfigured: boolean
  onSend: (text: string) => Promise<boolean>
  onCancel: () => Promise<void>
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  inputRef?: RefObject<HTMLTextAreaElement>
}

export default function ChatInput({
  isStreaming,
  isConfigured,
  onSend,
  onCancel,
  quotes = [],
  onRemoveQuote = () => undefined,
  inputRef
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [isComposing, setIsComposing] = useState(false)

  const submit = async () => {
    if (!isConfigured || isStreaming || !text.trim()) return
    if (await onSend(text)) setText('')
  }

  return (
    <div className="border-t border-gray-200 p-3 dark:border-dark-border">
      <QuoteChips quotes={quotes} onRemove={onRemoveQuote} />
      <div className="flex items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 focus-within:border-primary dark:border-dark-border dark:bg-dark-muted">
        <textarea
          ref={inputRef}
          id="ai-chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          disabled={!isConfigured}
          rows={2}
          placeholder={isConfigured ? '问问这本书…' : '请先配置 AI'}
          className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed dark:text-gray-100"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => void onCancel()}
            className="icon-btn h-8 w-8 flex-shrink-0 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30"
            title="停止生成"
            aria-label="停止生成"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isConfigured || !text.trim()}
            className="icon-btn h-8 w-8 flex-shrink-0 bg-primary text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            title="发送"
            aria-label="发送消息"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
