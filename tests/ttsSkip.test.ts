import assert from 'node:assert/strict'
import {
  findNextPlayableSentence,
  findPreviousPlayableSentence,
  getPlayablePrefetchIndices,
  isSentenceTtsSkipped
} from '../src/utils/ttsSkip'
import type { BookData } from '../src/global'

const sentences = ['标题。', '脚注。', '正文一。', '正文二。', '代码。', '结尾。']
const bounds = { start: 0, end: sentences.length }
const book: BookData = {
  id: 'tts-skip-book',
  title: '跳过测试',
  author: '测试作者',
  filePath: 'tts-skip.md',
  format: 'md',
  sentences,
  chapters: [{ title: '第一章', startIndex: 0, sentenceCount: sentences.length }],
  currentChapterIndex: 0,
  currentSentenceIndex: 0,
  progressPercent: 0,
  isCompleted: false,
  addedAt: '2026-07-26T00:00:00.000Z',
  lastReadAt: '2026-07-26T00:00:00.000Z',
  structure: [
    {
      title: '第一章',
      level: 1,
      sentenceRange: [0, sentences.length],
      blocks: [
        { blockId: 'h', type: 'heading', text: sentences[0], ttsSkip: false, sentenceRange: [0, 1] },
        { blockId: 'f', type: 'footnote', text: sentences[1], ttsSkip: true, sentenceRange: [1, 2] },
        { blockId: 'p', type: 'paragraph', text: sentences.slice(2, 4).join(''), ttsSkip: false, sentenceRange: [2, 4] },
        { blockId: 'c', type: 'code', text: sentences[4], ttsSkip: true, sentenceRange: [4, 5] },
        { blockId: 'e', type: 'paragraph', text: sentences[5], ttsSkip: false, sentenceRange: [5, 6] }
      ]
    }
  ]
}

console.log('\nTTS skip')

assert.equal(isSentenceTtsSkipped(book, 1), true)
assert.equal(isSentenceTtsSkipped(book, 2), false)
assert.equal(isSentenceTtsSkipped({ ...book, structure: undefined }, 1), false)
console.log('  ok detects skipped ranges and legacy books')

assert.equal(findNextPlayableSentence(sentences, book, 1, bounds), 2)
assert.equal(findPreviousPlayableSentence(sentences, book, 4, bounds), 3)
console.log('  ok moves forward and backward across skipped sentences')

const allSkipped: BookData = {
  ...book,
  structure: [
    {
      title: '全部跳过',
      level: 1,
      sentenceRange: [0, sentences.length],
      blocks: [
        {
          blockId: 'all',
          type: 'code',
          text: sentences.join(''),
          ttsSkip: true,
          sentenceRange: [0, sentences.length]
        }
      ]
    }
  ]
}
assert.equal(findNextPlayableSentence(sentences, allSkipped, 0, bounds), bounds.end)
assert.equal(findPreviousPlayableSentence(sentences, allSkipped, bounds.end - 1, bounds), bounds.start - 1)
console.log('  ok reports exhausted bounds when every sentence is skipped')

assert.deepEqual(getPlayablePrefetchIndices(sentences, book, 0, bounds, 5), [2, 3, 5])
assert.deepEqual(getPlayablePrefetchIndices(['正文。', '  ', '结尾。'], undefined, 0, { start: 0, end: 3 }, 5), [2])
console.log('  ok filters skipped and empty sentences from prefetch candidates')

console.log('TTS skip result: 4 passed')
