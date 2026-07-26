import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Copy, FileText, ListTree, MessageCircle, Play, Quote, Volume2 } from 'lucide-react'
import type { Block, StructuredChapter } from '../../global'
import { useAiStore } from '../../stores/aiStore'
import { useBookStore } from '../../stores/bookStore'
import ContentCard from './ContentCard'
import SelectionPopup from '../ai/SelectionPopup'
import { queueSelectionForAi } from '../ai/SelectionPopup'
import ContextMenu, { type ContextMenuGroup } from '../ui/ContextMenu'

interface ContentCardsProps {
  chapter: StructuredChapter | undefined
  sentences: string[]
  currentSentenceIndex: number
  onSpeakRaw?: (
    text: string,
    onSentence?: (sentenceIndex: number, total: number) => void
  ) => Promise<void>
  onStopRaw?: () => void
  /** 点击句子/段落：只设定播放起点，不启动 TTS */
  onSeekToSentence?: (sentenceIndex: number) => void
  /** 右键「从此处播放」：明确开始听书 */
  onPlayFromSentence?: (sentenceIndex: number) => void
  /** @deprecated 兼容旧名，等同 onPlayFromSentence */
  onSeekToChapter?: (sentenceIndex: number) => void
  /** 右键：手动全书大纲（跳过已有） */
  onGenerateBookOutlines?: () => void
  /** 右键：强制全书重生成 */
  onForceGenerateBookOutlines?: () => void
  bookOutlineRunning?: boolean
}

interface ReaderContextMenuState {
  block: Block
  text: string
  x: number
  y: number
  triggerElement: HTMLElement
}

function normalizedHeading(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function hasEquivalentChapterHeading(chapter: StructuredChapter): boolean {
  const firstMeaningfulBlock = chapter.blocks.find((block) => block.text.trim().length > 0)
  return Boolean(
    firstMeaningfulBlock?.type === 'heading' &&
      normalizedHeading(firstMeaningfulBlock.text) === normalizedHeading(chapter.title)
  )
}

export default function ContentCards({
  chapter,
  sentences,
  currentSentenceIndex,
  onSpeakRaw,
  onStopRaw,
  onSeekToSentence,
  onPlayFromSentence,
  onSeekToChapter,
  onGenerateBookOutlines,
  onForceGenerateBookOutlines,
  bookOutlineRunning = false
}: ContentCardsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ReaderContextMenuState | null>(null)
  const addQuote = useAiStore((state) => state.addQuote)
  const requestChatFocus = useAiStore((state) => state.requestChatFocus)
  const setReaderMode = useBookStore((state) => state.setReaderMode)
  const playFrom = onPlayFromSentence || onSeekToChapter

  useEffect(() => {
    const active = containerRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentSentenceIndex])

  // 切换章节时滚回顶部
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
    setContextMenu(null)
  }, [chapter?.title])

  const openContextMenu = (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    block: Block,
    point: { x: number; y: number }
  ) => {
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() || ''
    const selectionNode = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null
    const selectionInsideReader = Boolean(
      selectedText && selectionNode && containerRef.current?.contains(selectionNode)
    )
    setContextMenu({
      block,
      text: selectionInsideReader ? selectedText : block.text,
      x: point.x,
      y: point.y,
      triggerElement: event.currentTarget
    })
  }

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>, block: Block) => {
    event.preventDefault()
    event.stopPropagation()
    openContextMenu(event, block, { x: event.clientX, y: event.clientY })
  }

  const handleBlockKeyDown = (event: KeyboardEvent<HTMLDivElement>, block: Block) => {
    if (!(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    openContextMenu(event, block, { x: rect.left + 32, y: rect.top + 32 })
  }

  const readerMenuGroups: ContextMenuGroup[] = contextMenu
    ? [
        {
          id: 'playback',
          items: [
            {
              id: 'play-from-here',
              label: '从此处播放',
              icon: <Play className="h-4 w-4" />,
              disabled: !playFrom,
              onSelect: () => playFrom?.(contextMenu.block.sentenceRange[0])
            },
            {
              id: 'read-block',
              label: '朗读本段',
              icon: <Volume2 className="h-4 w-4" />,
              disabled: !onSpeakRaw || contextMenu.block.ttsSkip,
              onSelect: () => onSpeakRaw?.(contextMenu.text)
            }
          ]
        },
        {
          id: 'text',
          items: [
            {
              id: 'copy',
              label: '复制',
              icon: <Copy className="h-4 w-4" />,
              onSelect: () => navigator.clipboard.writeText(contextMenu.text)
            },
            {
              id: 'quote',
              label: '引用',
              icon: <Quote className="h-4 w-4" />,
              onSelect: () => addQuote(contextMenu.text)
            },
            {
              id: 'ask-ai',
              label: '问 AI',
              icon: <MessageCircle className="h-4 w-4" />,
              onSelect: () =>
                queueSelectionForAi(contextMenu.text, {
                  addQuote,
                  setReaderMode,
                  requestChatFocus
                })
            }
          ]
        },
        {
          id: 'outline',
          items: [
            {
              id: 'book-outline',
              label: bookOutlineRunning ? '全书大纲生成中…' : '生成本书全部大纲',
              icon: <ListTree className="h-4 w-4" />,
              disabled: bookOutlineRunning || !onGenerateBookOutlines,
              onSelect: () => onGenerateBookOutlines?.()
            },
            {
              id: 'book-outline-force',
              label: '强制重生成全书大纲',
              icon: <ListTree className="h-4 w-4" />,
              disabled: bookOutlineRunning || !onForceGenerateBookOutlines,
              onSelect: () => onForceGenerateBookOutlines?.()
            }
          ]
        }
      ]
    : []

  if (!chapter || chapter.blocks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">当前章节没有可显示的内容</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} data-content-cards className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-8">
        {!hasEquivalentChapterHeading(chapter) && (
          <header data-chapter-title="true" className="mb-2 border-b border-gray-200 pb-4 dark:border-dark-border">
            <p className="mb-1 text-xs font-medium text-gray-400 dark:text-gray-500">当前章节</p>
            <h1 className="text-2xl font-semibold leading-relaxed text-gray-950 dark:text-gray-50">
              {chapter.title}
            </h1>
          </header>
        )}
        {chapter.blocks.map((block) => (
          <div
            key={block.blockId}
            data-sentence-start={block.sentenceRange[0]}
            tabIndex={0}
            aria-label={`段落操作：${block.text.slice(0, 32)}`}
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onContextMenu={(event) => handleContextMenu(event, block)}
            onKeyDown={(event) => handleBlockKeyDown(event, block)}
            onClick={() => {
              // 点击段落：只设定播放起点，不自动 TTS
              if (!onSeekToSentence) return
              onSeekToSentence(block.sentenceRange[0])
            }}
          >
            <ContentCard
              block={block}
              sentences={sentences}
              currentSentenceIndex={currentSentenceIndex}
              onSpeakRaw={onSpeakRaw}
              onStopRaw={onStopRaw}
              onSeekToSentence={onSeekToSentence}
            />
          </div>
        ))}
      </div>
      <SelectionPopup
        containerRef={containerRef}
        onSpeakRaw={onSpeakRaw ? (text) => { void onSpeakRaw(text) } : undefined}
        onPlayFromSentence={playFrom}
      />
      <ContextMenu
        open={contextMenu !== null}
        point={{ x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }}
        groups={readerMenuGroups}
        ariaLabel="正文操作"
        triggerElement={contextMenu?.triggerElement}
        onClose={() => setContextMenu(null)}
      />
    </div>
  )
}
