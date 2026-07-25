import { strict as assert } from 'assert'
import { deriveSentences, deriveChapters, validateStructure, generatePseudoStructure } from '../electron/services/parsers/structureBuilder'
import { hashSentences } from '../src/utils/contentHash'
import type { StructuredChapter, BookData } from '../src/global'

// === deriveSentences ===
{
  const structure: StructuredChapter[] = [
    {
      title: '第一章',
      level: 1,
      sentenceRange: [0, 0],
      blocks: [
        { blockId: 'b1', type: 'heading', level: 1, text: '第一章', ttsSkip: false, sentenceRange: [0, 0] },
        { blockId: 'b2', type: 'paragraph', text: '这是第一句话。这是第二句话。', ttsSkip: false, sentenceRange: [0, 0] },
        { blockId: 'b3', type: 'footnote', text: '脚注内容。', ttsSkip: true, sentenceRange: [0, 0] }
      ]
    }
  ]
  const sentences = deriveSentences(structure)
  assert(sentences.length >= 2, `Expected >=2 sentences, got ${sentences.length}`)
  // sentenceRange 应被填充
  assert(structure[0].sentenceRange[0] === 0, 'Chapter start should be 0')
  assert(structure[0].sentenceRange[1] === sentences.length, 'Chapter end should equal sentence count')
  // heading block 的 sentenceRange
  assert(structure[0].blocks[0].sentenceRange[0] === 0)
  // paragraph block 紧跟 heading
  assert(structure[0].blocks[1].sentenceRange[0] === structure[0].blocks[0].sentenceRange[1])
  console.log('✓ deriveSentences: sentenceRange 正确填充')
}

// === deriveChapters ===
{
  const structure: StructuredChapter[] = [
    { title: 'A', level: 1, blocks: [], sentenceRange: [0, 10] },
    { title: 'B', level: 1, blocks: [], sentenceRange: [10, 25] }
  ]
  const chapters = deriveChapters(structure)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, 'A')
  assert.equal(chapters[0].startIndex, 0)
  assert.equal(chapters[0].sentenceCount, 10)
  assert.equal(chapters[1].startIndex, 10)
  assert.equal(chapters[1].sentenceCount, 15)
  console.log('✓ deriveChapters: 正确派生')
}

// === validateStructure ===
{
  const sentences = ['句子一。', '句子二。', '句子三。']
  const hash = hashSentences(sentences)
  const book = {
    id: 'test',
    title: 'test',
    author: 'a',
    filePath: '/x.md',
    format: 'md',
    sentences,
    chapters: [{ title: '全文', startIndex: 0, sentenceCount: 3 }],
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: '',
    lastReadAt: '',
    structure: [{ title: '全文', level: 1, blocks: [], sentenceRange: [0, 3] as [number, number] }],
    structureMeta: { schemaVersion: 1 as const, contentHash: hash, sourceFormat: 'md' }
  } as BookData
  assert.equal(validateStructure(book), true, 'Hash match should validate')

  // 修改 sentences 后 hash 不匹配
  book.sentences = ['完全不同的内容。']
  assert.equal(validateStructure(book), false, 'Hash mismatch should invalidate')
  console.log('✓ validateStructure: hash 校验正确')
}

// === generatePseudoStructure ===
{
  const sentences = Array.from({ length: 12 }, (_, i) => `句子${i}。`)
  const chapters = [
    { title: '第一章', startIndex: 0, sentenceCount: 7 },
    { title: '第二章', startIndex: 7, sentenceCount: 5 }
  ]
  const { structure, structureMeta } = generatePseudoStructure(sentences, chapters)
  assert.equal(structure.length, 2)
  assert.equal(structure[0].title, '第一章')
  assert.equal(structure[0].sentenceRange[0], 0)
  assert.equal(structure[0].sentenceRange[1], 7)
  assert.equal(structure[1].sentenceRange[0], 7)
  assert.equal(structure[1].sentenceRange[1], 12)
  assert.equal(structureMeta.sourceFormat, 'pseudo')
  assert.equal(structureMeta.contentHash, hashSentences(sentences))
  // 每 5 句一个 block
  assert.equal(structure[0].blocks.length, 2) // 7 sentences → 5+2
  assert.equal(structure[1].blocks.length, 1) // 5 sentences → 5
  console.log('✓ generatePseudoStructure: 合理分块')
}

console.log('\n✅ structureBuilder 全部测试通过')
