import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Globe, Settings2, Sparkles, Trash2 } from 'lucide-react'
import type { AiChatMessage, AiSourceRef, BookData } from '../../global'
import { useAiStore } from '../../stores/aiStore'
import { useBookStore } from '../../stores/bookStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { cn } from '../../utils/cn'
import ChatInput from './ChatInput'
import ChatMessages from './ChatMessages'
import ConversationHistory from './ConversationHistory'
import NmemBanner from './NmemBanner'

interface AiChatPanelContentProps {
  messages: AiChatMessage[]
  isStreaming: boolean
  isConfigured: boolean
  onSend: (text: string) => Promise<boolean>
  onCancel: () => Promise<void>
  onClear: () => Promise<void>
  nmemStatus?: 'checking' | 'online' | 'offline'
  nmemError?: string | null
  onRetryNmem?: () => Promise<void>
  onNavigateSource?: (source: AiSourceRef) => void
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  onSpeakRaw?: (text: string) => Promise<void>
  onStopRaw?: () => void
  focusRequestId?: number | null
  onFocusRequestConsumed?: (requestId: number) => void
}

function WebSearchToggle() {
  const { settings, setSettings } = useSettingsStore()
  const enabled = settings.ai?.webSearch?.enabled ?? false
  return (
    <button
      type="button"
      onClick={() =>
        setSettings({
          ai: {
            ...settings.ai!,
            webSearch: {
              ...settings.ai!.webSearch,
              enabled: !enabled,
              prompt: settings.ai!.webSearch?.prompt || ''
            }
          }
        })
      }
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        enabled
          ? 'bg-primary/10 text-primary'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200'
      )}
      title={enabled ? '联网搜索已开启' : '联网搜索已关闭'}
    >
      <Globe className="h-3.5 w-3.5" />
    </button>
  )
}

const AI_PANEL_MIN_WIDTH = 280
const AI_PANEL_MAX_WIDTH = 560
const AI_PANEL_RESERVED_WIDTH = 216 + 208 + 320

export function clampAiPanelWidth(width: number, viewportWidth = Number.POSITIVE_INFINITY): number {
  const viewportMaxWidth = Math.max(AI_PANEL_MIN_WIDTH, viewportWidth - AI_PANEL_RESERVED_WIDTH)
  return Math.min(AI_PANEL_MAX_WIDTH, viewportMaxWidth, Math.max(AI_PANEL_MIN_WIDTH, width))
}

export function resolveChatFocusRequest(
  requestId: number | null,
  collapsed: boolean,
  inputAvailable: boolean
): 'none' | 'expand' | 'wait' | 'focus' {
  if (requestId === null) return 'none'
  if (collapsed) return 'expand'
  return inputAvailable ? 'focus' : 'wait'
}

function normalizeCitationText(value: string): string {
  return value.replace(/\s+/g, '').replace(/\p{P}/gu, '')
}

export function findSourceBlockId(book: BookData, source: AiSourceRef): string {
  const chapter = book.chapters[source.chapterIndex]
  const structuredBlocks = book.structure?.[source.chapterIndex]?.blocks || []
  const blocks = structuredBlocks.length > 0
    ? structuredBlocks
    : chapter
      ? Array.from(
          { length: Math.ceil(chapter.sentenceCount / 5) },
          (_value, blockIndex) => {
            const start = chapter.startIndex + blockIndex * 5
            return {
              blockId: `legacy-${book.id}-${source.chapterIndex}-${start}`,
              text: book.sentences
                .slice(start, Math.min(start + 5, chapter.startIndex + chapter.sentenceCount))
                .join(' ')
            }
          }
        )
      : []
  const excerpt = normalizeCitationText(source.content)
  if (excerpt && blocks.length > 0) {
    const containing = blocks.find((block) => {
      const text = normalizeCitationText(block.text)
      return text.length > 0 && text.includes(excerpt)
    })
    if (containing) return containing.blockId

    const contained = blocks
      .filter((block) => {
        const text = normalizeCitationText(block.text)
        return text.length > 0 && excerpt.includes(text)
      })
      .sort((left, right) => right.text.length - left.text.length)[0]
    if (contained) return contained.blockId
  }
  return blocks[0]?.blockId || ''
}

