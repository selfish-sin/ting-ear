import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChapterOutlineRepository } from '../electron/services/ai/outline-repository'
import { hashSentences } from '../src/utils/contentHash'

const root = mkdtempSync(join(tmpdir(), 'ting-ear-outline-integration-'))
try {
  const recordBase = {
    bookId: 'book-integration',
    chapterKey: '0:0:12',
    chapterIndex: 0,
    status: 'generated' as const,
    minimumSections: 2,
    sections: [{ id: 'section-0', originalTitle: '总论', startOffset: 0 }]
  }
  const sentences = Array.from({ length: 12 }, (_, index) => `句子 ${index}`)
  const hash = hashSentences(sentences)
  const repository = new ChapterOutlineRepository(root)
  repository.save({ ...recordBase, contentHash: hash })

  const restarted = new ChapterOutlineRepository(root)
  assert.equal(restarted.load(recordBase.bookId, recordBase.chapterKey, hash)?.status, 'generated')
  assert.equal(restarted.load(recordBase.bookId, recordBase.chapterKey, hashSentences([...sentences, 'changed'])), null)
  restarted.deleteBook(recordBase.bookId)
  assert.equal(restarted.load(recordBase.bookId, recordBase.chapterKey, hash), null)
  console.log('Outline integration result: restart, invalidation, and deletion passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
