import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent
} from 'react'
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

/** 未测量前的估算高度（px）；虚拟列表靠它决定窗口 */
const ESTIMATED_BLOCK_HEIGHT = 96
const OVERSCAN = 6

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
  // 用户手动滚动后暂停自动跟随；阅读位置变化(点句/翻章)时重新启用
  const autoFollowRef = useRef(true)
  const lastUserScrollAtRef = useRef(0)
  const prevIndexRef = useRef(currentSentenceIndex)

  // —— 虚拟列表状态 ——
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(640)
  const measuredHeightsRef = useRef<Map<string, number>>(new Map())
  const [measureTick, setMeasureTick] = useState(0)

  const blocks = chapter?.blocks || []

  const getBlockHeight = useCallback((blockId: string) => {
    return measuredHeightsRef.current.get(blockId) ?? ESTIMATED_BLOCK_HEIGHT
  }, [])

  const offsets = useMemo(() => {
    const tops: number[] = new Array(blocks.length)
    let acc = 0
    for (let i = 0; i < blocks.length; i++) {
      tops[i] = acc
      acc += getBlockHeight(blocks[i].blockId) + 12 // gap-3 ≈ 12
    }
    return { tops, total: acc }
    // measureTick：可见块实测高度更新后重算垫片
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, getBlockHeight, measureTick])

  // 二分找第一个 top >= scrollTop - overscan 的块
  const findStartIndex = useCallback(
    (targetTop: number) => {
      let lo = 0
      let hi = blocks.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if ((offsets.tops[mid] ?? 0) < targetTop) lo = mid + 1
        else hi = mid
      }
      return Math.max(0, lo - 1)
    },
    [blocks.length, offsets.tops]
  )

  const startIndex = useMemo(() => {
    if (blocks.length === 0) return 0
    return findStartIndex(Math.max(0, scrollTop - OVERSCAN * ESTIMATED_BLOCK_HEIGHT))
  }, [blocks.length, findStartIndex, scrollTop])

  const endIndex = useMemo(() => {
    if (blocks.length === 0) return 0
    const bottom = scrollTop + viewportHeight + OVERSCAN * ESTIMATED_BLOCK_HEIGHT
    let i = startIndex
    while (i < blocks.length && (offsets.tops[i] ?? 0) < bottom) i += 1
    return Math.min(blocks.length, i + 1)
  }, [blocks.length, offsets.tops, scrollTop, startIndex, viewportHeight])

  const visibleBlocks = useMemo(
    () => blocks.slice(startIndex, endIndex).map((block, offset) => ({ block, index: startIndex + offset })),
    [blocks, startIndex, endIndex]
  )

  const padTop = offsets.tops[startIndex] ?? 0
  const padBottom = Math.max(0, offsets.total - (offsets.tops[endIndex] ?? offsets.total))

  // 测量可见块真实高度
  useEffect(() => {
    const root = containerRef.current
    if (!root || visibleBlocks.length === 0) return
    let changed = false
    for (const { block } of visibleBlocks) {
      const el = root.querySelector(`[data-vblock-id="${CSS.escape(block.blockId)}"]`) as HTMLElement | null
      if (!el) continue
      const h = el.offsetHeight
      if (h > 0 && measuredHeightsRef.current.get(block.blockId) !== h) {
        measuredHeightsRef.current.set(block.blockId, h)
        changed = true
      }
    }
    if (changed) setMeasureTick((n) => n + 1)
  }, [visibleBlocks, chapter?.title])

  // 视口高度
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setViewportHeight(el.clientHeight || 640)
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [chapter?.title])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  // 监听用户手动滚动：滚轮/触摸/键盘翻页时，2.5 秒内不打断用户
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const markManual = () => {
      lastUserScrollAtRef.current = Date.now()
    }
    el.addEventListener('wheel', markManual, { passive: true })
    el.addEventListener('touchmove', markManual, { passive: true })
    return () => {
      el.removeEventListener('wheel', markManual)
      el.removeEventListener('touchmove', markManual)
    }
  }, [])

  // 阅读位置被显式改变（点句/翻章/大纲）→ 恢复自动跟随
  useEffect(() => {
    if (prevIndexRef.current !== currentSentenceIndex) {
      autoFollowRef.current = true
      prevIndexRef.current = currentSentenceIndex
    }
  }, [currentSentenceIndex])

  // 智能滚动：目标不在可视区时滚动；用估算 offset 先定位虚拟窗口
  useEffect(() => {
    if (!chapter) return
    if (Date.now() - lastUserScrollAtRef.current < 2500) return
    if (!autoFollowRef.current) return
    const activeIdx = chapter.blocks.findIndex(
      (b) => currentSentenceIndex >= b.sentenceRange[0] && currentSentenceIndex < b.sentenceRange[1]
    )
    if (activeIdx < 0) return
    const container = containerRef.current
    if (!container) return

    const top = offsets.tops[activeIdx] ?? activeIdx * ESTIMATED_BLOCK_HEIGHT
    const height = getBlockHeight(chapter.blocks[activeIdx].blockId)
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const visible = top >= viewTop && top + height <= viewBottom
    if (!visible) {
      const next = Math.max(0, top - container.clientHeight * 0.25)
      container.scrollTo({ top: next, behavior: 'auto' })
      setScrollTop(next)
    }
  }, [currentSentenceIndex, chapter, offsets.tops, getBlockHeight])

  // 切换章节时滚回顶部并清测量缓存
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
    setContextMenu(null)
    autoFollowRef.current = true
    measuredHeightsRef.current = new Map()
    setMeasureTick((n) => n + 1)
  }, [chapter?.title, chapter?.sentenceRange[0]])

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
    <div
      ref={containerRef}
      data-content-cards
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8"
      onScroll={onScroll}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col pb-8">
        {!hasEquivalentChapterHeading(chapter) && (
          <header
            data-chapter-title="true"
            className="mb-2 border-b border-gray-200 pb-4 dark:border-dark-border"
          >
            <p className="mb-1 text-xs font-medium text-gray-400 dark:text-gray-500">当前章节</p>
            <h1 className="text-2xl font-semibold leading-relaxed text-gray-950 dark:text-gray-50">
              {chapter.title}
            </h1>
          </header>
        )}

        {/* 虚拟列表：上下垫片 + 仅渲染可视窗口内段落 */}
        <div style={{ height: padTop }} aria-hidden />
        <div className="flex flex-col gap-3">
          {visibleBlocks.map(({ block }) => (
            <div
              key={block.blockId}
              data-vblock-id={block.blockId}
              data-sentence-start={block.sentenceRange[0]}
              tabIndex={0}
              aria-label={`段落操作：${block.text.slice(0, 32)}`}
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 reader-block-virtual"
              onContextMenu={(event) => handleContextMenu(event, block)}
              onKeyDown={(event) => handleBlockKeyDown(event, block)}
              onClick={() => {
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
        <div style={{ height: padBottom }} aria-hidden />
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
