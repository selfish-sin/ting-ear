import assert from 'node:assert/strict'
import {
  BOOK_TITLE_MAX_LENGTH,
  MIN_READABLE_SENTENCE_LENGTH,
  clampSentenceIndex,
  normalizeBookData,
  normalizeBookTitle,
  normalizeChapters,
  normalizeSentenceRange,
  splitReadableSentences
} from '../src/utils/bookData'

let passed = 0

function test(name: string, run: () => void): void {
  run()
  passed++
  console.log(`  ok ${name}`)
}

console.log('\nBook data normalization')

test('filters unreadable fragments and joins short natural sentences', () => {
  assert.deepEqual(splitReadableSentences('第一句。\n；\n\x82第二句？\n——'), ['第一句。第二句？'])
})

test('fills forward to 20 readable characters and stops at the threshold', () => {
  const first = '甲'.repeat(8) + '。'
  const second = '乙'.repeat(12) + '！'
  const exact = '丙'.repeat(MIN_READABLE_SENTENCE_LENGTH) + '？'
  const over = '丁'.repeat(MIN_READABLE_SENTENCE_LENGTH + 1) + '。'
  const trailing = '尾声。'

  assert.deepEqual(splitReadableSentences(first + second + exact + over + trailing), [
    first + second,
    exact,
    over,
    trailing
  ])
})

test('handles mixed punctuation, decimals, ellipses, quotes, and English spacing', () => {
  const decimalSentence = '版本 v1.2.3 已经正式发布，请不要错误拆分这个版本号。'
  const mixedSentence = 'Dr. Smith arrived!他说：“真的吗？”然后离开。'
  assert.deepEqual(splitReadableSentences(decimalSentence + mixedSentence), [
    decimalSentence,
    mixedSentence
  ])

  assert.deepEqual(
    splitReadableSentences(`${'甲'.repeat(8)}……${'乙'.repeat(12)}；${'丙'.repeat(20)}。`),
    [`${'甲'.repeat(8)}……${'乙'.repeat(12)}；`, `${'丙'.repeat(20)}。`]
  )
  assert.deepEqual(splitReadableSentences('Hello world.\nThis is next.'), [
    'Hello world. This is next.'
  ])

  assert.deepEqual(
    splitReadableSentences(
      'After a sufficiently long introduction Dr. Smith arrived. Next sentence has enough letters.'
    ),
    [
      'After a sufficiently long introduction Dr. Smith arrived.',
      'Next sentence has enough letters.'
    ]
  )
})

test('repairs malformed chapters into a contiguous in-bounds partition', () => {
  assert.deepEqual(
    normalizeChapters(
      [
        { title: '后半', startIndex: 3, sentenceCount: 99 },
        { title: '越界', startIndex: 20, sentenceCount: 2 },
        { title: '重复', startIndex: 3, sentenceCount: 1 }
      ],
      5
    ),
    [
      { title: '正文', startIndex: 0, sentenceCount: 3 },
      { title: '后半', startIndex: 3, sentenceCount: 2 }
    ]
  )
})

test('normalizes legacy book content and clamps persisted progress', () => {
  const book = normalizeBookData({
    id: 'book-1',
    title: '  测试文章  ',
    author: '',
    filePath: 'book.txt',
    format: 'TXT',
    sentences: ['正文。', '；', '\x82', '结尾。'],
    chapters: [{ title: '坏章节', startIndex: -3, sentenceCount: 99 }],
    currentSentenceIndex: 999,
    currentChapterIndex: 999,
    progressPercent: 120,
    isCompleted: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastReadAt: '2026-01-01T00:00:00.000Z',
    editHistory: [
      {
        id: 'edit-1',
        type: 'manual',
        label: '手动',
        timestamp: '2026-01-01T00:00:00.000Z',
        sentenceCount: 2,
        sentences: ['有效。', '——']
      }
    ]
  })

  assert.ok(book)
  assert.equal(book.title, '测试文章')
  assert.deepEqual(book.sentences, ['正文。', '结尾。'])
  assert.deepEqual(book.chapters, [{ title: '全文', startIndex: 0, sentenceCount: 2 }])
  assert.equal(book.currentSentenceIndex, 1)
  assert.equal(book.currentChapterIndex, 0)
  assert.equal(book.progressPercent, 100)
  assert.equal(book.editHistory?.[0].sentenceCount, 1)
})

test('clamps ranges and indices to the selected reading window', () => {
  const range = normalizeSentenceRange({ start: -5, end: 99 }, 8)
  assert.equal(range, null)
  assert.equal(clampSentenceIndex(99, 8, { start: 2, end: 5 }), 4)
  assert.equal(clampSentenceIndex(-1, 8, { start: 2, end: 5 }), 2)
})

test('validates user titles without silently truncating rename input', () => {
  assert.equal(normalizeBookTitle('  新标题  '), '新标题')
  assert.equal(normalizeBookTitle('   '), null)
  assert.equal(normalizeBookTitle('长'.repeat(BOOK_TITLE_MAX_LENGTH + 1)), null)
})

test('trusted path keeps structure without rehashing and skips pseudo rebuild', () => {
  const sentences = Array.from({ length: 200 }, (_, i) => `句子${i}。内容足够长通过校验。`)
  const chapters = [
    { title: '第一章', startIndex: 0, sentenceCount: 100 },
    { title: '第二章', startIndex: 100, sentenceCount: 100 }
  ]
  const structure = chapters.map((c) => ({
    title: c.title,
    level: 1,
    blocks: [
      {
        blockId: `b-${c.startIndex}`,
        type: 'paragraph' as const,
        text: sentences[c.startIndex],
        ttsSkip: false,
        sentenceRange: [c.startIndex, c.startIndex + c.sentenceCount] as [number, number]
      }
    ],
    sentenceRange: [c.startIndex, c.startIndex + c.sentenceCount] as [number, number]
  }))
  // 故意错误的 hash：trusted 仍应接受形状合法的 structure
  const book = normalizeBookData(
    {
      id: 'trusted-1',
      title: '大书',
      author: '作者',
      filePath: 'a.txt',
      format: 'txt',
      sentences,
      chapters,
      currentSentenceIndex: 0,
      currentChapterIndex: 0,
      progressPercent: 0,
      isCompleted: false,
      addedAt: '2026-01-01T00:00:00.000Z',
      lastReadAt: '2026-01-01T00:00:00.000Z',
      structure,
      structureMeta: {
        schemaVersion: 1 as const,
        contentHash: 'deadbeefdeadbeef',
        sourceFormat: 'txt'
      }
    },
    { trusted: true, contentHash: 'deadbeefdeadbeef' }
  )
  assert.ok(book)
  assert.equal(book.sentences.length, 200)
  assert.equal(book.structure?.length, 2)
  assert.equal(book.structureMeta?.contentHash, 'deadbeefdeadbeef')
  // 二次 normalize 应命中缓存（同一对象）
  const again = normalizeBookData(book, { trusted: true })
  assert.equal(again, book)
})

console.log(`Book data result: ${passed} passed`)
