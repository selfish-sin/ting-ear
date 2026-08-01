import type { BookData, AiEmbeddingSettings } from '../../../src/global'
import { callEmbedding } from './embedding-caller'
import { saveVectors, encodeVec, type VectorBookData, type VectorChunk } from './vector-store'

export interface IngestProgress {
  bookId: string
  phase: 'chunking' | 'embedding' | 'saving' | 'done' | 'error'
  current: number
  total: number
  /** chunking 完成后始终携带总块数，供 UI 显示 */
  totalChunks: number
  error?: string
  /** embedding 阶段因瞬时服务错误被跳过的块数（重试仍失败） */
  skipped?: number
}

type ProgressCb = (p: IngestProgress) => void

/** 分块大小（字符数），按句子边界切 */
const CHUNK_SIZE = 800
/** 块间重叠句数：跨块事实不再被拦腰切断（固定字数的边界伤害的解药） */
const OVERLAP_SENTENCES = 2

interface ChapterInfo {
  startIndex: number
  sentenceCount: number
}

interface ChunkInfo {
  chapter: number
  chapterTitle: string
  /** 注入/去重用，不含章名 */
  text: string
}

/**
 * 将一本书按章分块：
 * - 每块 ≤ CHUNK_SIZE 字符，句子边界对齐
 * - 块间重叠 OVERLAP_SENTENCES 句，跨块事实不被切断
 * - 段落边界优先：尽量不切碎一个自然段（句间不再额外拆）
 * - 不跨章携带重叠（章界即语义边界）
 */
function chunkBook(book: BookData): ChunkInfo[] {
  const sentences = book.sentences || []
  const chapters: ChapterInfo[] = book.chapters?.length
    ? book.chapters
    : [{ startIndex: 0, sentenceCount: sentences.length }]

  const chunks: ChunkInfo[] = []

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci]
    const start = ch.startIndex
    const end = Math.min(start + ch.sentenceCount, sentences.length)
    const title = (ch as { title?: string }).title?.trim() || `第 ${ci + 1} 章`

    let buf = ''
    let bufSentences: string[] = []

    for (let si = start; si < end; si++) {
      const s = sentences[si]
      if (buf.length + s.length + 1 > CHUNK_SIZE && buf.length > 0) {
        chunks.push({ chapter: ci, chapterTitle: title, text: buf.trim() })
        // 重叠：把上一块末尾 OVERLAP_SENTENCES 句带到下一块开头
        const tail = bufSentences.length > OVERLAP_SENTENCES ? bufSentences.slice(-OVERLAP_SENTENCES) : []
        buf = tail.join('\n')
        bufSentences = [...tail]
      }
      buf += (buf ? '\n' : '') + s
      bufSentences.push(s)
    }
    if (buf.trim()) chunks.push({ chapter: ci, chapterTitle: title, text: buf.trim() })
  }

  return chunks
}

/**
 * 本地知识库 ingest：分块 → embedding → 存文件。
 * 通过 onProgress 回调报告进度（供 IPC 推送到渲染进程）。
 */
export async function ingestBookLocal(
  book: BookData,
  settings: AiEmbeddingSettings,
  getDataDir: () => string,
  onProgress?: ProgressCb,
  signal?: AbortSignal
): Promise<VectorBookData> {
  let totalChunks = 0
  const emit = (phase: IngestProgress['phase'], current: number, total: number, error?: string) =>
    onProgress?.({ bookId: book.id, phase, current, total, totalChunks, error })

  // 1. 分块
  emit('chunking', 0, 1)
  const chunks = chunkBook(book)
  if (chunks.length === 0) throw new Error('书籍无内容，无法建立知识库')
  totalChunks = chunks.length
  emit('chunking', 1, 1)

  // 2. 批量 embedding
  //    embedding 文本 = `${章节标题}\n${块正文}`：把固定字数切块丢失的「这是哪一章」语义信号补回。
  //    存储的 text 仍是纯正文（用于注入证据与去重）。
  const embedTexts = chunks.map((c) => `${c.chapterTitle}\n${c.text}`)
  emit('embedding', 0, embedTexts.length)

  const batchSize = settings.batchSize > 0 ? settings.batchSize : 32
  // 按批收集向量；跳过的批次不写入，避免索引错位。
  // callEmbedding 已内置指数退避重试，这里只在重试仍失败时降级跳过该批，
  // 不让一本书因个别批次 502/网关抖动全盘丢失（已成功的向量照常保存）。
  const vectorsByChunk = new Map<number, number[]>()
  let skipped = 0

  for (let i = 0; i < embedTexts.length; i += batchSize) {
    if (signal?.aborted) throw new Error('cancelled')
    const batch = embedTexts.slice(i, i + batchSize)
    try {
      const result = await callEmbedding(batch, settings, signal)
      for (let j = 0; j < result.vectors.length; j++) {
        vectorsByChunk.set(i + j, result.vectors[j])
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // 单批彻底失败：记录跳过，继续后续批次
      skipped += batch.length
      onProgress?.({
        bookId: book.id,
        phase: 'embedding',
        current: Math.min(i + batchSize, embedTexts.length),
        total: embedTexts.length,
        totalChunks,
        skipped,
        error: `第 ${i + 1}-${i + batch.length} 块嵌入失败已跳过：${error instanceof Error ? error.message : String(error)}`
      })
      continue
    }
    emit('embedding', Math.min(i + batchSize, embedTexts.length), embedTexts.length)
  }

  // 全部批次都失败才认为建立失败
  if (vectorsByChunk.size === 0) {
    throw new Error('嵌入服务持续不可用，所有分块均失败，请检查嵌入模型配置或稍后重试')
  }

  // 3. 组装 & 存储（只写成功嵌入的块）
  emit('saving', 0, 1)
  const vectorChunks: VectorChunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    const v = vectorsByChunk.get(i)
    if (!v) continue
    const c = chunks[i]
    vectorChunks.push({
      chapter: c.chapter,
      index: i,
      chapterTitle: c.chapterTitle,
      text: c.text,
      vec: encodeVec(v)
    })
  }

  // 维度取首个成功向量长度；同模型维度一致
  const firstVec = vectorsByChunk.values().next().value as number[] | undefined
  const data: VectorBookData = {
    bookId: book.id,
    model: settings.model,
    dimension: firstVec?.length || 0,
    createdAt: new Date().toISOString(),
    chunks: vectorChunks
  }

  await saveVectors(getDataDir, data)
  emit('done', 1, 1, skipped > 0 ? `完成，但 ${skipped}/${embedTexts.length} 块因嵌入服务错误被跳过` : undefined)
  return data
}
