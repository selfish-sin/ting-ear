import assert from 'node:assert/strict'
import {
  buildSkeletonStructure,
  healBookLayoutForReading,
  isUnhealthyBookLayout,
  OVERSIZED_CHAPTER_SENTENCES
} from '../src/utils/bookData'
import { buildChaptersByMode } from '../src/utils/chapterBuilder'
import type { BookData, StructuredChapter } from '../src/global'

function makeBook(overrides: Partial<BookData> & { sentenceCount: number }): BookData {
  const n = overrides.sentenceCount
  const sentences = Array.from({ length: n }, (_, i) => `句子${i + 1}。`)
  const chapters = overrides.chapters || [
    { title: '正文', startIndex: 0, sentenceCount: n }
  ]
  return {
    id: 'test-book',
    title: '测试文集',
    author: '测',
    filePath: '/tmp/x.md',
    format: 'md',
    sentences,
    chapters,
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    structure: overrides.structure,
    structureMeta: overrides.structureMeta,
    ...overrides,
    sentences,
    chapters
  }
}

console.log('\nhealBookLayoutForReading')

{
  const total = OVERSIZED_CHAPTER_SENTENCES * 5 + 50 // 2050+
  const blocks: StructuredChapter['blocks'] = []
  for (let i = 0; i < total; i++) {
    blocks.push({
      blockId: `b${i}`,
      type: 'paragraph',
      text: `句子${i + 1}。`,
      ttsSkip: false,
      sentenceRange: [i, i + 1]
    })
  }
  const book = makeBook({
    sentenceCount: total,
    chapters: [{ title: '正文', startIndex: 0, sentenceCount: total }],
    structure: [
      {
        title: '正文',
        level: 1,
        blocks,
        sentenceRange: [0, total]
      }
    ],
    structureMeta: {
      schemaVersion: 1,
      contentHash: 'deadbeefdeadbeef',
      sourceFormat: 'md'
    }
  })

  const { book: healed, changed } = healBookLayoutForReading(book)
  assert.equal(changed, true, 'should heal oversized single-chapter book')
  assert.ok(
    healed.chapters.length > 1,
    `expected multiple chapters, got ${healed.chapters.length}`
  )
  assert.ok(
    healed.chapters.every((c) => c.sentenceCount <= OVERSIZED_CHAPTER_SENTENCES),
    'no chapter should exceed max'
  )
  const covered = healed.chapters.reduce((s, c) => s + c.sentenceCount, 0)
  assert.equal(covered, total)
  assert.equal(healed.structure?.length, healed.chapters.length)
  assert.ok(
    healed.structure?.every((ch) => (ch.blocks?.length || 0) === 0),
    'healed structure should be skeleton (empty blocks)'
  )
  console.log('  ok single-blob mega book → split + skeleton')
}

{
  const chapters = buildChaptersByMode(800, [], 'original').map((c) => ({
    title: c.title,
    startIndex: c.startIndex,
    sentenceCount: c.sentenceCount
  }))
  const book = makeBook({
    sentenceCount: 800,
    chapters,
    structure: buildSkeletonStructure(chapters),
    structureMeta: {
      schemaVersion: 1,
      contentHash: 'aaaaaaaaaaaaaaaa',
      sourceFormat: 'pseudo-skeleton'
    }
  })
  const { changed } = healBookLayoutForReading(book)
  assert.equal(changed, false, 'already healthy layout should not change')
  console.log('  ok healthy book is no-op')
}

{
  const skeleton = buildSkeletonStructure([
    { title: 'A', startIndex: 0, sentenceCount: 10 },
    { title: 'B', startIndex: 10, sentenceCount: 20 }
  ])
  assert.equal(skeleton.length, 2)
  assert.deepEqual(skeleton[0].blocks, [])
  assert.deepEqual(skeleton[0].sentenceRange, [0, 10])
  assert.deepEqual(skeleton[1].sentenceRange, [10, 30])
  console.log('  ok buildSkeletonStructure')
}

{
  // 单章但标题是书名（不是「正文」）——以前 looksLikeBlob 正则会漏，hasOversized 必须兜住
  const total = OVERSIZED_CHAPTER_SENTENCES * 3
  const book = makeBook({
    sentenceCount: total,
    chapters: [{ title: '某位作者文集', startIndex: 0, sentenceCount: total }]
  })
  assert.equal(isUnhealthyBookLayout(book), true)
  const { book: healed, changed } = healBookLayoutForReading(book)
  assert.equal(changed, true)
  assert.ok(healed.chapters.length > 1)
  assert.ok(healed.chapters.every((c) => c.sentenceCount <= OVERSIZED_CHAPTER_SENTENCES))
  console.log('  ok single-chapter with custom title still heals')
}

console.log('\nhealBookLayout tests passed')
