import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Database, Globe, Settings2, Sparkles, Trash2 } from 'lucide-react'
import type { AiChatMessage, AiSourceRef, BookData } from '../../global'
import { useAiStore } from '../../stores/aiStore'
import { useBookStore } from '../../stores/bookStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { cn } from '../../utils/cn'
import ChatInput from './ChatInput'
import ChatMessages from './ChatMessages'
import ConversationHistory from './ConversationHistory'
import KnowledgeBaseButton from './KnowledgeBaseButton'
import NmemBanner from './NmemBanner'

import { mergeAiSettings } from '../../aiSettings'

/** 输入框上方的快捷开关栏：nmem 外部知识库 + 网络搜索 */
function ChatToggles() {
  const ai = useSettingsStore((s) => s.settings.ai)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const merged = mergeAiSettings(ai)

  const toggleNmem = () => {
    setSettings({ ai: { ...merged, nmem: { ...merged.nmem, enabled: !merged.nmem.enabled } } })
  }
  const toggleWebSearch = () => {
    setSettings({ ai: { ...merged, webSearch: { ...merged.webSearch, enabled: !merged.webSearch.enabled } } })
  }

  const btnBase = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors'
  const onCls = 'bg-primary/10 text-primary'
  const offCls = 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'

  return (
    <div className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-1 dark:border-gray-700/50">
      <button type="button" onClick={toggleNmem} className={`${btnBase} ${merged.nmem.enabled ? onCls : offCls}`} title="nmem 外部知识库">
        <Database className="h-3 w-3" />
        外部知识库
      </button>
      <button type="button" onClick={toggleWebSearch} className={`${btnBase} ${merged.webSearch.enabled ? onCls : offCls}`} title="联网搜索">
        <Globe className="h-3 w-3" />
        联网搜索
      </button>
    </div>
  )
}

interface AiChatPanelContentProps {
  messages: AiChatMessage[]
  isStreaming: boolean
  isConfigured: boolean
  onSend: (text: string) => Promise<boolean>
  onCancel: () => Promise<void>
  onClear: () => Promise<void>
  nmemStatus?: 'checking' | 'online' | 'offline'
  nmemError?: string | null
  bookIngestStatus?: import('../../global').AiBookIngestStatus['status'] | 'checking'
  bookIngestError?: string | null
  /** 是否正在主动同步本书到 nmem（仅主动同步显示远程进度条，自动后台 ingest 不显示） */
  nmemManualSyncing?: boolean
  onRetryNmem?: () => Promise<void>
  onSyncBookToNmem?: () => Promise<boolean>
  onNavigateSource?: (source: AiSourceRef) => void
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  onSpeakRaw?: (text: string) => Promise<void>
  onStopRaw?: () => void
  onCopyMessage?: (messageId: string) => Promise<boolean>
  onDeleteMessage?: (messageId: string) => Promise<void>
  onEditMessage?: (messageId: string, newText: string) => Promise<boolean>
  onRegenerate?: (messageId: string) => Promise<boolean>
  onRetryMessage?: (messageId: string) => Promise<boolean>
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
  bookIngestStatus = 'none',
  bookIngestError = null,
  nmemManualSyncing = false,
  onRetryNmem = async () => undefined,
  onSyncBookToNmem,
  onNavigateSource = () => undefined,
  quotes = [],
  onRemoveQuote = () => undefined,
  onSpeakRaw,
  onStopRaw,
  onCopyMessage,
  onDeleteMessage,
  onEditMessage,
  onRegenerate,
  onRetryMessage,
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
            <KnowledgeBaseButton />
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
          <NmemBanner
            status={nmemStatus}
            error={nmemError}
            bookIngestStatus={bookIngestStatus}
            bookIngestError={bookIngestError}
            nmemManualSyncing={nmemManualSyncing}
            onRetry={onRetryNmem}
            onSyncBook={onSyncBookToNmem}
          />
          <ChatMessages
            messages={messages}
            isStreaming={isStreaming}
            onNavigateSource={onNavigateSource}
            onSpeakRaw={onSpeakRaw}
            onStopRaw={onStopRaw}
            onCopy={onCopyMessage}
            onDelete={onDeleteMessage}
            onEdit={onEditMessage}
            onRegenerate={onRegenerate}
            onRetry={onRetryMessage}
          />
          <ChatToggles />
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
    bookIngestStatus,
    bookIngestError,
    nmemManualSyncing,
    initialize,
    refreshNmemStatus,
    syncCurrentBookToNmem,
    sendMessage,
    cancelStream,
    clearHistory,
    dispose,
    quotes,
    removeQuote,
    pendingChatFocusRequestId,
    consumeChatFocusRequest,
    copyMessage,
    deleteMessage,
    editAndResend,
    regenerate,
    retryError
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

  // 与后端 resolveEngine 一致：空 baseUrl 的引擎不算已配置
  const assigned =
    aiSettings?.engines?.find((e) => e.id === aiSettings.taskAssignment?.chat) ||
    aiSettings?.engines?.[0]
  const chatEngine =
    assigned?.baseUrl?.trim() && assigned?.model?.trim()
      ? assigned
      : aiSettings?.engines?.find((e) => e.baseUrl?.trim() && e.model?.trim()) ||
        aiSettings?.llm
  const isConfigured = Boolean(chatEngine?.baseUrl?.trim() && chatEngine?.model?.trim())

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
      bookIngestStatus={bookIngestStatus}
      bookIngestError={bookIngestError}
      nmemManualSyncing={nmemManualSyncing}
      onRetryNmem={() => refreshNmemStatus(true)}
      onSyncBookToNmem={syncCurrentBookToNmem}
      onNavigateSource={navigateSource}
      onClear={async () => {
        if (window.confirm('确定清空当前书籍的 AI 对话历史？')) await clearHistory()
      }}
      quotes={quotes}
      onRemoveQuote={removeQuote}
      onSpeakRaw={onSpeakRaw}
      onStopRaw={onStopRaw}
      onCopyMessage={copyMessage}
      onDeleteMessage={deleteMessage}
      onEditMessage={editAndResend}
      onRegenerate={regenerate}
      onRetryMessage={retryError}
      focusRequestId={pendingChatFocusRequestId}
      onFocusRequestConsumed={consumeChatFocusRequest}
    />
  )
}
