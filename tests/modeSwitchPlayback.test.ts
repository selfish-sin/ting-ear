import assert from 'node:assert/strict'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useBookStore } from '../src/stores/bookStore'
import {
  shouldPublishBookPlaybackState,
  usePlayerStore
} from '../src/stores/playerStore'
import AiPlaybackCapsule, {
  clampPlaybackCapsulePosition,
  shouldShowAiPlaybackCapsule,
  shouldShowFullPlaybackBar
} from '../src/components/reader/AiPlaybackCapsule'

async function main(): Promise<void> {
  console.log('\nMode switch playback')

  assert.equal(shouldShowFullPlaybackBar('listening'), true)
  assert.equal(shouldShowFullPlaybackBar('ai-reading'), false)
  assert.equal(shouldShowAiPlaybackCapsule('ai-reading'), true)
  assert.equal(shouldShowAiPlaybackCapsule('listening'), false)
  console.log('  ok assigns one playback surface to each reader mode')

  // 兼容函数仍可用；顶栏模式不再拖拽
  assert.deepEqual(
    clampPlaybackCapsulePosition(
      { x: -20, y: 900 },
      { width: 800, height: 600 },
      { width: 150, height: 44 }
    ),
    { x: 8, y: 548 }
  )
  console.log('  ok keeps clamp helper for layout safety')

  // 顶栏内嵌：无拖拽手柄，仍有句预览
  const capsuleMarkup = renderToStaticMarkup(
    createElement(AiPlaybackCapsule, {
      playState: 'paused',
      currentSentencePreview: '这是当前播放起点句子。',
      onPlay: () => undefined,
      onPause: () => undefined,
      onPrevSentence: () => undefined,
      onNextSentence: () => undefined,
      variant: 'header'
    })
  )
  assert.doesNotMatch(capsuleMarkup, /data-playback-drag-handle/)
  assert.match(capsuleMarkup, /data-playback-variant="header"/)
  assert.match(capsuleMarkup, /data-playback-preview="true"/)
  assert.match(capsuleMarkup, /这是当前播放起点句子/)
  console.log('  ok mounts compact header playback controls without floating drag handle')

  const initialMode = useBookStore.getState().readerMode
  usePlayerStore.setState({
    playState: 'playing',
    currentSentenceIndex: 8,
    currentChapterIndex: 2,
    timeMap: [0, 1200, 2400]
  })

  const before = {
    playState: usePlayerStore.getState().playState,
    currentSentenceIndex: usePlayerStore.getState().currentSentenceIndex,
    currentChapterIndex: usePlayerStore.getState().currentChapterIndex,
    timeMap: [...usePlayerStore.getState().timeMap]
  }

  useBookStore.getState().setReaderMode('listening')
  useBookStore.getState().setReaderMode('ai-reading')

  assert.deepEqual(
    {
      playState: usePlayerStore.getState().playState,
      currentSentenceIndex: usePlayerStore.getState().currentSentenceIndex,
      currentChapterIndex: usePlayerStore.getState().currentChapterIndex,
      timeMap: usePlayerStore.getState().timeMap
    },
    before
  )
  // setReaderMode 本身不得改 playState；App 也不再在切到 AI 阅读时 tts.pause()
  assert.equal(usePlayerStore.getState().playState, 'playing')
  console.log('  ok preserves playback state and progress while switching modes (no auto-pause)')

  usePlayerStore.getState().setRawSpeechActive(true)
  assert.equal(usePlayerStore.getState().rawSpeechActive, true)
  assert.equal(usePlayerStore.getState().playState, 'playing')
  assert.equal(shouldPublishBookPlaybackState(true), false)
  assert.equal(shouldPublishBookPlaybackState(false), true)
  usePlayerStore.getState().setRawSpeechActive(false)
  console.log('  ok isolates raw speech from book history and subtitle publication')

  const playerModule = (await import('../src/components/PlayerView')) as unknown as {
    SentenceRow?: ComponentType<Record<string, unknown>>
  }
  assert.ok(playerModule.SentenceRow, 'PlayerView should expose its sentence row contract')

  const noop = () => undefined
  const skippedMarkup = renderToStaticMarkup(
    createElement(playerModule.SentenceRow!, {
      sentence: '这是一条不会朗读的脚注。',
      index: 4,
      isActive: false,
      isPlaying: false,
      isTtsSkipped: true,
      bookmarked: false,
      bookmarkAdding: false,
      bookmarkInput: '',
      fontSize: 16,
      onSentenceClick: noop,
      onCopy: noop,
      onBookmarkToggle: noop,
      onBookmarkAdd: noop,
      onBookmarkSubmit: noop,
      onBookmarkCancel: noop,
      onBookmarkInputChange: noop
    })
  )
  assert.match(skippedMarkup, /data-tts-skip="true"/)
  assert.match(skippedMarkup, /opacity-50/)
  console.log('  ok marks ttsSkip sentences as muted in listening mode')

  useBookStore.setState({ readerMode: initialMode })
  usePlayerStore.getState().reset()

  console.log('Mode switch playback result: 6 passed')
}

void main()
