import assert from 'node:assert/strict'
import {
  buildChapterFullText,
  buildReadingFullText,
  shouldInjectFullText,
  mergeAiSettings,
  AI_DEFAULTS
} from '../src/aiSettings'

console.log('\nFull-text inject rules (current chapter only)')

assert.equal(shouldInjectFullText('hello', 50000, false), true)
// 已注入标记不再永久关闭：追问仍可注入，保证多轮有上下文
assert.equal(shouldInjectFullText('hello', 50000, true), true)
assert.equal(shouldInjectFullText('', 50000, false), false)
assert.equal(shouldInjectFullText('a'.repeat(50001), 50000, false), false)
assert.equal(shouldInjectFullText('a'.repeat(50000), 50000, false), true)
console.log('  ok enforces 50k cap; allows re-inject for follow-ups')

// 只取当前章，不是全书
const chapterText = buildChapterFullText(
  ['章一头', '章一尾', '章二头', '章二尾', '章三'],
  { startIndex: 2, sentenceCount: 2 }
)
assert.equal(chapterText, '章二头\n章二尾')
assert.ok(!chapterText.includes('章一'))
assert.ok(!chapterText.includes('章三'))
console.log('  ok builds current-chapter text only')

// 兼容包装：有 chapters 时按当前章
const viaLegacy = buildReadingFullText({
  sentences: ['A0', 'A1', 'B0', 'B1'],
  chapters: [
    { startIndex: 0, sentenceCount: 2 },
    { startIndex: 2, sentenceCount: 2 }
  ],
  currentChapterIndex: 1
})
assert.equal(viaLegacy, 'B0\nB1')
console.log('  ok legacy helper prefers current chapter over whole book')

const merged = mergeAiSettings({
  webSearch: { enabled: true },
  chat: { systemPrompt: 'x' }
})
assert.equal(merged.webSearch.enabled, true)
assert.ok(merged.webSearch.prompt.includes('联网'))
assert.equal(merged.chat.fullTextMaxChars, 15000)
assert.ok(merged.chat.outlineSystemPrompt.includes('简体中文'))
assert.ok(merged.chat.fullTextInjectPrompt.includes('当前章节') || merged.chat.fullTextInjectPrompt.includes('本章'))
assert.equal(AI_DEFAULTS.chat.fullTextMaxChars, 15000)
console.log('  ok merges defaults for chapter inject prompts')

console.log('Full-text inject result: 4 passed')
