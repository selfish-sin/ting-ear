import assert from 'node:assert/strict'
import { chapterDisplayTitle, chapterKey, normalizeChapters } from '../src/utils/bookData'
import { hashSentences } from '../src/utils/contentHash'

const chapters = normalizeChapters([
  { title: '原章节名', originalTitle: '原章节名', customTitle: '我的章节名', startIndex: 0 }
], 20)
assert.equal(chapters[0].title, '我的章节名')
assert.equal(chapters[0].originalTitle, '原章节名')
assert.equal(chapterDisplayTitle(chapters[0]), '我的章节名')
assert.equal(chapterKey(chapters[0], 0), '0:0:20')
assert.equal(hashSentences(['句子一', '句子二']), hashSentences(['句子一', '句子二']))
assert.equal(hashSentences(['句子一', '句子二']), hashSentences(['句子一', '句子二']))
console.log('Chapter title result: custom title and stable key passed')
