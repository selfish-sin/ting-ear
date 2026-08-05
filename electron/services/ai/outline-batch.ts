import { LibraryStorage } from '../library-storage'
import {
  ChapterOutlineRepository,
  OUTLINE_SCHEMA_LEGACY,
  OUTLINE_SCHEMA_BRIEF,
  type ChapterOutlineRecord,
  type ChapterOutlineStatus
} from './outline-repository'
import { OutlineGenerator, isShortChapter, calculateMinimumSections, type ChapterOutline } from './outline-generator'
import { outlineGenerationQueue } from './outline-queue'
import { chapterKey, chapterDisplayTitle } from '../../../src/utils/bookData'
import { hashSentences } from '../../../src/utils/contentHash'
import type { BookData } from '../../../src/global'

/**
 * 单章大纲生成 + 落盘。同时被 `ai:outline:generate` 与批量任务复用，
 * 保证单章生成与「全部书更新」的行为完全一致。
 * sentences 与 CanonicalOutlineInput / BookData.sentences 一致，为 string[]。
 *
 * 缓存策略（性价比第一）：
 * - force=false 且 hash 命中 generated/short_chapter → skipped（0 次 LLM）
 * - schemaVersion 旧也算命中（软失效）；禁止因「产物形态旧」重算
 * - 仅 force=true 或无可用缓存时才调 LLM
 */
export interface ChapterOutlineResult {
  status: 'generated' | 'short_chapter' | 'failed' | 'skipped'
  record?: ChapterOutlineRecord
  error?: string
  /** 缓存诊断：hit=复用磁盘 / miss=需生成 / force=强制重算 / write=新写入 */
  cache?: 'hit' | 'miss' | 'force' | 'write'
}

function logOutlineCache(
  event: 'hit' | 'miss' | 'force' | 'write' | 'fail',
  input: { bookId: string; chapterIndex: number; chapterKey: string },
  detail?: string
): void {
  const base = `[outline-cache] ${event} book=${input.bookId} ch=${input.chapterIndex} key=${input.chapterKey}`
  console.info(detail ? `${base} ${detail}` : base)
}

export async function generateChapterOutlineRecord(
  getDataDir: () => string,
  generator: OutlineGenerator,
  input: { bookId: string; chapterIndex: number; chapterKey: string; chapterTitle: string; sentences: string[] },
  force: boolean
): Promise<ChapterOutlineResult> {
  const contentHash = hashSentences(input.sentences)
  const repo = new ChapterOutlineRepository(getDataDir())

  if (!force) {
    const previous = repo.load(input.bookId, input.chapterKey, contentHash)
    if (previous && (previous.status === 'generated' || previous.status === 'short_chapter')) {
      // 软失效：legacy schema 同样 hit，绝不因缺 thesis/summary 而重烧 LLM
      logOutlineCache('hit', input, `schema=${previous.schemaVersion ?? OUTLINE_SCHEMA_LEGACY} sections=${previous.sections.length}`)
      return { status: 'skipped', record: previous, cache: 'hit' }
    }
    logOutlineCache('miss', input, previous ? `stale_status=${previous.status}` : 'no_record')
  } else {
    logOutlineCache('force', input)
  }

  const outline: ChapterOutline = await outlineGenerationQueue.enqueue(() =>
    generator.generateChapter(input.bookId, input.sentences, [{ title: input.chapterTitle, startIndex: 0, sentenceCount: input.sentences.length }], 0)
  )

  if (outline.error) {
    logOutlineCache('fail', input, outline.error)
    return { status: 'failed', error: outline.error }
  }

  const status: ChapterOutlineStatus = isShortChapter(input.sentences.length) ? 'short_chapter' : 'generated'
  const record: ChapterOutlineRecord = {
    bookId: input.bookId,
    chapterKey: input.chapterKey,
    chapterIndex: input.chapterIndex,
    contentHash,
    status,
    minimumSections: calculateMinimumSections(input.sentences.length),
    // ChapterBrief 形态：含 thesis/whyItMatters/hinges（章级字段仅在有值时写入）
    schemaVersion: OUTLINE_SCHEMA_BRIEF,
    sections: outline.sections.map((section, index) => ({
      id: `${input.chapterKey}-${contentHash}-${index}`,
      originalTitle: section.title,
      point: section.point,
      summary: section.summary,
      startOffset: section.startOffset
    })),
    thesis: outline.thesis,
    whyItMatters: outline.whyItMatters,
    hinges: outline.hinges,
    generatedAt: new Date().toISOString()
  }
  repo.save(record)
  logOutlineCache('write', input, `status=${status} schema=${OUTLINE_SCHEMA_BRIEF} sections=${record.sections.length}${outline.thesis ? ' +brief' : ''}`)
  return { status, record, cache: force ? 'force' : 'write' }
}

