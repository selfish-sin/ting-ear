import assert from 'node:assert/strict'
import {
  buildChaptersByMode,
  buildPartSuffix,
  chaptersToBoundaries,
  toChineseNumber
} from '../src/utils/chapterBuilder'

let passed = 0
function test(name: string, run: () => void): void {
  run()
  passed++
  console.log(`  ok ${name}`)
}

console.log('\nChapter builder modes')

test('toChineseNumber and part suffix', () => {
  assert.equal(toChineseNumber(1), '一')
  assert.equal(toChineseNumber(12), '十二')
  assert.equal(buildPartSuffix(2), '（第二部分）')
})

test('original keeps small bookmark chapters and splits oversized with 第N部分', () => {
  const boundaries = [
    { title: '序', sentenceIndex: 0 },
    { title: '第一章', sentenceIndex: 5 }, // 5 句小章
    { title: '巨章', sentenceIndex: 10 }
  ]
  // total 900 sentences → 巨章 from 10 to 900 = 890 sentences → multiple parts
  const chapters = buildChaptersByMode(900, boundaries, 'original')
  assert.ok(chapters.length >= 3, `expected >=3 chapters, got ${chapters.length}`)
  // small chapter preserved (min=1)
  const ch1 = chapters.find((c) => c.title === '第一章')
  assert.ok(ch1, '第一章 should remain as its own chapter in original mode')
  assert.equal(ch1!.sentenceCount, 5)
  // oversized parts use 第N部分
  const parts = chapters.filter((c) => c.title.includes('巨章'))
  assert.ok(parts.length >= 2, '巨章 should split')
  assert.ok(parts.every((p) => /第.+部分/.test(p.title)), 'parts should use 第N部分 suffix')
  const totalCovered = chapters.reduce((s, c) => s + c.sentenceCount, 0)
  assert.equal(totalCovered, 900)
  assert.equal(chapters[0].startIndex, 0)
})

test('merged merges undersized chapters (min 35)', () => {
  const boundaries = [
    { title: 'A', sentenceIndex: 0 },
    { title: 'B', sentenceIndex: 10 },
    { title: 'C', sentenceIndex: 20 },
    { title: 'D', sentenceIndex: 80 }
  ]
  const original = buildChaptersByMode(120, boundaries, 'original')
  const merged = buildChaptersByMode(120, boundaries, 'merged')
  assert.ok(original.length > merged.length, 'merged should reduce tiny chapters')
  assert.ok(
    merged.every((c) => c.sentenceCount >= 35 || merged.length === 1),
    'merged chapters should be >=35 (except single-blob)'
  )
})

test('chaptersToBoundaries roundtrip inputs', () => {
  const chapters = [
    { title: '一', startIndex: 0, sentenceCount: 10 },
    { title: '二', startIndex: 10, sentenceCount: 20 }
  ]
  const b = chaptersToBoundaries(chapters)
  assert.deepEqual(b, [
    { title: '一', sentenceIndex: 0 },
    { title: '二', sentenceIndex: 10 }
  ])
})

console.log(`\n${passed} tests passed`)
