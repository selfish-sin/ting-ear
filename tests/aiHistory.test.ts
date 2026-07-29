import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonAiHistoryRepository } from '../electron/services/ai/ai-history'

console.log('\nAI history')

const testDir = mkdtempSync(join(tmpdir(), 'ting-ear-ai-history-'))

function flush(history: JsonAiHistoryRepository): void {
  history.flushSync()
}

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
  flush(history)

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
  flush(reloaded)
  assert.deepEqual(reloaded.load('book-a'), [])
  assert.equal(reloaded.load('book-b').length, 1)
  console.log('  ok clears only the requested book')

  // 多会话：写入会话 B 不应覆盖会话 A
  const multi = new JsonAiHistoryRepository(testDir)
  const convA = multi.createConversation('book-multi', '会话A')
  multi.saveConversation('book-multi', convA.id, [
    { id: 'u1', role: 'user', content: 'A-问' },
    { id: 'a1', role: 'assistant', content: 'A-答' }
  ])
  const convB = multi.createConversation('book-multi', '会话B')
  multi.saveConversation('book-multi', convB.id, [
    { id: 'u2', role: 'user', content: 'B-问' },
    { id: 'a2', role: 'assistant', content: 'B-答' }
  ])
  assert.equal(multi.loadConversation('book-multi', convA.id).at(-1)?.content, 'A-答')
  assert.equal(multi.loadConversation('book-multi', convB.id).at(-1)?.content, 'B-答')
  // save 带 conversationId 写到指定会话
  multi.save(
    'book-multi',
    [
      { id: 'u2', role: 'user', content: 'B-问' },
      { id: 'a2', role: 'assistant', content: 'B-答' },
      { id: 'u3', role: 'user', content: 'B-追问' },
      { id: 'a3', role: 'assistant', content: 'B-追答' }
    ],
    convB.id
  )
  assert.equal(multi.loadConversation('book-multi', convA.id).length, 2)
  assert.equal(multi.loadConversation('book-multi', convB.id).at(-1)?.content, 'B-追答')
  assert.equal(multi.renameConversation('book-multi', convA.id, '重命名A'), true)
  assert.equal(
    multi.listConversations('book-multi').conversations.find((c) => c.id === convA.id)?.title,
    '重命名A'
  )
  multi.setActiveConversation('book-multi', convA.id)
  assert.equal(multi.listConversations('book-multi').activeId, convA.id)
  assert.equal(multi.load('book-multi').at(-1)?.content, 'A-答')
  flush(multi)
  console.log('  ok multi-conversation save/load/rename/active without cross-talk')

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

  // V2 数组格式迁移
  writeFileSync(
    historyPath,
    JSON.stringify({
      'book-v2': [
        {
          id: 'c1',
          title: '旧会话',
          createdAt: '2020-01-01T00:00:00.000Z',
          messages: [{ role: 'user', content: '旧问题' }]
        }
      ]
    }),
    'utf8'
  )
  const migrated = new JsonAiHistoryRepository(testDir)
  assert.equal(migrated.load('book-v2')[0]?.content, '旧问题')
  assert.equal(migrated.listConversations('book-v2').activeId, 'c1')
  console.log('  ok migrates V2 conversation arrays to V3 book state')

  console.log('AI history result: 8 passed')
} finally {
  rmSync(testDir, { recursive: true, force: true })
}
