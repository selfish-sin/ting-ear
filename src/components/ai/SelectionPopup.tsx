import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  Highlighter,
  MessageCircle,
  Play,
  Quote,
  Search,
  Volume2
} from 'lucide-react'
import { useAiStore } from '../../stores/aiStore'
import { useBookStore } from '../../stores/bookStore'
import { useSafeTimeout } from '../../hooks/useSafeTimeout'
import { cn } from '../../utils/cn'

interface SelectionRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface ViewportSize {
  width: number
  height: number
}

interface PopupSize {
  width: number
  height: number
}

interface SelectionPopupProps {
  containerRef: RefObject<HTMLElement | null>
  onCopied?: () => void
  /** 朗读选中文本（raw TTS） */
  onSpeakRaw?: (text: string) => void | Promise<void>
  /** 从选区起点句开始播放书籍 TTS */
  onPlayFromSentence?: (sentenceIndex: number) => void
  /** 用选中文本打开本书搜索 */
  onSearchInBook?: (text: string) => void
}

interface SelectionAiActions {
  addQuote: (text: string) => void
  setReaderMode: (mode: 'ai-reading') => void
  requestChatFocus: () => void
}

const VIEWPORT_MARGIN = 8
const SELECTION_GAP = 8
const DEFAULT_POPUP_SIZE = { width: 360, height: 44 }

export function isSelectableText(text: string): boolean {
  return text.trim().length > 2
}

export function queueSelectionForAi(text: string, actions: SelectionAiActions): void {
  actions.addQuote(text)
  actions.setReaderMode('ai-reading')
  actions.requestChatFocus()
}

export function clampSelectionPopupPosition(
  rect: SelectionRect,
  viewport: ViewportSize,
  popup: PopupSize = DEFAULT_POPUP_SIZE
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - popup.width - VIEWPORT_MARGIN)
  const left = Math.min(
    maxLeft,
    Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - popup.width / 2)
  )
  const above = rect.top - popup.height - SELECTION_GAP
  const below = rect.bottom + SELECTION_GAP
  const preferredTop = above >= VIEWPORT_MARGIN ? above : below
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - popup.height - VIEWPORT_MARGIN)
  return {
    left: Math.round(left),
    top: Math.round(Math.min(maxTop, Math.max(VIEWPORT_MARGIN, preferredTop)))
  }
}

/** 从选区 DOM 解析 data-sentence-index（AI 阅读句级 span） */
export function findSentenceIndexFromRange(range: Range): number | null {
  const candidates: Node[] = [range.startContainer, range.endContainer]
  for (const start of candidates) {
    let node: Node | null = start
    while (node) {
      if (node instanceof HTMLElement) {
        const raw = node.getAttribute('data-sentence-index')
        if (raw != null && raw !== '') {
          const index = Number(raw)
          if (Number.isFinite(index) && index >= 0) return index
        }
        const blockStart = node.getAttribute('data-sentence-start')
        if (blockStart != null && blockStart !== '') {
          const index = Number(blockStart)
          if (Number.isFinite(index) && index >= 0) return index
        }
      }
      if (node === range.commonAncestorContainer) break
      node = node.parentNode
    }
  }
  // 再扫选区内元素
  const root =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  const el = root?.querySelector?.('[data-sentence-index], [data-sentence-start]')
  if (el instanceof HTMLElement) {
    const raw = el.getAttribute('data-sentence-index') || el.getAttribute('data-sentence-start')
    if (raw != null) {
      const index = Number(raw)
      if (Number.isFinite(index) && index >= 0) return index
    }
  }
  return null
}

