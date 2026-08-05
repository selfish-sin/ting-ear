import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Globe,
  GraduationCap,
  MessageSquarePlus,
  Plug,
  Settings2,
  Sparkles,
  Trash2
} from 'lucide-react'
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
import TurnNav from './TurnNav'

import { mergeAiSettings } from '../../aiSettings'

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

const headerIconBtn =
  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40 dark:text-primary-300/80 dark:hover:bg-primary/15'

const pillBase =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors'

/** 顶栏能力开关：书内(nmem) / 联网 / 学术 / MCP，窄栏可换行完整显示 */
function TopCapabilityPills() {
  const ai = useSettingsStore((s) => s.settings.ai)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const merged = mergeAiSettings(ai)

  const onCls = 'bg-primary/10 text-primary'
  const offCls = 'bg-primary/8 text-primary/55 dark:bg-primary/10 dark:text-primary-300/50'
  const academicOn = 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
  const skyOn = 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
  const mcpOn = 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300'

  const backendLabel =
    merged.webSearch.backend === 'ollama'
      ? 'Ollama'
      : merged.webSearch.backend === 'zhipu' || merged.webSearch.backend === 'zhipu-native'
        ? '智谱'
        : merged.webSearch.backend === 'ddg'
          ? 'DDG'
          : merged.webSearch.backend === 'none'
            ? '仅提示'
            : '自动'

  const academicActive =
    merged.webSearch.academicEnabled || merged.webSearch.sciverseEnabled
  const mcpActive = Boolean(merged.mcp?.enabled)
  const mcpServerCount = (merged.mcp?.servers || []).filter((s) => s.enabled).length
  const bookActive = merged.nmem.enabled || merged.retrieval.enabled

  return (
    <div
      className="flex w-full min-w-0 flex-shrink-0 flex-wrap content-start items-center gap-1"
      role="group"
      aria-label="本轮能力"
    >
      <button
        type="button"
        className={cn(pillBase, bookActive ? onCls : offCls)}
        title={
          bookActive
            ? `书内检索开（nmem ${merged.nmem.enabled ? '开' : '关'} · 检索总闸 ${merged.retrieval.enabled ? '开' : '关'}）`
            : '书内检索关（点此开启 nmem + 检索）'
        }
        onClick={() => {
          const next = !bookActive
          setSettings({
            ai: {
              ...merged,
              nmem: { ...merged.nmem, enabled: next },
              retrieval: { ...merged.retrieval, enabled: next }
            }
          })
        }}
      >
        <Database className="h-3 w-3 flex-shrink-0" />
        <span className="whitespace-nowrap">书内·nmem</span>
      </button>
      <button
        type="button"
        className={cn(pillBase, merged.webSearch.enabled ? skyOn : offCls)}
        title={
          merged.webSearch.enabled
            ? `联网开 · ${backendLabel} · 每次最多 ${merged.webSearch.maxResults ?? 5} 条`
            : '联网已关'
        }
        onClick={() =>
          setSettings({
            ai: {
              ...merged,
              webSearch: { ...merged.webSearch, enabled: !merged.webSearch.enabled }
            }
          })
        }
      >
        <Globe className="h-3 w-3 flex-shrink-0" />
        <span className="whitespace-nowrap">联网</span>
        {merged.webSearch.enabled && (
          <span className="whitespace-nowrap rounded bg-white/70 px-1 text-[9px] dark:bg-black/20">
            {backendLabel}·{merged.webSearch.maxResults ?? 5}条
          </span>
        )}
      </button>
      <button
        type="button"
        className={cn(pillBase, academicActive ? academicOn : offCls)}
        title={
          academicActive
            ? [
                merged.webSearch.academicEnabled ? 'Semantic Scholar' : null,
                merged.webSearch.sciverseEnabled ? 'SciVerse' : null
              ]
                .filter(Boolean)
                .join(' + ')
            : '学术检索（设置→工具服务可细配）'
        }
        onClick={() => {
          const next = !academicActive
          setSettings({
            ai: {
              ...merged,
              webSearch: {
                ...merged.webSearch,
                academicEnabled: next,
                sciverseEnabled: next
                  ? Boolean(merged.webSearch.sciverseApiKey?.trim()) ||
                    merged.webSearch.sciverseEnabled
                  : false
              }
            }
          })
        }}
      >
        <GraduationCap className="h-3 w-3 flex-shrink-0" />
        <span className="whitespace-nowrap">学术</span>
        {academicActive && (
          <span className="whitespace-nowrap rounded bg-white/70 px-1 text-[9px] dark:bg-black/20">
            {[
              merged.webSearch.academicEnabled ? 'S2' : null,
              merged.webSearch.sciverseEnabled ? 'SV' : null
            ]
              .filter(Boolean)
              .join('+')}
          </span>
        )}
      </button>
      <button
        type="button"
        className={cn(pillBase, mcpActive ? mcpOn : offCls)}
        title={
          mcpActive
            ? `MCP 总开关已开 · 已启用服务 ${mcpServerCount} 个（细节在设置→工具服务）`
            : 'MCP 总开关关 · 点此开启（仍需在设置里启用具体服务如 Zotero）'
        }
        onClick={() =>
          setSettings({
            ai: {
              ...merged,
              mcp: { ...merged.mcp, enabled: !mcpActive, servers: merged.mcp?.servers || [] }
            }
          })
        }
      >
        <Plug className="h-3 w-3 flex-shrink-0" />
        <span className="whitespace-nowrap">MCP</span>
        {mcpActive && (
          <span className="whitespace-nowrap rounded bg-white/70 px-1 text-[9px] dark:bg-black/20">
            {mcpServerCount > 0 ? `${mcpServerCount}服` : '无服务'}
          </span>
        )}
      </button>
    </div>
  )
}

function NewConversationButton() {
  const newConversation = useAiStore((s) => s.newConversation)
  const isStreaming = useAiStore((s) => s.isStreaming)
  return (
    <button
      type="button"
      onClick={() => void newConversation()}
      disabled={isStreaming}
      className={headerIconBtn}
      title="新建对话"
    >
      <MessageSquarePlus className="h-3.5 w-3.5" />
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
        'panel-surface relative hidden flex-shrink-0 flex-col border-l border-gray-200 bg-white transition-[width] dark:border-dark-border dark:bg-dark-surface md:flex',
        collapsed && 'w-11'
      )}
      style={
        collapsed
          ? undefined
          : {
              width: `${panelWidth}px`,
              maxWidth: 'clamp(280px, calc(100vw - 744px), 560px)'
            }
      }
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

      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-2 py-2">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className={headerIconBtn}
            title="展开 AI 对话"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Sparkles className="h-4 w-4 text-emerald-600" />
        </div>
      ) : (
        <>
          {/* 顶栏：能力 + 会话工具（会话列表仍是原来的展开菜单） */}
          <div className="flex flex-shrink-0 flex-col gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-dark-border">
            <div className="flex items-center gap-1">
              <Sparkles className="h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-700 dark:text-gray-200">
                AI 对话
              </span>
              <NewConversationButton />
              <ConversationHistory />
              <KnowledgeBaseButton />
              <button
                type="button"
                onClick={() => void onClear()}
                disabled={messages.length === 0 || isStreaming}
                className={cn(headerIconBtn, 'hover:text-red-500 dark:hover:text-red-400')}
                title="清空本书全部对话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className={headerIconBtn}
                title="收起 AI 对话"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <TopCapabilityPills />
          </div>

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

          {/* 单对话内多轮导航（≥2 问才显示） */}
          <TurnNav messages={messages} />

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
