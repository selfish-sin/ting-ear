import assert from 'node:assert/strict'
import { buildSourceRefs, buildRetrievalQuery, parseSourceMetadata } from '../electron/services/ai/ai-service'
import type { NmemMemory } from '../electron/services/ai/nmem-bridge'
import type { AiChatPayload } from '../src/global'

console.log('\nsource filter (no spoiler)')

assert.deepEqual(parseSourceMetadata('[bookId=book-1][ch=2] 第三章'), {
  bookId: 'book-1',
  chapterIndex: 2,
  chapterTitle: '第三章'
})
assert.deepEqual(parseSourceMetadata('[bookId=book-1] 测试之书'), {
  bookId: 'book-1',
  chapterIndex: -1,
  chapterTitle: '测试之书'
})

const memories: NmemMemory[] = [
  { id: 'm0', content: '第一章内容', source: '[bookId=book-1][ch=0] 第一章', score: 0.9 },
  { id: 'm2', content: '第三章内容', source: '[bookId=book-1][ch=2] 第三章', score: 0.8 },
  { id: 'm3', content: '第四章内容', source: '[bookId=book-1][ch=3] 第四章', score: 0.7 },
  { id: 'whole', content: '整本检索片段', source: '[bookId=book-1] 测试之书', score: 0.85 },
  { id: 'other', content: '另一本书', source: '[bookId=book-2][ch=0] 第一章', score: 0.6 },
  { id: 'legacy', content: '无法核验', source: '旧来源', score: 0.5 }
]

// 无防剧透：所有本书章节 + 整本源都返回（不排除后续章节）
const all = buildSourceRefs(memories, {
  bookId: 'book-1',
  currentChapterIndex: 2
})
assert.deepEqual(all.map((s) => s.memoryId), ['m0', 'm2', 'm3', 'whole'])
assert.deepEqual(all.map((s) => s.index), [1, 2, 3, 4])
console.log('  ok returns all chapters of the same book without spoiler filtering')

// chapter 分类：当前章 + 整本源（MDM 整本分块仍可用于章级问题）
const currentChapterOnly = buildSourceRefs(memories, {
  bookId: 'book-1',
  currentChapterIndex: 2,
  category: 'chapter'
})
assert.deepEqual(currentChapterOnly.map((s) => s.memoryId), ['m2', 'whole'])
console.log('  ok limits chapter questions to the current chapter (plus whole-book source)')

// 排除其他书和无法解析的来源
assert.equal(all.some((s) => s.memoryId === 'other'), false)
assert.equal(all.some((s) => s.memoryId === 'legacy'), false)
console.log('  ok excludes other books and unverifiable sources')

// === buildRetrievalQuery ===
console.log('\nretrieval query composition')

const basicPayload: AiChatPayload = {
  bookId: 'b1',
  bookTitle: '测试',
  messages: [{ role: 'user', content: '辩证法是什么' }]
}
assert.equal(buildRetrievalQuery(basicPayload), '辩证法是什么')
console.log('  ok uses user question alone')

const contextPayload: AiChatPayload = {
  ...basicPayload,
  autoContext: '书籍：测试\n章节：第二章\n当前句：世界是物质的'
}
const contextQuery = buildRetrievalQuery(contextPayload)
assert.ok(contextQuery.includes('辩证法是什么'))
assert.ok(contextQuery.includes('第二章'))
assert.ok(contextQuery.includes('世界是物质的'))
console.log('  ok combines question + chapter title + current sentence')

const quotePayload: AiChatPayload = {
  ...basicPayload,
  quotes: ['选中的文本片段']
}
const quoteQuery = buildRetrievalQuery(quotePayload)
assert.ok(quoteQuery.includes('辩证法是什么'))
assert.ok(quoteQuery.includes('选中的文本片段'))
console.log('  ok includes selected quotes')

const fullPayload: AiChatPayload = {
  ...contextPayload,
  quotes: ['选中内容']
}
const fullQuery = buildRetrievalQuery(fullPayload)
assert.ok(fullQuery.includes('辩证法是什么'))
assert.ok(fullQuery.includes('选中内容'))
assert.ok(fullQuery.includes('第二章'))
assert.ok(fullQuery.includes('世界是物质的'))
console.log('  ok combines all four signals')

console.log('source filter + retrieval query result: 7 passed')
