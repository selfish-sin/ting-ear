import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import { join } from 'path'

export interface VectorChunk {
  /** 章节索引 */
  chapter: number
  /** 块在章内的序号 */
  index: number
  /** 章节标题（嵌入时拼到文本前；旧文件可能缺失，回退为「第 N 章」） */
  chapterTitle?: string
  /** 原始文本（注入证据 / 去重用，不含章名） */
  text: string
  /** 向量（base64 Float32Array） */
  vec: string
}

export interface VectorBookData {
  bookId: string
  model: string
  dimension: number
  createdAt: string
  chunks: VectorChunk[]
}

export interface SearchResult {
  text: string
  chapter: number
  /** 章节标题，缺失时回退「第 N 章」 */
  chapterTitle: string
  score: number
}

export interface SearchOptions {
  /** 仅在该章内检索（chapter 类问题下推用）；不传则全书 */
  chapterFilter?: number
  /** 预解码向量（与 data.chunks 同序），命中缓存时传入可跳过逐块 base64 解码 */
  decoded?: Float32Array[]
  /**
   * 期望的 embedding 模型名；与索引存的不一致时抛 VectorCompatError，
   * 避免模型更换后照算 cosine 得到垃圾分数。
   */
  expectedModel?: string
  /**
   * 相对分数阈值：保留 score ≥ minScoreRatio × 最高分 的块，封顶 topK。
   * 默认 0.5：去掉分数断崖后的噪声块，让「固定条数」不再硬塞无关结果。
   * 设为 0 关闭阈值，仅按 topK/maxChars 截断（旧行为）。
   */
  minScoreRatio?: number
}

/** 向量与索引不兼容（模型/维度变更后未重建知识库）——避免静默算错 cosine */
export class VectorCompatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VectorCompatError'
  }
}

function vectorsDir(getDataDir: () => string): string {
  return join(getDataDir(), 'vectors')
}

function bookPath(getDataDir: () => string, bookId: string): string {
  return join(vectorsDir(getDataDir), `${bookId}.json`)
}

export async function saveVectors(
  getDataDir: () => string,
  data: VectorBookData
): Promise<void> {
  const dir = vectorsDir(getDataDir)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(bookPath(getDataDir, data.bookId), JSON.stringify(data), 'utf-8')
  invalidateVectorCache(data.bookId)
}

export async function loadVectors(
  getDataDir: () => string,
  bookId: string
): Promise<VectorBookData | null> {
  const p = bookPath(getDataDir, bookId)
  if (!existsSync(p)) return null
  try {
    const raw = await readFile(p, 'utf-8')
    return JSON.parse(raw) as VectorBookData
  } catch {
    return null
  }
}

export async function deleteVectors(
  getDataDir: () => string,
  bookId: string
): Promise<void> {
  const p = bookPath(getDataDir, bookId)
  if (existsSync(p)) await unlink(p)
  invalidateVectorCache(bookId)
}

export function hasVectors(getDataDir: () => string, bookId: string): boolean {
  return existsSync(bookPath(getDataDir, bookId))
}

/** Float32Array → base64 */
export function encodeVec(arr: number[]): string {
  const f32 = new Float32Array(arr)
  return Buffer.from(f32.buffer).toString('base64')
}

/** base64 → Float32Array */
export function decodeVec(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64')
  // Buffer 可能是共享池视图（byteOffset≠0、.buffer 比实际大），
  // 直接 new Float32Array(buf.buffer) 会从池首读错一堆垃圾。
  // slice 出恰好大小的副本，按本机字节序还原。
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(copy)
}

/**
 * 校验查询向量与已存索引兼容：维度必须一致，模型名（若提供）应当匹配。
 * 不一致时抛 VectorCompatError——绝不能截断维度后照算 cosine（会得到看似正常实则垃圾的分数）。
 */
