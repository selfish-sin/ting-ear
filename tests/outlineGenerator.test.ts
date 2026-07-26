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

// 截断 JSON：末尾对象写到一半，仍应抢救前面的完整条目
const truncated = `[
  {
    "title": "未实现的革命背景",
    "startOffset": 0,
    "point": "经济动荡通常伴随社会动荡。"
  },
  {
    "title": "大众社会的形成",
    "startOffset": 13,
    "point": "统治精英认识到必须让广大劳动阶层参与政治进程。"
  },
  {
    "title": "大萧条的开始",
    "startOffset": 26,
    "point": 
`
const salvaged = parseOutlineSections(truncated)
assert.equal(salvaged.length, 2)
assert.equal(salvaged[0].title, '未实现的革命背景')
assert.equal(salvaged[1].startOffset, 13)

// 无闭合 ] 的截断数组
const noClose = `[{"title":"一","startOffset":0,"point":"A"},{"title":"二","startOffset":10,"point":"B"},{"title":"三","startOffset":20,"poi`
const salvaged2 = parseOutlineSections(noClose)
assert.equal(salvaged2.length, 2)
assert.equal(salvaged2[1].title, '二')

// 真实截断形态：最后对象写到 "p
const realTruncated = `[
  {
    "title": "未实现的革命与大众社会",
    "startOffset": 0,
    "point": "经济危机未引发世界革命。"
  },
  {
    "title": "美国大萧条的严重性",
    "startOffset": 26,
    "point": "大萧条导致美国经济崩溃。"
  },
  {
    "title": "胡佛政府的应对与民众反抗",
    "startOffset": 96,
    "point": "胡佛坚持自由主义原则。"
  },
  {
    "title": "罗斯福的崛起与新政",
    "startOffset": 139,
    "p
`
const salvaged3 = parseOutlineSections(realTruncated)
assert.equal(salvaged3.length, 3)
assert.equal(salvaged3[2].title, '胡佛政府的应对与民众反抗')

assert.equal(validateOutlineSections([{ title: '总论', startOffset: 0 }], 20).valid, true)
assert.equal(validateOutlineSections([
  { title: '一', startOffset: 0 },
  { title: '二', startOffset: 10 }
], 20).valid, true)
// 越界 offset 会被自动 clamp，修正后仍有效
assert.equal(validateOutlineSections([{ title: '越界', startOffset: 20 }], 20).valid, true)
// 重复 offset 去重后只剩一节，仍有效
assert.equal(validateOutlineSections([
  { title: '一', startOffset: 0 },
  { title: '二', startOffset: 0 }
], 20).valid, true)
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
