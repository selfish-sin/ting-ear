import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChapterOutlineRepository, OUTLINE_CACHE_VERSION } from '../electron/services/ai/outline-repository'

const root = mkdtempSync(join(tmpdir(), 'ting-ear-outline-repository-'))
try {
  const repository = new ChapterOutlineRepository(root)
  const record = {
    bookId: 'book-1',
    chapterKey: 'chapter-0',
    chapterIndex: 0,
    contentHash: 'hash-a',
    status: 'generated' as const,
    minimumSections: 2,
    sections: [{ id: 's1', originalTitle: '总论', startOffset: 0 }]
  }
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash), null)
  repository.save(record)
  assert.deepEqual(repository.load(record.bookId, record.chapterKey, record.contentHash), record)
  assert.equal(repository.load(record.bookId, record.chapterKey, 'hash-b'), null)

  const cachePath = join(root, 'outlines', 'book-1.json')
  const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as { version: number }
  assert.equal(cache.version, OUTLINE_CACHE_VERSION)
  cache.version = 2
  writeFileSync(cachePath, JSON.stringify(cache), 'utf8')
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash), null)

  const failed = { ...record, status: 'failed' as const, error: 'timeout' }
  repository.save(failed)
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash)?.status, 'failed')
  repository.deleteBook(record.bookId)
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash), null)
  console.log('Outline repository result: cache isolation and migration passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
