import assert from 'node:assert/strict'
import { AI_DEFAULTS, mergeAiSettings } from '../electron/services/ai/ai-config'

console.log('\nAI settings')

const merged = mergeAiSettings({
  llm: { apiKey: 'secret', model: 'custom-model' },
  chat: { systemPrompt: '只回答当前问题' }
})

assert.equal(merged.llm.apiKey, 'secret')
assert.equal(merged.llm.model, 'custom-model')
assert.equal(merged.llm.baseUrl, AI_DEFAULTS.llm.baseUrl)
assert.equal(merged.nmem.baseUrl, 'http://127.0.0.1:14242')
assert.equal(merged.chat.systemPrompt, '只回答当前问题')
assert.equal(merged.chat.maxHistoryMessages, AI_DEFAULTS.chat.maxHistoryMessages)
assert.equal(typeof merged.chat.evidencePrompt, 'string')
assert.equal(typeof merged.chat.readerContextPrompt, 'string')
assert.equal(typeof merged.chat.selectionPrompt, 'string')
assert.deepEqual(merged.chat.chapterPatterns, AI_DEFAULTS.chat.chapterPatterns)
assert.deepEqual(merged.chat.bookWidePatterns, AI_DEFAULTS.chat.bookWidePatterns)
assert.ok(merged.chat.chapterPatterns.length > 0)
assert.ok(merged.chat.bookWidePatterns.length > 0)
assert.deepEqual(merged.retrieval, AI_DEFAULTS.retrieval)
assert.deepEqual(merged.nmem, AI_DEFAULTS.nmem)
assert.equal(
  (merged.retrieval as unknown as { maxContextChars?: number }).maxContextChars,
  12000
)

const customRoutes = mergeAiSettings({
  chat: { chapterPatterns: ['^仅本章$'], bookWidePatterns: ['^仅全书$'] }
})
assert.deepEqual(customRoutes.chat.chapterPatterns, ['^仅本章$'])
assert.deepEqual(customRoutes.chat.bookWidePatterns, ['^仅全书$'])

const emptyRoutes = mergeAiSettings({
  chat: { greetingPatterns: [], chapterPatterns: [], bookWidePatterns: [] }
})
assert.deepEqual(emptyRoutes.chat.greetingPatterns, [])
assert.deepEqual(emptyRoutes.chat.chapterPatterns, [])
assert.deepEqual(emptyRoutes.chat.bookWidePatterns, [])

const customPrompts = mergeAiSettings({
  chat: {
    evidencePrompt: '自定义证据提示',
    readerContextPrompt: '自定义阅读上下文提示',
    selectionPrompt: '自定义选区提示'
  }
})
assert.equal(customPrompts.chat.evidencePrompt, '自定义证据提示')
assert.equal(customPrompts.chat.readerContextPrompt, '自定义阅读上下文提示')
assert.equal(customPrompts.chat.selectionPrompt, '自定义选区提示')

console.log('  ok deeply merges partial AI settings')
console.log('AI settings result: 1 passed')
