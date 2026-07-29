import assert from 'node:assert/strict'
import { regroupStructuredChapters } from '../electron/services/parsers/structureBuilder'
import { CHAPTER_MAX_SENTENCES } from '../src/utils/chapterBuilder'
import type { StructuredChapter } from '../src/global'

console.log('\nregroupStructuredChapters single-chapter oversized')

{
  const total = CHAPTER_MAX_SENTENCES * 3 + 10
  const blocks = []
  for (let i = 0; i < total; i++) {
    blocks.push({
      blockId: `b${i}`,
      type: 'paragraph' as const,
      text: `s${i}`,
      ttsSkip: false,
      sentenceRange: [i, i + 1] as [number, number]
    })
  }
  const structure: StructuredChapter[] = [
    {
      title: '正文',
      level: 1,
      blocks,
      sentenceRange: [0, total]
    }
  ]

  const { structure: out, chapters } = regroupStructuredChapters(structure, { mode: 'original' })
  assert.ok(chapters.length > 1, `expected split chapters, got ${chapters.length}`)
  assert.equal(out.length, chapters.length)
  assert.ok(
    chapters.every((c) => c.sentenceCount <= CHAPTER_MAX_SENTENCES),
    'each chapter <= max'
  )
  const covered = chapters.reduce((s, c) => s + c.sentenceCount, 0)
  assert.equal(covered, total)
  // blocks redistributed
  const blockTotal = out.reduce((s, ch) => s + ch.blocks.length, 0)
  assert.equal(blockTotal, total)
  console.log(`  ok 1章${total}句 → ${chapters.length}章，blocks 重分配`)
}

{
  // 多章且均未超长：保持
  const structure: StructuredChapter[] = [
    {
      title: '一',
      level: 1,
      blocks: [
        {
          blockId: 'a',
          type: 'paragraph',
          text: 'a',
          ttsSkip: false,
          sentenceRange: [0, 5]
        }
      ],
      sentenceRange: [0, 5]
    },
    {
      title: '二',
      level: 1,
      blocks: [
        {
          blockId: 'b',
          type: 'paragraph',
          text: 'b',
          ttsSkip: false,
          sentenceRange: [5, 20]
        }
      ],
      sentenceRange: [5, 20]
    }
  ]
  const { chapters } = regroupStructuredChapters(structure, { mode: 'original' })
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '一')
  assert.equal(chapters[1].title, '二')
  console.log('  ok multi healthy chapters preserved')
}

console.log('\nregroupSingleChapter tests passed')