export function assertVectorCompat(
  data: VectorBookData,
  queryVec: number[] | Float32Array,
  expectedModel?: string
): void {
  const qLen = Array.isArray(queryVec) ? queryVec.length : queryVec.length
  if (data.dimension && data.dimension !== qLen) {
    throw new VectorCompatError(
      `嵌入维度与索引不一致（索引 ${data.dimension} 维，查询 ${qLen} 维）。请重建该书知识库。`
    )
  }
  if (expectedModel && data.model && data.model !== expectedModel) {
    throw new VectorCompatError(
      `嵌入模型与索引不一致（索引 ${data.model}，当前 ${expectedModel}）。请重建该书知识库。`
    )
  }
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function chapterTitleOf(chunk: VectorChunk): string {
  return chunk.chapterTitle?.trim() || `第 ${chunk.chapter + 1} 章`
}

/**
 * 本地向量检索：cosine topK + 可选章节过滤 + 分数阈值 + maxChars 截断。
 * queryVec 由 embedding-caller 对查询文本生成。
 *
 * - chapterFilter：仅在该章 chunk 上算 cosine（chapter 类问题下推，避免 topK 槽位被别章占满）
 * - decoded：传入预解码向量跳过逐块 base64 解码（命中进程内缓存时）
 * - minScoreRatio：相对分数阈值，默认 0.5（绝对地板 0.3），去掉断崖后的噪声
 */
export function searchVectors(
  data: VectorBookData,
  queryVec: number[],
  topK: number,
  maxChars: number,
  options: SearchOptions = {}
): SearchResult[] {
  assertVectorCompat(data, queryVec, options.expectedModel)
  const q = new Float32Array(queryVec)
  const minRatio = options.minScoreRatio ?? 0.5
  const decoded = options.decoded
  const scored: SearchResult[] = []

  for (let i = 0; i < data.chunks.length; i++) {
    const chunk = data.chunks[i]
    if (options.chapterFilter !== undefined && chunk.chapter !== options.chapterFilter) continue
    const vec = decoded ? decoded[i] : decodeVec(chunk.vec)
    const score = cosineSim(q, vec)
    scored.push({ text: chunk.text, chapter: chunk.chapter, chapterTitle: chapterTitleOf(chunk), score })
  }

  scored.sort((a, b) => b.score - a.score)

  // 相对分数阈值 + 绝对地板：动态条数，不再硬塞 topK 个噪声
  const topScore = scored.length > 0 ? scored[0].score : 0
  const cutoff = minRatio > 0 ? Math.max(0.3, topScore * minRatio) : -Infinity

  const results: SearchResult[] = []
  let total = 0
  for (const item of scored) {
    if (results.length >= topK) break
    if (item.score < cutoff && results.length > 0) break
    if (total + item.text.length > maxChars && results.length > 0) break
    results.push(item)
    total += item.text.length
  }
  return results
}

// ── 进程内向量缓存 ──────────────────────────────────────────────
// 每轮对话都会重读整本 JSON + 逐块 base64 解码，是纯浪费。
// 缓存解码后的 Float32Array[]，用文件 mtime 失效（ingest 重写后 mtime 变即自动重建）。

interface CachedBook {
  mtimeMs: number
  data: VectorBookData
  /** 与 data.chunks 同序的预解码向量 */
  vectors: Float32Array[]
}

const vectorCache = new Map<string, CachedBook>()

export function invalidateVectorCache(bookId?: string): void {
  if (bookId) vectorCache.delete(bookId)
  else vectorCache.clear()
}

/** 取（带缓存的）一本书的解码向量；文件变动或不存在时自动重建/丢弃。 */
export async function getCachedVectors(
  getDataDir: () => string,
  bookId: string
): Promise<VectorBookData | null> {
  const p = bookPath(getDataDir, bookId)
  if (!existsSync(p)) {
    vectorCache.delete(bookId)
    return null
  }
  let mtimeMs = 0
  try {
    mtimeMs = statSync(p).mtimeMs
  } catch {
    vectorCache.delete(bookId)
    return null
  }
  const cached = vectorCache.get(bookId)
  if (cached && cached.mtimeMs === mtimeMs) return cached.data

  try {
    const raw = await readFile(p, 'utf-8')
    const data = JSON.parse(raw) as VectorBookData
    const vectors = data.chunks.map((c) => decodeVec(c.vec))
    vectorCache.set(bookId, { mtimeMs, data, vectors })
    return data
  } catch {
    vectorCache.delete(bookId)
    return null
  }
}

/** 缓存版检索：命中缓存时跳过逐块 base64 解码，热路径性能提升一个数量级。 */
export async function searchBookVectors(
  getDataDir: () => string,
  bookId: string,
  queryVec: number[],
  topK: number,
  maxChars: number,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const data = await getCachedVectors(getDataDir, bookId)
  if (!data) return []
  const cached = vectorCache.get(bookId)
  return searchVectors(data, queryVec, topK, maxChars, {
    ...options,
    decoded: cached?.vectors
  })
}
