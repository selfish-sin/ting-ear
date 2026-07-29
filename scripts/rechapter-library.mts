/**
 * 按产品规则重建 library 内所有书的章节：
 * - 有原书签/多章目录 → refine（min35 / max400，不足向下合并）
 * - 否则正文标题启发式
 * - 再没有 → 每 400 句一块
 *
 * 用法：npx tsx scripts/rechapter-library.mts
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  rebuildChaptersForSentences,
  CHAPTER_MIN_SENTENCES,
  CHAPTER_MAX_SENTENCES
} from '../electron/services/parsers/chapterBuilder'
import { generatePseudoStructure } from '../src/utils/bookData'
import { normalizeChapters, normalizeBookData } from '../src/utils/bookData'
import { LibraryStorage } from '../electron/services/library-storage'
import type { BookData } from '../src/global'

function findDataDir(): string {
  const root = path.join(os.homedir(), 'AppData', 'Roaming', 'ting-ear')
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const d of dirs) {
    const p = path.join(root, d.name)
    if (fs.existsSync(path.join(p, 'library', 'index.json')) || fs.existsSync(path.join(p, 'books.json'))) {
      return p
    }
  }
  throw new Error('找不到听伴数据目录')
}

function rechapterBook(book: BookData): BookData {
  const sentences = book.sentences || []
  if (sentences.length === 0) return book

  // 原 chapters 若有多章，当作「原书签」信号；单章整本不当
  const raw =
    book.chapters && book.chapters.length > 1
      ? book.chapters
      : book.structure && book.structure.length > 1
        ? book.structure.map((s) => ({
            title: s.title,
            startIndex: s.sentenceRange[0],
            sentenceCount: Math.max(0, s.sentenceRange[1] - s.sentenceRange[0])
          }))
        : undefined

  const built = rebuildChaptersForSentences(sentences, raw, {
    minSentences: CHAPTER_MIN_SENTENCES,
    maxSentences: CHAPTER_MAX_SENTENCES
  })
  const chapters = normalizeChapters(built, sentences.length)
  const { structure, structureMeta } = generatePseudoStructure(sentences, chapters)

  const next = normalizeBookData({
    ...book,
    chapters,
    structure,
    structureMeta: {
      ...structureMeta,
      sourceFormat: book.structureMeta?.sourceFormat || book.format || 'rechapter'
    }
  })
  if (!next) return book
  return next
}

function main() {
  const dataDir = findDataDir()
  console.log('数据目录:', dataDir)
  console.log(`规则: min=${CHAPTER_MIN_SENTENCES}, max=${CHAPTER_MAX_SENTENCES}`)

  const storage = new LibraryStorage(() => dataDir)
  const books = storage.loadAll()
  console.log('加载书籍:', books.length)

  const updated: BookData[] = []
  for (const book of books) {
    const before = book.chapters?.length || 0
    const next = rechapterBook(book)
    const after = next.chapters?.length || 0
    const sizes = (next.chapters || []).map((c) => c.sentenceCount)
    const minC = sizes.length ? Math.min(...sizes) : 0
    const maxC = sizes.length ? Math.max(...sizes) : 0
    console.log(
      `  ${next.title.slice(0, 36)}  ${before}章 → ${after}章  句数范围[${minC},${maxC}]  总${next.sentences.length}`
    )
    updated.push(next)
  }

  const result = storage.saveLibrary(updated)
  console.log('\n已写回 library:', result)
  console.log('完成。请重启听伴查看章节。')
}

main()
