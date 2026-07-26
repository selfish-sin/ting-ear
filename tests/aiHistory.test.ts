import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonAiHistoryRepository } from '../electron/services/ai/ai-history'

console.log('\nAI history')

const testDir = mkdtempSync(join(tmpdir(), 'ting-ear-ai-history-'))

try {
  const history = new JsonAiHistoryRepository(testDir)
  history.save('book-a', [
    { role: 'user', content: '问题 A' },
    {
      role: 'assistant',
      content: '回答 A [1]',
      sources: [
        {
          index: 1,
          memoryId: 'memory-1',
          content: '可核对的原文',
          source: '[bookId=book-a][ch=0] 第一章',
          score: 0.9,
          bookId: 'book-a',
          chapterIndex: 0,
          chapterTitle: '第一章'
        }
      ],
      retrievalStatus: 'done'
    } as never
  ])
  history.save('book-b', [{ role: 'user', content: '问题 B' }])

  const reloaded = new JsonAiHistoryRepository(testDir)
  const reloadedAnswer = reloaded.load('book-a').at(-1) as unknown as {
    content: string
    sources?: unknown[]
    retrievalStatus?: string
  }
  assert.equal(reloadedAnswer.content, '回答 A [1]')
  assert.equal(reloadedAnswer.sources?.length, 1)
  assert.equal(reloadedAnswer.retrievalStatus, 'done')
  assert.equal(reloaded.load('book-b').at(-1)?.content, '问题 B')
  console.log('  ok persists histories independently per book')

  reloaded.clear('book-a')
  assert.deepEqual(reloaded.load('book-a'), [])
  assert.equal(reloaded.load('book-b').length, 1)
  console.log('  ok clears only the requested book')

  const historyPath = join(testDir, 'ai-history.json')
  const raw = JSON.parse(readFileSync(historyPath, 'utf8')) as Record<string, unknown>
  assert.equal('book-a' in raw, false)
  writeFileSync(historyPath, '{broken', 'utf8')
  assert.throws(
    () => new JsonAiHistoryRepository(testDir).load('book-b'),
    /AI 对话历史文件损坏/
  )
  console.log('  ok reports a corrupted history file without overwriting it as empty history')

  writeFileSync(historyPath, JSON.stringify({ 'book-b': { role: 'user', content: '错误结构' } }), 'utf8')
  assert.throws(
    () => new JsonAiHistoryRepository(testDir).load('book-b'),
    /AI 对话历史文件损坏/
  )
  writeFileSync(historyPath, JSON.stringify({ 'book-b': [{ role: 'user' }] }), 'utf8')
  assert.throws(
    () => new JsonAiHistoryRepository(testDir).load('book-b'),
    /AI 对话历史文件损坏/
  )
  console.log('  ok rejects invalid book entries and malformed messages')

  const validSource = {
    index: 1,
    memoryId: 'memory-1',
    content: 'Source text',
    source: '[bookId=book-b][ch=0] Chapter 1',
    score: 0.8,
    bookId: 'book-b',
    chapterIndex: 0,
    chapterTitle: 'Chapter 1'
  }
  const invalidOptionalFields = [
    { role: 'assistant', content: 'answer', sources: {} },
    {
      role: 'assistant',
      content: 'answer',
      sources: [{ ...validSource, chapterIndex: '0' }]
    },
    { role: 'assistant', content: 'answer', retrievalStatus: 'searching' },
    { role: 'assistant', content: 'answer', retrievalError: 42 }
  ]
  for (const message of invalidOptionalFields) {
    writeFileSync(historyPath, JSON.stringify({ 'book-b': [message] }), 'utf8')
    assert.throws(
      () => new JsonAiHistoryRepository(testDir).load('book-b'),
      /AI 对话历史文件损坏/
    )
  }
  console.log('  ok rejects malformed optional history fields and nested sources')

  console.log('AI history result: 5 passed')
} finally {
  rmSync(testDir, { recursive: true, force: true })
}
