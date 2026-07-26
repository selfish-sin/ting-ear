import assert from 'node:assert/strict'
import { useBookStore } from '../src/stores/bookStore'
import { usePlayerStore } from '../src/stores/playerStore'
import type { BookData } from '../src/global'

console.log('\nBook store')

const initialMode = useBookStore.getState().readerMode

try {
  useBookStore.getState().setReaderMode('listening')
  assert.equal(useBookStore.getState().readerMode, 'listening')
  console.log('  ok switches reader mode')
} finally {
  useBookStore.setState({ readerMode: initialMode })
}

const book: BookData = {
  id: 'reader-mode-book',
  title: '阅读模式测试',
  author: '测试作者',
  filePath: 'reader-mode.md',
  format: 'md',
  sentences: ['第一句有足够的内容用于测试阅读模式切换。', '第二句继续保持当前播放位置。'],
  chapters: [{ title: '第一章', startIndex: 0, sentenceCount: 2 }],
  currentChapterIndex: 0,
  currentSentenceIndex: 0,
  progressPercent: 0,
  isCompleted: false,
  addedAt: '2026-07-25T00:00:00.000Z',
  lastReadAt: '2026-07-25T00:00:00.000Z'
}

useBookStore.setState({ readerMode: 'listening' })
usePlayerStore.setState({ playState: 'playing', currentSentenceIndex: 1 })

try {
  useBookStore.getState().setCurrentBook(book)
  assert.equal(useBookStore.getState().readerMode, 'ai-reading')
  assert.equal(usePlayerStore.getState().playState, 'playing')
  assert.equal(usePlayerStore.getState().currentSentenceIndex, 1)
  console.log('  ok opens each book in AI reading mode without resetting playback')
} finally {
  useBookStore.setState({ currentBook: null, sentences: [], chapters: [], readerMode: initialMode })
  usePlayerStore.getState().reset()
}

console.log('Book store result: 2 passed')