export function AiChatPanelContent({
  messages,
  isStreaming,
  isConfigured,
  onSend,
  onCancel,
  onClear,
  nmemStatus = 'online',
  nmemError = null,
  onRetryNmem = async () => undefined,
  onNavigateSource = () => undefined,
  quotes = [],
  onRemoveQuote = () => undefined,
  onSpeakRaw,
  onStopRaw,
  focusRequestId = null,
  onFocusRequestConsumed = () => undefined
}: AiChatPanelContentProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [panelWidth, setPanelWidth] = useState(360)
  const resizeOriginRef = useRef<{ x: number; width: number } | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeOriginRef.current = { x: event.clientX, width: panelWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = resizeOriginRef.current
    if (!origin) return
    setPanelWidth(clampAiPanelWidth(origin.width + origin.x - event.clientX, window.innerWidth))
  }

  const stopResize = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeOriginRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    const keepPanelInViewport = () => {
      setPanelWidth((width) => clampAiPanelWidth(width, window.innerWidth))
    }
    keepPanelInViewport()
    window.addEventListener('resize', keepPanelInViewport)
    return () => window.removeEventListener('resize', keepPanelInViewport)
  }, [])

  useEffect(() => {
    const action = resolveChatFocusRequest(focusRequestId, collapsed, Boolean(chatInputRef.current))
    if (action === 'expand') {
      setCollapsed(false)
      return
    }
    if (action === 'focus' && focusRequestId !== null) {
      chatInputRef.current?.focus()
      onFocusRequestConsumed(focusRequestId)
    }
  }, [collapsed, focusRequestId, onFocusRequestConsumed])

  return (
    <aside
      className={cn(
        'relative hidden flex-shrink-0 flex-col border-l border-gray-200 bg-white transition-[width] dark:border-dark-border dark:bg-dark-surface md:flex',
        collapsed && 'w-11'
      )}
      style={collapsed ? undefined : {
        width: `${panelWidth}px`,
        maxWidth: 'clamp(280px, calc(100vw - 744px), 560px)'
      }}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-label="调整 AI 助手宽度"
          aria-orientation="vertical"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none"
        />
      )}
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-gray-200 px-2 dark:border-dark-border">
        {!collapsed && (
          <>
            <Sparkles className="h-4 w-4 flex-shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-700 dark:text-gray-200">
              AI 助手
            </span>
            <WebSearchToggle />
            <ConversationHistory />
            <button
              type="button"
              onClick={() => void onClear()}
              disabled={messages.length === 0 || isStreaming}
              className="icon-btn h-8 w-8"
              title="清空本书对话"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="icon-btn h-8 w-8 flex-shrink-0"
          title={collapsed ? '展开 AI 助手' : '收起 AI 助手'}
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <>
          {!isConfigured && (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              <Settings2 className="h-3.5 w-3.5 flex-shrink-0" />
              请先在设置中配置 AI
            </div>
          )}
          <NmemBanner status={nmemStatus} error={nmemError} onRetry={onRetryNmem} />
          <ChatMessages
            messages={messages}
            isStreaming={isStreaming}
            onNavigateSource={onNavigateSource}
            onSpeakRaw={onSpeakRaw}
            onStopRaw={onStopRaw}
          />
          <ChatInput
            isStreaming={isStreaming}
            isConfigured={isConfigured}
            onSend={onSend}
            onCancel={onCancel}
            quotes={quotes}
            onRemoveQuote={onRemoveQuote}
            inputRef={chatInputRef}
          />
        </>
      )}
    </aside>
  )
}

export default function AiChatPanel({
  onSpeakRaw,
  onStopRaw
}: {
  onSpeakRaw?: (text: string) => Promise<void>
  onStopRaw?: () => void
}) {
  const currentBook = useBookStore((state) => state.currentBook)
  const aiSettings = useSettingsStore((state) => state.settings.ai)
  const {
    messages,
    isStreaming,
    nmemStatus,
    nmemError,
    initialize,
    refreshNmemStatus,
    sendMessage,
    cancelStream,
    clearHistory,
    dispose,
    quotes,
    removeQuote,
    pendingChatFocusRequestId,
    consumeChatFocusRequest
  } = useAiStore()

  useEffect(() => {
    if (!currentBook) return
    void initialize(currentBook.id, currentBook.title)
    return dispose
  }, [currentBook?.id, currentBook?.title, initialize, dispose])

  useEffect(() => {
    const intervalMs = aiSettings?.nmem.statusCacheMs
    if (!intervalMs) return
    const interval = window.setInterval(() => {
      void refreshNmemStatus()
    }, intervalMs)
    return () => window.clearInterval(interval)
  }, [aiSettings?.nmem.baseUrl, aiSettings?.nmem.statusCacheMs, refreshNmemStatus])

  const isConfigured = Boolean(aiSettings?.llm.baseUrl.trim() && aiSettings.llm.model.trim())

  const navigateSource = (source: AiSourceRef) => {
    if (!currentBook) return
    const blockId = findSourceBlockId(currentBook, source)
    if (!blockId) return
    document.getElementById(`reader-block-${blockId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }

  return (
    <AiChatPanelContent
      messages={messages}
      isStreaming={isStreaming}
      isConfigured={isConfigured}
      onSend={sendMessage}
      onCancel={cancelStream}
      nmemStatus={nmemStatus}
      nmemError={nmemError}
      onRetryNmem={() => refreshNmemStatus(true)}
      onNavigateSource={navigateSource}
      onClear={async () => {
        if (window.confirm('确定清空当前书籍的 AI 对话历史？')) await clearHistory()
      }}
      quotes={quotes}
      onRemoveQuote={removeQuote}
      onSpeakRaw={onSpeakRaw}
      onStopRaw={onStopRaw}
      focusRequestId={pendingChatFocusRequestId}
      onFocusRequestConsumed={consumeChatFocusRequest}
    />
  )
}
