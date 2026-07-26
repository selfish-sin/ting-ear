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

  assert.deepEqual(
    clampPlaybackCapsulePosition(
      { x: -20, y: 900 },
      { width: 800, height: 600 },
      { width: 150, height: 44 }
    ),
    { x: 8, y: 548 }
  )
  assert.deepEqual(
    clampPlaybackCapsulePosition(
      { x: 320, y: 240 },
      { width: 800, height: 600 },
      { width: 150, height: 44 }
    ),
    { x: 320, y: 240 }
  )
  console.log('  ok clamps the draggable AI playback capsule inside the reader')

  const capsuleMarkup = renderToStaticMarkup(
    createElement(AiPlaybackCapsule, {
      playState: 'paused',
      currentSentencePreview: '这是当前播放起点句子。',
      onPlay: () => undefined,
      onPause: () => undefined,
      onPrevSentence: () => undefined,
      onNextSentence: () => undefined
    })
  )
  assert.match(capsuleMarkup, /data-playback-drag-handle="true"/)
  assert.match(capsuleMarkup, /data-playback-preview="true"/)
  assert.match(capsuleMarkup, /这是当前播放起点句子/)
  console.log('  ok exposes a dedicated drag handle and shows play-head preview')

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
  console.log('  ok preserves playback state and progress while switching modes')

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