function readSelectionInContainer(container: HTMLElement): {
  text: string
  rect: SelectionRect
  sentenceIndex: number | null
  range: Range
} | null {
  const nativeSelection = window.getSelection()
  const text = nativeSelection?.toString().trim() || ''
  if (!nativeSelection || nativeSelection.rangeCount === 0 || !isSelectableText(text)) {
    return null
  }
  const range = nativeSelection.getRangeAt(0)
  const ancestor = range.commonAncestorContainer
  const selectedNode = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor
  if (!selectedNode || !container.contains(selectedNode)) return null
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return {
    text,
    rect: {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    },
    sentenceIndex: findSentenceIndexFromRange(range),
    range
  }
}

interface ToolbarButtonProps {
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  title?: string
}

function ToolbarButton({ label, icon, onClick, disabled, primary, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title || label}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-35',
        primary
          ? 'bg-primary text-[rgb(var(--on-primary-rgb))] hover:opacity-90'
          : 'text-white/90 hover:bg-white/12'
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export default function SelectionPopup({
  containerRef,
  onCopied,
  onSpeakRaw,
  onPlayFromSentence,
  onSearchInBook
}: SelectionPopupProps) {
  const addQuote = useAiStore((state) => state.addQuote)
  const requestChatFocus = useAiStore((state) => state.requestChatFocus)
  const setReaderMode = useBookStore((state) => state.setReaderMode)
  const popupRef = useRef<HTMLDivElement>(null)
  // 卸载安全的 setTimeout：组件卸载后跳过回调，避免对已卸载组件 setState
  const safeTimeout = useSafeTimeout()
  const [selection, setSelection] = useState<{
    text: string
    rect: SelectionRect
    sentenceIndex: number | null
  } | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [flash, setFlash] = useState<string | null>(null)

  const dismiss = useCallback(() => {
    setSelection(null)
    setFlash(null)
  }, [])

  const captureSelection = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      dismiss()
      return
    }
    const next = readSelectionInContainer(container)
    if (!next) {
      dismiss()
      return
    }
    setSelection({
      text: next.text,
      rect: next.rect,
      sentenceIndex: next.sentenceIndex
    })
    setPosition(
      clampSelectionPopupPosition(next.rect, {
        width: window.innerWidth,
        height: window.innerHeight
      })
    )
  }, [containerRef, dismiss])

  // 鼠标松开 / 触控结束：弹出工具栏
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseUp = (event: MouseEvent) => {
      if (popupRef.current?.contains(event.target as Node)) return
      // 等浏览器完成选区
      safeTimeout(captureSelection, 0)
    }
    const handleTouchEnd = () => {
      safeTimeout(captureSelection, 50)
    }

    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('touchend', handleTouchEnd)
    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [containerRef, captureSelection, safeTimeout])

  // 键盘选区（Shift+方向键）结束后也更新
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.shiftKey && event.key !== 'Shift') return
      if (!container.contains(document.activeElement) && !container.contains(event.target as Node)) {
        return
      }
      safeTimeout(captureSelection, 0)
    }
    container.addEventListener('keyup', onKeyUp)
    return () => container.removeEventListener('keyup', onKeyUp)
  }, [containerRef, captureSelection, safeTimeout])

  useEffect(() => {
    if (!selection) return
    const updatePosition = () => {
      const popup = popupRef.current?.getBoundingClientRect()
      setPosition(
        clampSelectionPopupPosition(
          selection.rect,
          { width: window.innerWidth, height: window.innerHeight },
          popup ? { width: popup.width, height: popup.height } : DEFAULT_POPUP_SIZE
        )
      )
    }
    updatePosition()
  }, [selection])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node)) dismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [dismiss])

  // 全局快捷键（选中文本时）：Ctrl+Shift+Q 引用，Ctrl+Shift+A 问 AI，Ctrl+Shift+C 复制
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return
      const container = containerRef.current
      if (!container) return
      const live = readSelectionInContainer(container)
      if (!live) return
      const key = event.key.toLowerCase()
      if (key === 'q') {
        event.preventDefault()
        addQuote(live.text)
        setFlash('已引用')
        safeTimeout(() => {
          dismiss()
          window.getSelection()?.removeAllRanges()
        }, 400)
      } else if (key === 'a') {
        event.preventDefault()
        queueSelectionForAi(live.text, { addQuote, setReaderMode, requestChatFocus })
        dismiss()
        window.getSelection()?.removeAllRanges()
      } else if (key === 'c') {
        // 允许系统复制，同时给反馈
        void navigator.clipboard.writeText(live.text).then(() => {
          onCopied?.()
          setFlash('已复制')
          safeTimeout(dismiss, 400)
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addQuote, containerRef, dismiss, onCopied, requestChatFocus, setReaderMode, safeTimeout])

  if (!selection || typeof document === 'undefined') return null

  const clearSelection = () => {
    dismiss()
    window.getSelection()?.removeAllRanges()
  }

  const charCount = selection.text.length
  const canPlayFrom =
    Boolean(onPlayFromSentence) &&
    selection.sentenceIndex != null &&
    Number.isFinite(selection.sentenceIndex)

  return createPortal(
    <div
      ref={popupRef}
      role="toolbar"
      aria-label="选中文本快捷工具栏"
      data-selection-toolbar="true"
      className="fixed z-[80] flex max-w-[min(96vw,28rem)] items-center gap-0.5 rounded-xl border border-white/10 bg-gray-900/95 p-1 text-xs text-white shadow-xl backdrop-blur-sm dark:bg-gray-800/95"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {flash ? (
        <span className="px-3 py-1.5 text-[11px] text-emerald-300">{flash}</span>
      ) : (
        <>
          <ToolbarButton
            label="复制"
            title="复制 (Ctrl+Shift+C)"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              void navigator.clipboard.writeText(selection.text).then(() => {
                onCopied?.()
                setFlash('已复制')
                safeTimeout(clearSelection, 350)
              })
            }}
          />
          <ToolbarButton
            label="引用"
            title="加入 AI 引用条 (Ctrl+Shift+Q)"
            icon={<Quote className="h-3.5 w-3.5" />}
            onClick={() => {
              addQuote(selection.text)
              setFlash('已加入引用')
              safeTimeout(clearSelection, 350)
            }}
          />
          <ToolbarButton
            label="问 AI"
            title="引用并打开 AI 对话 (Ctrl+Shift+A)"
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            primary
            onClick={() => {
              queueSelectionForAi(selection.text, { addQuote, setReaderMode, requestChatFocus })
              clearSelection()
            }}
          />
          <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-white/15" aria-hidden />
          <ToolbarButton
            label="朗读"
            title="朗读选中文本"
            icon={<Volume2 className="h-3.5 w-3.5" />}
            disabled={!onSpeakRaw}
            onClick={() => {
              void onSpeakRaw?.(selection.text)
              clearSelection()
            }}
          />
          <ToolbarButton
            label="从此播"
            title={
              canPlayFrom
                ? '从选区第一句开始听书'
                : '无法定位句子（请在 AI 阅读正文中选中）'
            }
            icon={<Play className="h-3.5 w-3.5" />}
            disabled={!canPlayFrom}
            onClick={() => {
              if (selection.sentenceIndex == null) return
              onPlayFromSentence?.(selection.sentenceIndex)
              clearSelection()
            }}
          />
          <ToolbarButton
            label="搜索"
            title="在本书中搜索选中文字"
            icon={<Search className="h-3.5 w-3.5" />}
            disabled={!onSearchInBook}
            onClick={() => {
              onSearchInBook?.(selection.text)
              clearSelection()
            }}
          />
          <span
            className="ml-0.5 hidden items-center gap-0.5 rounded-md bg-white/8 px-1.5 py-1 text-[10px] tabular-nums text-white/50 sm:inline-flex"
            title="选中字数"
          >
            <Highlighter className="h-3 w-3 opacity-70" />
            {charCount}
          </span>
        </>
      )}
    </div>,
    document.body
  )
}
