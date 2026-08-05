import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BookData } from '../src/global'
import {
  IngestService,
  bookContentHash,
  bookFullContent,
  bookSourceName,
  contentHash,
  isLegacyChapterState
} from '../electron/services/ai/ingest-service'
import {
  IngestScheduler,
  parseBookIdFromSourceName,
  pickPreferredSource
} from '../electron/services/ai/ingest-scheduler'
import type { NmemBridge, NmemIngestResult, NmemSourceInfo } from '../electron/services/ai/nmem-bridge'

function makeBook(overrides: Partial<BookData> = {}): BookData {
  const sentences = overrides.sentences || [
    '第一句关于经济危机。',
    '第二句关于社会变革。',
    '第三句关于政治整合。'
  ]
  return {
    id: 'book-1',
    title: '测试之书',
    author: '作者',
    filePath: '',
    format: 'txt',
    sentences,
    chapters: [
      { title: '第一章', startIndex: 0, sentenceCount: 1 },
      { title: '第二章', startIndex: 1, sentenceCount: 1 },
      { title: '第三章', startIndex: 2, sentenceCount: 1 }
    ],
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: '2026-07-27T00:00:00.000Z',
    lastReadAt: '2026-07-27T00:00:00.000Z',
    ...overrides
  }
}

class FakeNmem {
  calls: Array<{ content: string; name: string; sourceType: string }> = []
  sources = new Map<string, NmemSourceInfo>()
  nextId = 1
  offline = false
  /** 可选的阻塞 gate：设置后 ingestContent 会等待它 resolve，用于模拟慢速上传制造并发窗口 */
  blockIngest: Promise<void> | null = null

  async checkHealth() {
    if (this.offline) throw new Error('offline')
    return { status: 'online' as const, checkedAt: new Date().toISOString() }
  }

  async ingestContent(input: {
    content: string
    name: string
    sourceType: string
  }): Promise<NmemIngestResult> {
    if (this.offline) throw new Error('offline')
    if (this.blockIngest) await this.blockIngest
    this.calls.push(input)
    // 真实 nmem 不按 name 去重（ai-now/sources 已证实同 bookId 存在多份），
    // 每次都创建新 source；去重由 IngestScheduler 删旧源 + dedupeSources 负责
    const id = `src-${this.nextId++}`
    this.sources.set(id, { id, name: input.name, status: 'ready' })
    return { sourceId: id, isDuplicate: false }
  }

  async getSource(sourceId: string): Promise<NmemSourceInfo | null> {
    return this.sources.get(sourceId) || null
  }

  async listSources(): Promise<NmemSourceInfo[]> {
    return [...this.sources.values()]
  }

  deleted: string[] = []

  async deleteSource(sourceId: string): Promise<boolean> {
    if (this.sources.has(sourceId)) {
      this.sources.delete(sourceId)
      this.deleted.push(sourceId)
      return true
    }
    return false
  }

  async search(): Promise<never[]> {
    return []
  }
}

