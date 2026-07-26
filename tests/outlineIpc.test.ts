import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveCanonicalOutlineInput } from '../electron/services/ai/outline-input'

const dataDir = mkdtempSync(join(tmpdir(), 'ting-ear-outline-ipc-'))
try {
  writeFileSync(join(dataDir, 'books.json'), JSON.stringify([{
    id: 'book-1',
    title: 'Canonical book',
    sentences: ['one', 'two', 'three', 'four'],
    chapters: [{ title: 'Chapter 1', startIndex: 0, sentenceCount: 2 }, { title: 'Chapter 2', startIndex: 2, sentenceCount: 2 }]
  }]))

  const resolved = resolveCanonicalOutlineInput(dataDir, {
    bookId: 'book-1',
    chapterIndex: 0,
    chapterKey: '0:0:2'
  })
  assert.equal(resolved.error, undefined)
  assert.deepEqual(resolved.input?.sentences, ['one', 'two'])
  assert.equal(resolved.input?.chapterTitle, 'Chapter 1')

  const stale = resolveCanonicalOutlineInput(dataDir, {
    bookId: 'book-1',
    chapterIndex: 0,
    chapterKey: '0:1:2'
  })
  assert.match(stale.error || '', /chapter key/i)
  console.log('Outline IPC input result: canonical chapter reload and stale-key rejection passed')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
