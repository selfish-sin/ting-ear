import { strict as assert } from 'assert'
import { normalizeBookData } from '../src/utils/bookData'
import { hashSentences } from '../src/utils/contentHash'
import type { BookData } from '../src/global'

// 模拟一本书有 structure，然后 sentences 被 editHistory 修改后 structure 自动失效

const originalSentences = ['第一句话。', '第二句话。', '第三句话。']
const hash = hashSentences(originalSentences)

const bookWithStructure = {
  id: 'test-book',
  title: '测试书',
  author: '作者',
  filePath: '/test.md',
  format: 'md',
  sentences: originalSentences,
  chapters: [{ title: '全文', startIndex: 0, sentenceCount: 3 }],
  currentChapterIndex: 0,
  currentSentenceIndex: 0,
  progressPercent: 0,
  isCompleted: false,
  addedAt: '2026-01-01T00:00:00Z',
  lastReadAt: '2026-01-01T00:00:00Z',
  structure: [
    {
      title: '全文',
      level: 1,
      blocks: [
        { blockId: 'b1', type: 'paragraph', text: '第一句话。 第二句话。 第三句话。', ttsSkip: false, sentenceRange: [0, 3] }
      ],
      sentenceRange: [0, 3]
    }
  ],
  structureMeta: { schemaVersion: 1, contentHash: hash, sourceFormat: 'md' }
}

// 1. 正常情况：hash 匹配，structure 保留
const normalized = normalizeBookData(bookWithStructure)
assert(normalized !== null, 'Should normalize successfully')
assert(normalized!.structure !== undefined, 'Structure should be preserved when hash matches')
assert(normalized!.structureMeta !== undefined, 'StructureMeta should be preserved')
assert.equal(normalized!.structureMeta!.contentHash, hash)
console.log('✓ hash 匹配时 structure 保留')

// 2. sentences 变了（模拟清洗/版本切换）：hash 不匹配，structure 失效
const modifiedBook = {
  ...bookWithStructure,
  sentences: ['完全不同的句子。', '另一句。']
}
const normalizedModified = normalizeBookData(modifiedBook)
assert(normalizedModified !== null)
assert.equal(normalizedModified!.structure, undefined, 'Structure should be invalidated when hash mismatches')
assert.equal(normalizedModified!.structureMeta, undefined, 'StructureMeta should be invalidated')
console.log('✓ hash 不匹配时 structure 自动失效')

// 3. 无 structure 的旧书：normalize 后仍然无 structure（不报错）
const oldBook = {
  id: 'old-book',
  title: '旧书',
  author: '作者',
  filePath: '/old.txt',
  format: 'txt',
  sentences: ['一些文字。'],
  chapters: [{ title: '全文', startIndex: 0, sentenceCount: 1 }],
  currentChapterIndex: 0,
  currentSentenceIndex: 0,
  progressPercent: 0,
  isCompleted: false,
  addedAt: '2025-01-01T00:00:00Z',
  lastReadAt: '2025-01-01T00:00:00Z'
}
const normalizedOld = normalizeBookData(oldBook)
assert(normalizedOld !== null)
assert.equal(normalizedOld!.structure, undefined, 'Old book without structure stays without')
console.log('✓ 旧书无 structure 不报错')

console.log('\n✅ structureVersionMismatch 全部测试通过')
