import { useState } from 'react'
import { ChevronDown, ChevronRight, Code2, Quote, Square, Volume2 } from 'lucide-react'
import type { Block } from '../../global'
import { cn } from '../../utils/cn'

interface ContentCardProps {
  block: Block
  sentences: string[]
  currentSentenceIndex: number
  onSpeakRaw?: (
    text: string,
    onSentence?: (sentenceIndex: number, total: number) => void
  ) => Promise<void>
  onStopRaw?: () => void
  /** 点击某句：只设定播放起点 */
  onSeekToSentence?: (sentenceIndex: number) => void
}

const headingSizes: Record<number, string> = {
  1: 'text-2xl',
  2: 'text-xl',
  3: 'text-lg',
  4: 'text-base',
  5: 'text-sm',
  6: 'text-sm'
}

export default function ContentCard({
  block,
  sentences,
  currentSentenceIndex,
  onSpeakRaw,
  onStopRaw,
  onSeekToSentence
}: ContentCardProps) {
  const isNote = block.type === 'footnote' || block.type === 'endnote'
  const isPlainReadingBlock = block.type === 'paragraph' || block.type === 'list'
  const [collapsed, setCollapsed] = useState(isNote)
  const [isRawSpeaking, setIsRawSpeaking] = useState(false)
  const [rawSentenceIndex, setRawSentenceIndex] = useState(-1)
  const [start, end] = block.sentenceRange
  const isActive = currentSentenceIndex >= start && currentSentenceIndex < end
  const blockSentences = sentences.slice(start, end)

  const toggleRawSpeech = () => {
    if (!onSpeakRaw) return
    if (isRawSpeaking) {
      onStopRaw?.()
      setIsRawSpeaking(false)
      setRawSentenceIndex(-1)
      return
    }
    setIsRawSpeaking(true)
    void onSpeakRaw(block.text, (sentenceIndex) => {
      setRawSentenceIndex(sentenceIndex)
    }).finally(() => {
      setIsRawSpeaking(false)
      setRawSentenceIndex(-1)
    })
  }

  const sentenceContent =
    blockSentences.length > 0 ? (
      blockSentences.map((sentence, offset) => {
        const sentenceIndex = start + offset
        return (
          <span
            key={sentenceIndex}
            data-sentence-index={sentenceIndex}
            role={onSeekToSentence ? 'button' : undefined}
            tabIndex={onSeekToSentence ? 0 : undefined}
            onClick={(event) => {
              if (!onSeekToSentence) return
              event.stopPropagation()
              onSeekToSentence(sentenceIndex)
            }}
            onKeyDown={(event) => {
              if (!onSeekToSentence) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onSeekToSentence(sentenceIndex)
            }}
            className={cn(
              'rounded px-0.5 py-0.5 transition-colors',
              onSeekToSentence && 'cursor-pointer hover:bg-primary/10',
              (sentenceIndex === currentSentenceIndex ||
                (isRawSpeaking && offset === rawSentenceIndex)) &&
                'bg-highlight text-gray-950 dark:bg-primary/25 dark:text-white'
            )}
            title={onSeekToSentence ? '点击设定播放起点' : undefined}
          >
            {sentence}
            {offset < blockSentences.length - 1 ? ' ' : ''}
          </span>
        )
      })
    ) : (
      <span>{block.text}</span>
    )

  const rawSpeechButton =
    !block.ttsSkip && onSpeakRaw ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          toggleRawSpeech()
        }}
        className="icon-btn absolute right-2 top-2 h-8 w-8"
        title={isRawSpeaking ? '停止朗读本段' : '朗读本段'}
        aria-label={isRawSpeaking ? '停止朗读本段' : '朗读本段'}
      >
        {isRawSpeaking ? (
          <Square className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>
    ) : null

  if (block.type === 'heading') {
    return (
      <section
        id={`reader-block-${block.blockId}`}
        data-block-id={block.blockId}
        data-active={isActive || undefined}
        className={cn(
          'relative scroll-mt-16 border-l-4 px-4 py-3',
          isActive ? 'border-primary bg-primary/5' : 'border-transparent'
        )}
      >
        {rawSpeechButton}
        <h2
          className={cn(
            'font-semibold leading-relaxed text-gray-950 dark:text-gray-50',
            rawSpeechButton && 'pr-8',
            headingSizes[Math.min(6, Math.max(1, block.level || 2))]
          )}
        >
          {sentenceContent}
        </h2>
      </section>
    )
  }

  return (
    <article
      id={`reader-block-${block.blockId}`}
      data-block-id={block.blockId}
      data-active={isActive || undefined}
      className={cn(
        'relative scroll-mt-16 transition-colors',
        isPlainReadingBlock
          ? 'reader-paragraph rounded-r-md border-l-2 px-3 py-2'
          : 'rounded-lg border px-4 py-3',
        isPlainReadingBlock
          ? isActive
            ? 'border-l-primary bg-primary/5'
            : 'border-l-transparent'
          : isActive
            ? 'border-primary bg-primary/5 shadow-soft'
            : 'border-gray-200 bg-white dark:border-dark-border dark:bg-dark-surface',
        block.type === 'quote' && 'border-l-4 border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10',
        block.type === 'code' && 'border-gray-800 bg-gray-950 text-gray-100 dark:bg-black',
        isNote && 'bg-gray-50 text-gray-500 dark:bg-dark-muted dark:text-gray-400'
      )}
    >
      {rawSpeechButton}
      {isNote && (
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center gap-2 text-left text-xs font-medium text-gray-500 hover:text-primary dark:text-gray-400"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {block.type === 'footnote' ? '脚注' : '尾注'}
        </button>
      )}

      {!collapsed && (
        <div
          className={cn(
            'leading-8 text-gray-700 dark:text-gray-200',
            !block.ttsSkip && onSpeakRaw && 'pr-8',
            isNote && 'mt-2 text-sm leading-7 text-gray-500 dark:text-gray-400',
            block.type === 'quote' && 'flex gap-3 italic text-gray-700 dark:text-gray-200',
            block.type === 'code' && 'flex gap-3 font-mono text-sm leading-6 text-gray-100',
            block.type === 'list' && 'flex gap-3 pl-2'
          )}
        >
          {block.type === 'quote' && <Quote className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-600" />}
          {block.type === 'code' && <Code2 className="mt-1 h-4 w-4 flex-shrink-0 text-cyan-400" />}
          <div className={cn('min-w-0 flex-1', block.type === 'code' && 'whitespace-pre-wrap break-words')}>
            {block.type === 'code' ? block.text : sentenceContent}
          </div>
        </div>
      )}
    </article>
  )
}
