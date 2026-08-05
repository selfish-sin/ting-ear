import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ChapterOutlineRepository,
  OUTLINE_CACHE_VERSION,
  OUTLINE_SCHEMA_LEGACY,
  OUTLINE_SCHEMA_BRIEF,
  normalizeOutlineRecord
} from '../electron/services/ai/outline-repository'

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
  const loaded = repository.load(record.bookId, record.chapterKey, record.contentHash)
  assert.ok(loaded)
  assert.equal(loaded.schemaVersion, OUTLINE_SCHEMA_LEGACY)
  assert.equal(loaded.sections[0].originalTitle, '总论')
  assert.equal(repository.load(record.bookId, record.chapterKey, 'hash-b'), null)

  const cachePath = join(root, 'outlines', 'book-1.json')
  const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as { version: number }
  assert.equal(cache.version, OUTLINE_CACHE_VERSION)

  // v2 过旧：整文件不可读
  cache.version = 2
  writeFileSync(cachePath, JSON.stringify(cache), 'utf8')
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash), null)

  // v3 必须可读（历史事故：只认 v4 导致用户磁盘大纲整库 miss）
  mkdirSync(join(root, 'outlines'), { recursive: true })
  const v3Path = join(root, 'outlines', 'book-v3.json')
  writeFileSync(
    v3Path,
    JSON.stringify({
      version: 3,
      records: {
        '0:0:12': {
          bookId: 'book-v3',
          chapterKey: '0:0:12',
          chapterIndex: 0,
          contentHash: 'hash-v3',
          status: 'generated',
          minimumSections: 2,
          sections: [
            { id: 'a', originalTitle: '背景', point: '先铺垫', startOffset: 0 },
            { id: 'b', originalTitle: '主张', point: '核心论断', startOffset: 5 }
          ],
          generatedAt: '2026-07-27T00:00:00.000Z'
        }
      }
    }),
    'utf8'
  )
  const v3Repo = new ChapterOutlineRepository(root)
  const v3Hit = v3Repo.load('book-v3', '0:0:12', 'hash-v3')
  assert.ok(v3Hit, 'v3 cache must hit')
  assert.equal(v3Hit.schemaVersion, OUTLINE_SCHEMA_LEGACY)
  assert.equal(v3Hit.sections.length, 2)
  assert.equal(v3Hit.sections[1].point, '核心论断')

  // 对 v3 文件 save 一章后：文件抬升到当前版本，旧章仍在
  v3Repo.save({
    ...v3Hit,
    sections: [...v3Hit.sections, { id: 'c', originalTitle: '收束', startOffset: 10 }]
  })
  const v3File = JSON.parse(readFileSync(v3Path, 'utf8')) as {
    version: number
    records: Record<string, { sections: unknown[] }>
  }
  assert.equal(v3File.version, OUTLINE_CACHE_VERSION)
  assert.equal(v3File.records['0:0:12'].sections.length, 3)

  // 无 schemaVersion 的旧 JSON 归一化为 LEGACY，且不算无效
  const normalized = normalizeOutlineRecord({
    bookId: 'x',
    chapterKey: 'k',
    contentHash: 'h',
    status: 'generated',
    sections: [{ originalTitle: '一', startOffset: 0 }]
  })
  assert.ok(normalized)
  assert.equal(normalized.schemaVersion, OUTLINE_SCHEMA_LEGACY)

  const failed = { ...record, status: 'failed' as const, error: 'timeout' }
  repository.save(failed)
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash)?.status, 'failed')
  repository.deleteBook(record.bookId)
  assert.equal(repository.load(record.bookId, record.chapterKey, record.contentHash), null)

  // schema=2 ChapterBrief：thesis/whyItMatters/hinges 往返
  const briefDir = mkdtempSync(join(tmpdir(), 'ting-ear-outline-brief-'))
  try {
    const briefRepo = new ChapterOutlineRepository(briefDir)
    const briefRecord = {
      bookId: 'book-brief',
      chapterKey: 'ch-0',
      chapterIndex: 0,
      contentHash: 'h-brief',
      status: 'generated' as const,
      minimumSections: 2,
      schemaVersion: OUTLINE_SCHEMA_BRIEF,
      sections: [{ id: 's1', originalTitle: '总论', startOffset: 0 }],
      thesis: '本章主张一句话',
      whyItMatters: '读懂差在哪',
      hinges: [
        { at: 5, insight: '此处认知反转' },
        { at: 12, insight: '关键论证支点' }
      ]
    }
    briefRepo.save(briefRecord)
    const briefLoaded = briefRepo.load('book-brief', 'ch-0', 'h-brief')
    assert.ok(briefLoaded)
    assert.equal(briefLoaded.schemaVersion, OUTLINE_SCHEMA_BRIEF)
    assert.equal(briefLoaded.thesis, '本章主张一句话')
    assert.equal(briefLoaded.whyItMatters, '读懂差在哪')
    assert.ok(briefLoaded.hinges && briefLoaded.hinges.length === 2)
    assert.equal(briefLoaded.hinges![0].at, 5)
    assert.equal(briefLoaded.hinges![1].insight, '关键论证支点')
  } finally {
    rmSync(briefDir, { recursive: true, force: true })
  }

  // normalizeOutlineRecord：hinges 非法项丢弃，空数组返回 undefined
  const withBadHinges = normalizeOutlineRecord({
    bookId: 'x',
    chapterKey: 'k',
    contentHash: 'h',
    status: 'generated',
    sections: [{ originalTitle: '一', startOffset: 0 }],
    schemaVersion: OUTLINE_SCHEMA_BRIEF,
    thesis: '  ',  // 空白 → undefined
    hinges: [
      { at: 3, insight: '有效支点' },
      { at: 'NaN', insight: '非法 at' },  // 丢弃
      { at: 7, insight: '' },  // 丢弃
      'not-an-object'  // 丢弃
    ]
  })
  assert.ok(withBadHinges)
  assert.equal(withBadHinges.thesis, undefined)
  assert.ok(withBadHinges.hinges && withBadHinges.hinges.length === 1)
  assert.equal(withBadHinges.hinges![0].insight, '有效支点')

  // 空 hinges 数组 → undefined（避免空数组噪音）
  const emptyHinges = normalizeOutlineRecord({
    bookId: 'x',
    chapterKey: 'k',
    contentHash: 'h',
    status: 'generated',
    sections: [{ originalTitle: '一', startOffset: 0 }],
    hinges: []
  })
  assert.ok(emptyHinges)
  assert.equal(emptyHinges.hinges, undefined)

  console.log('Outline repository result: v3 compat, soft schema, cache isolation passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
