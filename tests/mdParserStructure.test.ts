import { strict as assert } from 'assert'
import { parseMarkdownToStructure } from '../electron/services/parsers/mdParser'
import { deriveSentences } from '../electron/services/parsers/structureBuilder'

const fixture = `# 引言

这是第一段正文。包含多个句子。

## 方法论

> 这是一段引用。

- 列表项一
- 列表项二

\`\`\`python
print("hello")
\`\`\`

[^1]: 这是脚注内容。

### 结论

最后一段文字。
`

const structure = parseMarkdownToStructure(fixture)

// 应有 3 个章节（引言、方法论、结论）
assert.equal(structure.length, 3, `Expected 3 chapters, got ${structure.length}`)
assert.equal(structure[0].title, '引言')
assert.equal(structure[0].level, 1)
assert.equal(structure[1].title, '方法论')
assert.equal(structure[1].level, 2)
assert.equal(structure[2].title, '结论')
assert.equal(structure[2].level, 3)
console.log('✓ 章节标题和层级正确')

// 检查 block 类型
const ch1Blocks = structure[1].blocks
const types = ch1Blocks.map(b => b.type)
assert(types.includes('heading'), 'Should have heading block')
assert(types.includes('quote'), 'Should have quote block')
assert(types.includes('list'), 'Should have list block')
assert(types.includes('code'), 'Should have code block')
assert(types.includes('footnote'), 'Should have footnote block')
console.log('✓ Block 类型标注正确')

// ttsSkip 检查
const footnote = ch1Blocks.find(b => b.type === 'footnote')
assert(footnote && footnote.ttsSkip === true, 'Footnote should be ttsSkip')
const code = ch1Blocks.find(b => b.type === 'code')
assert(code && code.ttsSkip === true, 'Code should be ttsSkip')
const para = structure[0].blocks.find(b => b.type === 'paragraph')
assert(para && para.ttsSkip === false, 'Paragraph should not be ttsSkip')
console.log('✓ ttsSkip 标注正确')

// deriveSentences 后 sentenceRange 连续
const sentences = deriveSentences(structure)
assert(sentences.length > 0, 'Should produce sentences')
// 验证全局连续
let prevEnd = 0
for (const ch of structure) {
  assert.equal(ch.sentenceRange[0], prevEnd, `Chapter "${ch.title}" start should be ${prevEnd}`)
  for (const block of ch.blocks) {
    assert.equal(block.sentenceRange[0], prevEnd, `Block ${block.blockId} start should be ${prevEnd}`)
    assert(block.sentenceRange[1] >= block.sentenceRange[0], 'Block end >= start')
    prevEnd = block.sentenceRange[1]
  }
  assert.equal(ch.sentenceRange[1], prevEnd, `Chapter "${ch.title}" end should be ${prevEnd}`)
}
assert.equal(prevEnd, sentences.length, 'Total range should equal sentence count')
console.log('✓ sentenceRange 全局连续无间隙')

// 脚注 meta
assert(footnote && footnote.meta?.ref === '1', 'Footnote meta.ref should be "1"')
console.log('✓ 脚注 meta 正确')

console.log('\n✅ mdParserStructure 全部测试通过')