async function main(): Promise<void> {
  console.log('\nWhole-book MDM ingest')

  const book = makeBook()
  assert.equal(bookSourceName(book), '测试之书 [bookId=book-1]')
  assert.equal(bookFullContent(book), book.sentences.join('\n'))
  assert.equal(bookContentHash(book), contentHash(book.sentences.join('\n')))
  console.log('  ok builds stable whole-book source name and content hash')

  // 整本只打一次 ingest，不按 3 章拆分
  {
    const nmem = new FakeNmem()
    const ingest = new IngestService(nmem as unknown as NmemBridge)
    const state = await ingest.ingestWholeBook(book)
    assert.equal(nmem.calls.length, 1)
    assert.equal(nmem.calls[0].name, '测试之书 [bookId=book-1]')
    assert.equal(nmem.calls[0].content, book.sentences.join('\n'))
    assert.equal(state.status, 'searchable')
    assert.ok(state.sourceId)
    console.log('  ok uploads the whole book as a single source (not per chapter)')
  }

  // 调度器：内容未变时第二次 tryIngest 不重复上传
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-'))
    try {
      const nmem = new FakeNmem()
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const logs: string[] = []
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => [book],
        (_level, msg) => logs.push(msg)
      )

      assert.equal(await scheduler.tryIngest(book), true)
      assert.equal(nmem.calls.length, 1)

      assert.equal(await scheduler.tryIngest(book), true)
      assert.equal(nmem.calls.length, 1, 'second tryIngest must not re-upload')
      assert.ok(logs.some((l) => l.includes('跳过')))

      // syncAll 默认也应跳过
      const result = await scheduler.syncAll()
      assert.equal(nmem.calls.length, 1)
      assert.equal(result.skipped, 1)
      assert.equal(result.synced, 0)
      console.log('  ok skips re-upload when content hash is unchanged')

      // force 才重传
      const forced = await scheduler.syncAll({ force: true })
      assert.equal(nmem.calls.length, 2)
      assert.equal(forced.synced, 1)
      // 同名 → isDuplicate，但仍算成功
      console.log('  ok force sync re-uploads only when requested')

      // 状态文件应是整本格式，无 chapters 字段
      const statusPath = join(root, 'ingest-status.json')
      assert.ok(existsSync(statusPath))
      const saved = JSON.parse(readFileSync(statusPath, 'utf-8'))
      assert.equal(typeof saved['book-1'].contentHash, 'string')
      assert.equal(saved['book-1'].chapters, undefined)
      console.log('  ok persists whole-book status without chapter map')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 旧按章状态会被识别并触发整本迁移
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-legacy-'))
    try {
      writeFileSync(
        join(root, 'ingest-status.json'),
        JSON.stringify({
          'book-1': {
            updatedAt: '2026-01-01T00:00:00.000Z',
            chapters: {
              '0': {
                sourceId: 'old-0',
                contentHash: 'aaa',
                status: 'searchable',
                updatedAt: '2026-01-01T00:00:00.000Z'
              },
              '1': {
                sourceId: 'old-1',
                contentHash: 'bbb',
                status: 'searchable',
                updatedAt: '2026-01-01T00:00:00.000Z'
              }
            }
          }
        }),
        'utf-8'
      )
      const nmem = new FakeNmem()
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => [book],
        () => undefined
      )
      const loaded = (await scheduler.loadStatus())['book-1']
      assert.ok(isLegacyChapterState(loaded))
      assert.equal(await scheduler.tryIngest(book), true)
      assert.equal(nmem.calls.length, 1)
      assert.equal(nmem.calls[0].content, book.sentences.join('\n'))
      console.log('  ok migrates legacy per-chapter status to one whole-book upload')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 并发竞态：同一本书双线并发（导入即时线 + 探针定时线）只上传一次
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-race-'))
    try {
      const nmem = new FakeNmem()
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => [book],
        () => undefined
      )

      // 用 gate 卡住首次上传，制造 tryIngest 双线并发的竞态窗口
      let releaseGate: () => void = () => {}
      nmem.blockIngest = new Promise<void>((resolve) => {
        releaseGate = resolve
      })

      // 两条线同时发起（模拟「导书即时 tryIngest」与「30s 探针 catchUp」并发）
      const p1 = scheduler.tryIngest(book)
      const p2 = scheduler.tryIngest(book)
      releaseGate()
      const [r1, r2] = await Promise.all([p1, p2])
      assert.equal(r1, true)
      assert.equal(r2, true)
      assert.equal(nmem.calls.length, 1, 'concurrent tryIngest must not double-upload')

      // 状态已写入，再次调用应跳过，不再上传
      assert.equal(await scheduler.tryIngest(book), true)
      assert.equal(nmem.calls.length, 1, 'post-upload tryIngest must skip')
      console.log('  ok per-book in-flight lock prevents concurrent double upload')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 去重：同 bookId 的多个历史遗留 source 只保留 1 个（含 original_name 风格 + version）
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-dedupe-'))
    try {
      const nmem = new FakeNmem()
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => [book],
        () => undefined
      )
      // 模拟 nmem 真实命名：`书名 [bookId=…].md` + version 字段
      nmem.sources.set('dup-1', {
        id: 'dup-1',
        name: '测试之书 [bookId=book-1].md',
        status: 'ready',
        version: 1
      })
      nmem.sources.set('dup-2', {
        id: 'dup-2',
        name: '测试之书 [bookId=book-1].md',
        status: 'ready',
        version: 2
      })
      nmem.sources.set('dup-3', {
        id: 'dup-3',
        name: '测试之书 [bookId=book-1].md',
        status: 'processing',
        version: 1
      })
      nmem.sources.set('other', {
        id: 'other',
        name: '别人的笔记.txt',
        status: 'ready'
      })
      const result = await scheduler.dedupeSources()
      assert.equal(result.removed, 2)
      assert.equal(result.kept, 1)
      assert.equal(result.groups, 1)
      assert.equal(result.scanned, 4)
      assert.equal(nmem.sources.size, 2, 'one ting-ear source + one unrelated kept')
      assert.ok(nmem.sources.has('dup-2'), 'must keep highest version (v2)')
      assert.ok(nmem.sources.has('other'), 'must not touch non-ting-ear sources')
      console.log('  ok dedupe keeps highest-version source per bookId and skips others')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 内容变化重传后删除旧 source（含同 bookId 孤儿），确保知识库只有一份
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-replace-'))
    try {
      const nmem = new FakeNmem()
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => [book],
        () => undefined
      )
      // 首次导入
      assert.equal(await scheduler.tryIngest(book), true)
      assert.equal(nmem.deleted.length, 0, 'no deletion on first ingest')
      assert.equal(nmem.sources.size, 1)

      // 内容变化后重传：上传成功后清理同 bookId 旧源
      const bookV2 = makeBook({ sentences: ['全新的第一句内容。', '全新的第二句内容。'] })
      assert.equal(await scheduler.tryIngest(bookV2), true)
      assert.ok(nmem.deleted.length >= 1, 'old source must be deleted after re-upload')
      assert.equal(nmem.calls.length, 2, 're-upload happens once for changed content')
      assert.equal(nmem.sources.size, 1, 'only one source remains after replace')
      console.log('  ok re-upload cleans sibling sources, keeping only one copy')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 多书并行 tryIngest：状态文件不得互相覆盖（曾导致探针再传升 v2）
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-multibook-'))
    try {
      const books = [
        makeBook({ id: 'book-a', title: '书A', sentences: ['A1', 'A2'] }),
        makeBook({ id: 'book-b', title: '书B', sentences: ['B1', 'B2'] }),
        makeBook({ id: 'book-c', title: '书C', sentences: ['C1', 'C2'] })
      ]
      const nmem = new FakeNmem()
      // 人为放慢，放大并发写状态窗口
      let releaseGate: () => void = () => {}
      nmem.blockIngest = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      const ingest = new IngestService(nmem as unknown as NmemBridge)
      const scheduler = new IngestScheduler(
        () => root,
        nmem as unknown as NmemBridge,
        ingest,
        () => books,
        () => undefined
      )
      const pending = books.map((b) => scheduler.tryIngest(b))
      releaseGate()
      const results = await Promise.all(pending)
      assert.deepEqual(results, [true, true, true])
      assert.equal(nmem.calls.length, 3)

      const saved = JSON.parse(readFileSync(join(root, 'ingest-status.json'), 'utf-8'))
      assert.ok(saved['book-a']?.sourceId, 'book-a status must survive concurrent writes')
      assert.ok(saved['book-b']?.sourceId, 'book-b status must survive concurrent writes')
      assert.ok(saved['book-c']?.sourceId, 'book-c status must survive concurrent writes')

      // 状态齐全后再次 tryIngest 全部跳过，不再上传
      nmem.blockIngest = null
      for (const b of books) {
        assert.equal(await scheduler.tryIngest(b), true)
      }
      assert.equal(nmem.calls.length, 3, 'no re-upload after concurrent status writes')
      console.log('  ok concurrent multi-book tryIngest does not lose status rows')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 辅助：bookId 解析 + 保留策略
  {
    assert.equal(parseBookIdFromSourceName('测试 [bookId=abc-1].md'), 'abc-1')
    assert.equal(parseBookIdFromSourceName('无关文件.txt'), null)
    const prefer = pickPreferredSource(
      [
        { id: 'old', name: 'x [bookId=b]', status: 'ready', version: 1 },
        { id: 'new', name: 'x [bookId=b]', status: 'ready', version: 3 },
        { id: 'mid', name: 'x [bookId=b]', status: 'processing', version: 9 }
      ],
      'old'
    )
    assert.equal(prefer.id, 'new', 'ready + higher version beats preferId and high-version processing')
    console.log('  ok bookId parse and preferred-source ranking')
  }

  console.log('Whole-book MDM ingest result: 11 passed')
}

void main()
