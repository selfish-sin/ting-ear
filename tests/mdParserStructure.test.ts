import { strict as assert } from 'node:assert'
import { parseMarkdownToStructure } from '../electron/services/parsers/mdParser'
import { deriveSentences } from '../electron/services/parsers/structureBuilder'

const fence = String.fromCharCode(96).repeat(3)
const fixture = [
  '# 引言', '', '这是第一段正文。包含多个句子。', '## 方法论', '> 这是一段引用。',
  '- 列表项一', '- 列表项二', fence + 'python', 'print("hello")', fence, '',
  '[^1]: 这是脚注内容。', '### 结论', '', '最后一段文字。'
].join('\n')

const structure = parseMarkdownToStructure(fixture)
const leadingFence = parseMarkdownToStructure([fence + 'ts', 'const answer = 42', fence, '', 'Following paragraph.'].join('\n'))
const unclosedLeadingFence = parseMarkdownToStructure([fence + 'ts', 'const unfinished = true'].join('\n'))

assert.equal(leadingFence[0].blocks[0]?.type, 'code')
assert.equal(leadingFence[0].blocks[0]?.text, 'const answer = 42')
assert.equal(unclosedLeadingFence[0].blocks[0]?.type, 'code')
assert.equal(unclosedLeadingFence[0].blocks[0]?.text, 'const unfinished = true')
console.log('ok preserves leading and unclosed fenced code blocks')

assert.equal(structure.length, 1)
assert.equal(structure[0].title, '引言')
assert.equal(structure[0].level, 1)
assert.equal(structure[0].blocks.filter((block) => block.type === 'heading').length, 3)
assert.ok(structure[0].blocks.some((block) => block.type === 'heading' && block.level === 2))
assert.ok(structure[0].blocks.some((block) => block.type === 'heading' && block.level === 3))
console.log('lower-level Markdown headings remain inside the reading chapter')

const types = structure[0].blocks.map((block) => block.type)
assert(types.includes('heading'))
assert(types.includes('quote'))
assert(types.includes('list'))
assert(types.includes('code'))
assert(types.includes('footnote'))
const footnote = structure[0].blocks.find((block) => block.type === 'footnote')
assert.equal(footnote?.ttsSkip, true)
assert.equal(footnote?.meta?.ref, '1')
const code = structure[0].blocks.find((block) => block.type === 'code')
assert.equal(code?.ttsSkip, true)
console.log('block types, ttsSkip, and footnote metadata remain intact')

const sentences = deriveSentences(structure)
let previousEnd = 0
for (const chapter of structure) {
  assert.equal(chapter.sentenceRange[0], previousEnd)
  for (const block of chapter.blocks) {
    assert.equal(block.sentenceRange[0], previousEnd)
    previousEnd = block.sentenceRange[1]
  }
  assert.equal(chapter.sentenceRange[1], previousEnd)
}
assert.equal(previousEnd, sentences.length)
console.log('sentence ranges remain globally contiguous')
