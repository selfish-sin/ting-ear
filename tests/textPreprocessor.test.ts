/**
 * textPreprocessor 单元测试
 * 覆盖全部 5 个处理阶段
 *
 * 运行: npx ts-node tests/textPreprocessor.test.ts
 * 或:  npx tsx tests/textPreprocessor.test.ts
 */
import {
  preprocessText,
  removeCJKSpaceGaps,
  mergeBrokenLines,
  collapseBlankLines,
  removePageArtifacts,
  normalizePunctuation,
  splitSentences
} from '../electron/services/parsers/textPreprocessor'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ✅ ${label}`)
    } else {
      failed++
      console.log(`  ❌ ${label} — assertion returned false`)
    }
  } catch (e) {
    failed++
    console.log(`  ❌ ${label} — threw: ${(e as Error).message}`)
  }
}

// ============================================================
// Stage 1: removeCJKSpaceGaps
// ============================================================
console.log('\n📌 Stage 1 — removeCJKSpaceGaps')

assert('消除中文字间单空格', () => {
  return removeCJKSpaceGaps('这 是 一 本 书') === '这是一本书'
})

assert('保留英文词间空格', () => {
  const result = removeCJKSpaceGaps('Hello world 你好 世界')
  return result === 'Hello world 你好世界'
})

assert('消除中文标点前后的空格', () => {
  const result = removeCJKSpaceGaps('你好 ， 世界')
  return result.includes('你好，世界')
})

// ============================================================
// Stage 2: mergeBrokenLines
// ============================================================
console.log('\n📌 Stage 2 — mergeBrokenLines')

assert('合并 PDF 硬断行', () => {
  const input = '这是第一\n行内容\n这是第二行\n结束。\n新段落开始'
  const result = mergeBrokenLines(input)
  return result.includes('这是第一行内容') // merged
})

assert('句末标点结尾的行不合并', () => {
  const input = '这是第一句。\n这是第二句。'
  const result = mergeBrokenLines(input)
  return result.split('\n').length === 2 // two separate sentences
})

// ============================================================
// Stage 3: collapseBlankLines
// ============================================================
console.log('\n📌 Stage 3 — collapseBlankLines')

assert('3+ 空行压缩为 2 个', () => {
  const input = '段落一\n\n\n\n\n段落二'
  const result = collapseBlankLines(input)
  return result === '段落一\n\n段落二'
})

assert('保留两个空行', () => {
  const input = '段落一\n\n段落二'
  const result = collapseBlankLines(input)
  return result === input // unchanged
})

// ============================================================
// Stage 4: normalizePunctuation
// ============================================================
console.log('\n📌 Stage 4 — normalizePunctuation')

assert('中文后句号半角转全角', () => {
  const result = normalizePunctuation('你好.')
  return result === '你好。'
})

assert('中文后逗号半角转全角', () => {
  const result = normalizePunctuation('苹果,香蕉,橘子')
  return result === '苹果，香蕉，橘子'
})

// ============================================================
// Stage 5: removePageArtifacts
// ============================================================
console.log('\n📌 Stage 5 — removePageArtifacts')

assert('移除页码行', () => {
  const result = removePageArtifacts('第一章\n12\n都是正文')
  return !result.includes('\n12\n') && result.includes('第一章')
})

assert('移除"第X页"模式', () => {
  const result = removePageArtifacts('第 1 页\n正文内容')
  return result === '\n正文内容' || !result.includes('第 1 页')
})

// ============================================================
// 集成: splitSentences
// ============================================================
console.log('\n📌 集成 — splitSentences')

assert('短句按句号识别后补足到同一朗读单元', () => {
  const result = splitSentences('第一句。第二句。第三句。')
  return result.length === 1 && result[0] === '第一句。第二句。第三句。'
})

assert('达到 20 字后不再追加分号后的下一句', () => {
  const first = '甲'.repeat(20) + '；'
  const result = splitSentences(first + '分号后')
  return result.length === 2 && result[0] === first && result[1] === '分号后'
})

assert('空文本返回空数组', () => {
  return splitSentences('').length === 0
})

// ============================================================
// 集成: preprocessText 完整流水线
// ============================================================
console.log('\n📌 集成 — preprocessText 完整流水线')

assert('完整流水线处理中文空格书', () => {
  const input = '第 1 页\n\n这 是 一 本 好 书。今天天气不错,适合看书.'
  const { text } = preprocessText(input)
  return (
    text.includes('这是一本好书。') &&
    text.includes('今天天气不错，适合看书。') &&
    !text.includes('第 1 页')
  )
})

// ============================================================
console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败, ${passed + failed} 总计`)
if (failed > 0) process.exit(1)
