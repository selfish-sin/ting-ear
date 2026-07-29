/**
 * 从 nmem 知识库恢复被清空的 books.json。
 * 用法：npx tsx scripts/recover-from-nmem.mts
 *
 * 不依赖 Electron；直接读 %APPDATA%/ting-ear/听伴/ 并写回 books.json。
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { preprocessText, splitSentences } from '../electron/services/parsers/textPreprocessor'
import { generatePseudoStructure } from '../electron/services/parsers/structureBuilder'
import { normalizeBookCollection, normalizeBookData, normalizeChapters, normalizeSentences } from '../src/utils/bookData'
import type { BookData } from '../src/global'

const NMEM = process.env.NMEM_URL || 'http://127.0.0.1:14242'

function findDataDir(): string {
  const root = path.join(os.homedir(), 'AppData', 'Roaming', 'ting-ear')
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const d of dirs) {
    const p = path.join(root, d.name)
    if (fs.existsSync(path.join(p, 'books.json'))) return p
  }
  throw new Error('找不到听伴数据目录')
}

async function getJson(urlPath: string): Promise<unknown> {
  const res = await fetch(`${NMEM.replace(/\/+$/, '')}${urlPath}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}`)
  return res.json()
}

async function getText(urlPath: string): Promise<string> {
  const res = await fetch(`${NMEM.replace(/\/+$/, '')}${urlPath}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}`)
  return res.text()
}

function parseBookIdFromName(name: string): { bookId: string | null; title: string } {
  const m = name.match(/\[bookId=([0-9a-fA-F-]{36})\]\s*(.+?)(?:\.(?:md|txt|epub|pdf|docx|html))?$/i)
  if (m) return { bookId: m[1], title: m[2].trim() }
  // fallback: strip extension
  return { bookId: null, title: name.replace(/\.(md|txt|epub|pdf|docx|html)$/i, '').trim() }
}

function buildBook(opts: {
  id: string
  title: string
  content: string
  coverPath?: string
  progress?: { currentSentenceIndex: number; progressPercent: number; lastReadAt: string }
}): BookData | null {
  const cleaned = preprocessText(String(opts.content ?? '')).text
  const sentences = normalizeSentences(splitSentences(cleaned))
  if (sentences.length === 0) return null
  const chapters = normalizeChapters(
    [{ title: opts.title || '正文', startIndex: 0, sentenceCount: sentences.length }],
    sentences.length
  )
  const { structure, structureMeta } = generatePseudoStructure(sentences, chapters)
  const now = new Date().toISOString()
  const progress = opts.progress
  return normalizeBookData({
    id: opts.id,
    title: opts.title || '未命名',
    originalTitle: opts.title || '未命名',
    author: '',
    coverPath: opts.coverPath,
    coverSource: opts.coverPath ? 'auto' : undefined,
    filePath: `nmem-recover://${opts.id}`,
    format: 'md',
    sentences,
    chapters,
    currentChapterIndex: 0,
    currentSentenceIndex: progress?.currentSentenceIndex ?? 0,
    progressPercent: progress?.progressPercent ?? 0,
    isCompleted: false,
    addedAt: now,
    lastReadAt: progress?.lastReadAt ?? now,
    originalSentences: sentences,
    structure,
    structureMeta
  })
}

async function main() {
  const dataDir = findDataDir()
  console.log('数据目录:', dataDir)

  const booksPath = path.join(dataDir, 'books.json')
  const current = fs.readFileSync(booksPath, 'utf8')
  console.log('当前 books.json 字节:', Buffer.byteLength(current), '内容预览:', current.slice(0, 80))

  // 若已有非空书架，默认不覆盖
  try {
    const existing = JSON.parse(current)
    if (Array.isArray(existing) && existing.length > 0 && process.env.FORCE !== '1') {
      console.error(`books.json 已有 ${existing.length} 本书。若仍要强制恢复，设置 FORCE=1`)
      process.exit(2)
    }
  } catch {
    /* 损坏则继续恢复 */
  }

  // 备份当前文件
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(booksPath, path.join(dataDir, `books.json.before-recover-${stamp}`))

  // ingest-status: bookId -> sourceId
  const ingestPath = path.join(dataDir, 'ingest-status.json')
  const ingest: Record<string, { sourceId?: string }> = fs.existsSync(ingestPath)
    ? JSON.parse(fs.readFileSync(ingestPath, 'utf8'))
    : {}

  // history progress hints
  const historyPath = path.join(dataDir, 'history.json')
  const progressByBook = new Map<string, { currentSentenceIndex: number; progressPercent: number; lastReadAt: string; title?: string }>()
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Array<{
      bookId: string
      bookTitle?: string
      endSentenceIndex?: number
      endTime?: string
    }>
    for (const h of history) {
      const prev = progressByBook.get(h.bookId)
      const end = h.endSentenceIndex ?? 0
      if (!prev || (h.endTime && h.endTime > prev.lastReadAt)) {
        progressByBook.set(h.bookId, {
          currentSentenceIndex: end,
          progressPercent: 0,
          lastReadAt: h.endTime || new Date().toISOString(),
          title: h.bookTitle
        })
      }
    }
  }

  const coversDir = path.join(dataDir, 'covers')
  const coverIds = new Set(
    fs.existsSync(coversDir)
      ? fs.readdirSync(coversDir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/i, ''))
      : []
  )

  const sourcesPayload = (await getJson('/sources')) as { sources?: Array<{ id: string; original_name?: string; size_bytes?: number }> }
  const sources = sourcesPayload.sources || []
  console.log('nmem sources:', sources.length)

  // bookId -> best source
  const byBookId = new Map<string, { sourceId: string; title: string; size: number }>()

  // Prefer ingest-status mapping
  for (const [bookId, state] of Object.entries(ingest)) {
    if (!state?.sourceId) continue
    const src = sources.find((s) => s.id === state.sourceId)
    const name = src?.original_name || ''
    const parsed = parseBookIdFromName(name)
    byBookId.set(bookId, {
      sourceId: state.sourceId,
      title: parsed.title || progressByBook.get(bookId)?.title || bookId,
      size: src?.size_bytes || 0
    })
  }

  // Fill from source names
  for (const s of sources) {
    const parsed = parseBookIdFromName(s.original_name || '')
    if (!parsed.bookId) continue
    const prev = byBookId.get(parsed.bookId)
    const size = s.size_bytes || 0
    if (!prev || size > prev.size) {
      byBookId.set(parsed.bookId, { sourceId: s.id, title: parsed.title, size })
    }
  }

  // Also include cover ids even if no ingest (try match by source name only above)
  console.log('可恢复 bookId 数:', byBookId.size)

  const recovered: BookData[] = []
  const failures: string[] = []

  for (const [bookId, meta] of byBookId) {
    process.stdout.write(`恢复 ${meta.title.slice(0, 40)} ... `)
    try {
      let content = ''
      try {
        content = await getText(`/sources/${meta.sourceId}/raw`)
      } catch {
        const body = (await getJson(`/sources/${meta.sourceId}/content`)) as { content?: string }
        content = body.content || ''
      }
      if (!content.trim()) {
        failures.push(`${bookId}: 空内容`)
        console.log('空内容')
        continue
      }
      const prog = progressByBook.get(bookId)
      const coverPath = coverIds.has(bookId) ? path.join(coversDir, `${bookId}.png`) : undefined
      // clamp progress after we know sentence count
      const book = buildBook({
        id: bookId,
        title: prog?.title || meta.title,
        content,
        coverPath,
        progress: prog
          ? {
              currentSentenceIndex: prog.currentSentenceIndex,
              progressPercent: prog.progressPercent,
              lastReadAt: prog.lastReadAt
            }
          : undefined
      })
      if (!book) {
        failures.push(`${bookId}: 分句后为空`)
        console.log('分句空')
        continue
      }
      if (prog && book.sentences.length > 0) {
        const idx = Math.max(0, Math.min(prog.currentSentenceIndex, book.sentences.length - 1))
        book.currentSentenceIndex = idx
        book.progressPercent = Math.round((idx / book.sentences.length) * 1000) / 10
      }
      recovered.push(book)
      console.log(`ok ${book.sentences.length}句`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`${bookId}: ${msg}`)
      console.log('失败', msg)
    }
  }

  const normalized = normalizeBookCollection(recovered)
  if (normalized.length === 0) {
    console.error('没有恢复出任何书，未写盘')
    process.exit(1)
  }

  // 写恢复结果
  const outTmp = path.join(dataDir, 'books.json.recovering')
  fs.writeFileSync(outTmp, JSON.stringify(normalized), 'utf8')
  fs.renameSync(outTmp, booksPath)

  // 额外副本
  fs.writeFileSync(path.join(dataDir, `books.recovered-${stamp}.json`), JSON.stringify(normalized), 'utf8')

  console.log('\n=== 恢复完成 ===')
  console.log('成功:', normalized.length)
  console.log('失败:', failures.length)
  failures.forEach((f) => console.log(' -', f))
  console.log('已写入:', booksPath)
  console.log('文件大小:', fs.statSync(booksPath).size, 'bytes')
  console.log('\n请重新启动听伴查看书架。章节结构为伪结构，可按需重新导入原文件以获得更好分章。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