export interface OutlineBatchProgress {
  /** 'book' = 处理中，'done' = 全部结束（含被取消） */
  phase: 'book' | 'done'
  bookIndex: number
  bookTotal: number
  bookTitle: string
  chapterIndex: number
  chapterTotal: number
  succeeded: number
  failed: number
  skipped: number
}

export interface RunOutlineBatchOptions {
  getDataDir: () => string
  generator: OutlineGenerator
  force: boolean
  onProgress: (progress: OutlineBatchProgress) => void
}

let activeBatchController: AbortController | null = null

export function isOutlineBatchRunning(): boolean {
  return activeBatchController !== null
}

export function cancelOutlineBatch(): void {
  activeBatchController?.abort()
}

/**
 * 遍历书架全部有章节的书籍，逐章生成（或更新）大纲。
 * 复用单章生成所用的串行队列（outlineGenerationQueue），避免并发打爆 LLM 限流。
 * 通过 onProgress 实时回传进度，任务在后台运行，调用方无需 await。
 */
export async function runOutlineBatch(options: RunOutlineBatchOptions): Promise<void> {
  const { getDataDir, generator, force, onProgress } = options
  const controller = new AbortController()
  activeBatchController = controller

  let succeeded = 0
  let failed = 0
  let skipped = 0

  try {
    const storage = new LibraryStorage(getDataDir)
    const books = storage.loadAll().filter((book: BookData) => Array.isArray(book.chapters) && book.chapters.length > 0)
    const bookTotal = books.length

    for (let bi = 0; bi < books.length; bi++) {
      if (controller.signal.aborted) break
      const book = books[bi]
      const chapterTotal = book.chapters.length

      onProgress({
        phase: 'book',
        bookIndex: bi,
        bookTotal,
        bookTitle: book.title || '未命名',
        chapterIndex: 0,
        chapterTotal,
        succeeded,
        failed,
        skipped
      })

      for (let ci = 0; ci < book.chapters.length; ci++) {
        if (controller.signal.aborted) break
        const chapter = book.chapters[ci]
        const key = chapterKey(chapter, ci)
        const sentences = book.sentences.slice(chapter.startIndex, chapter.startIndex + chapter.sentenceCount)

        const result = await generateChapterOutlineRecord(getDataDir, generator, {
          bookId: book.id,
          chapterIndex: ci,
          chapterKey: key,
          chapterTitle: chapterDisplayTitle(chapter, book.title || '正文'),
          sentences
        }, force)

        if (result.status === 'skipped') skipped++
        else if (result.status === 'failed') failed++
        else succeeded++

        onProgress({
          phase: 'book',
          bookIndex: bi,
          bookTotal,
          bookTitle: book.title || '未命名',
          chapterIndex: ci + 1,
          chapterTotal,
          succeeded,
          failed,
          skipped
        })
      }
    }
  } catch {
    // 单本书解析失败不应中断整批任务，外层已按章计数
  } finally {
    activeBatchController = null
    onProgress({
      phase: 'done',
      bookIndex: 0,
      bookTotal: 0,
      bookTitle: '',
      chapterIndex: 0,
      chapterTotal: 0,
      succeeded,
      failed,
      skipped
    })
  }
}
