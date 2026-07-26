import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  calculateMinimumSections,
  OutlineGenerator,
  isShortChapter,
  parseOutlineSections,
  validateOutlineSections
} from '../electron/services/ai/outline-generator'

assert.equal(isShortChapter(0), true)
assert.equal(isShortChapter(10), true)
assert.equal(isShortChapter(11), false)
assert.equal(calculateMinimumSections(11), 2)
assert.equal(calculateMinimumSections(80), 2)
assert.equal(calculateMinimumSections(81), 3)
assert.equal(calculateMinimumSections(480), 12)
assert.equal(calculateMinimumSections(2000), 12)

assert.deepEqual(parseOutlineSections('[{"title":"总论","startOffset":0,"point":"核心观点"}]'), [
  { title: '总论', startOffset: 0, point: '核心观点' }
])
assert.deepEqual(parseOutlineSections('[{"title":"坏偏移","startOffset":-2}]'), [
  { title: '坏偏移', startOffset: -2, point: undefined }
])

assert.equal(validateOutlineSections([{ title: '总论', startOffset: 0 }], 20).valid, true)
assert.equal(validateOutlineSections([
  { title: '一', startOffset: 0 },
  { title: '二', startOffset: 10 }
], 20).valid, true)
assert.equal(validateOutlineSections([{ title: '越界', startOffset: 20 }], 20).valid, false)
assert.equal(validateOutlineSections([
  { title: '一', startOffset: 0 },
  { title: '二', startOffset: 0 }
], 20).valid, false)
assert.equal(validateOutlineSections(Array.from({ length: 17 }, (_, index) => ({
  title: String(index),
  startOffset: index
})), 20).valid, false)

void (async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ting-ear-outline-generator-'))
  try {
  let settingsCalls = 0
  const generator = new OutlineGenerator({
    getSettings: () => {
      settingsCalls++
      throw new Error('short chapter must not request settings')
    },
    getDataDir: () => dataDir
  })
  const shortResult = await generator.generateChapter(
    'book-short',
    Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 句`),
    [{ title: '短章', startIndex: 0, sentenceCount: 10 }],
    0
  )
  assert.equal(shortResult.sections.length, 1)
  assert.equal(settingsCalls, 0)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
  console.log('Outline generator result: rules and validation passed')
})()
