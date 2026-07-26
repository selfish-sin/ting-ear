import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AiLlmSettings } from '../../../src/global'
import { AiServiceError, streamChat } from './llm-caller'

export interface OutlineSection {
  title: string
  /** 相对于章节起始的句子偏移 */
  startOffset: number
  /** 该段核心论点/主张（一两句话） */
  point?: string
}

export interface ChapterOutline {
  chapterIndex: number
  sections: OutlineSection[]
  /** 生成失败时的错误信息 */
  error?: string
}

export const SHORT_CHAPTER_SENTENCE_LIMIT = 10
export const MAX_OUTLINE_SECTIONS = 16

export interface OutlineValidation {
  valid: boolean
  error?: string
}

export function isShortChapter(sentenceCount: number): boolean {
  return sentenceCount <= SHORT_CHAPTER_SENTENCE_LIMIT
}

export function calculateMinimumSections(sentenceCount: number): number {
  return Math.min(12, Math.max(2, Math.ceil(Math.max(0, sentenceCount) / 40)))
}

interface OutlineCache {
  version: number
  contentHash: string
  generatedAt: string
  chapters: ChapterOutline[]
}

/** 缓存格式版本——升级时旧缓存自动失效 */
const CACHE_VERSION = 2

const OUTLINE_PROMPT = `你是一个文本论证结构分析助手。给定一章的文本（按句子编号），请分析其论证结构，划分为若干段落单元。

要求：
- 每单元 10~30 句为宜，按论证逻辑切分（前提→推理→结论），不是简单话题切分
- title：简短标题（≤15字），概括该段论证主题
- point：该段的核心论点或主张（一两句话，≤60字），说明作者在此论证了什么
- 严格返回 JSON 数组，无其他文字：
[{"title":"标题","startOffset":起始句编号,"point":"核心论点"}]

startOffset 是句子在输入中的编号（从0开始）。第一个元素的 startOffset 必须为 0。`

/** 分块大小（字符数）和重叠 */
const CHUNK_SIZE = 12000
const CHUNK_OVERLAP = 500

function hashContent(sentences: string[]): string {
  return createHash('sha256').update(sentences.join('\n')).digest('hex').slice(0, 16)
}

function cachePath(dataDir: string, bookId: string): string {
  const dir = join(dataDir, 'outlines')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${bookId}.json`)
}

export function loadCachedOutline(dataDir: string, bookId: string, contentHash: string): ChapterOutline[] | null {
  const path = cachePath(dataDir, bookId)
  if (!existsSync(path)) return null
  try {
    const cache: OutlineCache = JSON.parse(readFileSync(path, 'utf-8'))
    if (cache.version !== CACHE_VERSION) return null
    if (cache.contentHash !== contentHash) return null
    return cache.chapters
  } catch {
    return null
  }
}

function saveCachedOutline(dataDir: string, bookId: string, contentHash: string, chapters: ChapterOutline[]): void {
  const cache: OutlineCache = { version: CACHE_VERSION, contentHash, generatedAt: new Date().toISOString(), chapters }
  writeFileSync(cachePath(dataDir, bookId), JSON.stringify(cache, null, 2), 'utf-8')
}

/** 收集流式响应为完整文本 */
async function collectStream(config: AiLlmSettings, messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
  const controller = new AbortController()
  let result = ''
  const gen = streamChat(config, messages, controller.signal)
  for await (const chunk of gen) {
    result += chunk
  }
  return result
}

/** 带 429 重试的 collectStream（指数退避，最多 3 次） */
async function collectStreamWithRetry(
  config: AiLlmSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  signal?: AbortSignal
): Promise<string> {
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await collectStream(config, messages)
    } catch (err) {
      const isRateLimit = err instanceof AiServiceError && err.code === 'rate_limited'
      if (!isRateLimit || attempt === maxRetries || signal?.aborted) throw err
      const waitMs = 5000 * Math.pow(2, attempt)
      await delay(waitMs, signal)
    }
  }
  throw new Error('unreachable')
}

let lastParseError: { raw: string; reason: string } | null = null
export function getLastOutlineParseError(): { raw: string; reason: string } | null {
  return lastParseError
}

export function parseOutlineSections(raw: string): OutlineSection[] {
  // 去掉 markdown 代码块包裹
  const text = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()

  const match = text.match(/\[[\s\S]*\]/)
  if (!match) {
    lastParseError = { raw: raw.slice(0, 500), reason: '未找到 JSON 数组' }
    return []
  }
  try {
    const parsed = JSON.parse(match[0]) as Array<{ title?: unknown; startOffset?: unknown; point?: unknown }>
    const sections = parsed
      .filter((item) => typeof item.title === 'string' && item.startOffset != null)
      .map((item) => ({
        title: String(item.title),
        startOffset: Math.floor(Number(item.startOffset)),
        point: typeof item.point === 'string' && item.point.trim() ? item.point.trim() : undefined
      }))
      .filter((item) => Number.isFinite(item.startOffset))
      .sort((a, b) => a.startOffset - b.startOffset)
    if (sections.length === 0) {
      lastParseError = { raw: raw.slice(0, 500), reason: 'JSON 解析成功但无有效条目' }
    }
    return sections
  } catch (err) {
    lastParseError = { raw: raw.slice(0, 500), reason: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}` }
    return []
  }
}

export function validateOutlineSections(
  sections: OutlineSection[],
  sentenceCount: number
): OutlineValidation {
  if (sections.length < 1) return { valid: false, error: '至少需要一个大纲节' }
  if (sections.length > MAX_OUTLINE_SECTIONS) return { valid: false, error: `大纲节数不能超过 ${MAX_OUTLINE_SECTIONS}` }
  if (sections[0].startOffset !== 0) return { valid: false, error: '第一节必须从第 0 句开始' }
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    if (!section.title.trim() || section.title.length > 120) return { valid: false, error: '大纲标题无效' }
    if (!Number.isInteger(section.startOffset) || section.startOffset < 0 || section.startOffset >= sentenceCount) {
      return { valid: false, error: '大纲偏移超出章节范围' }
    }
    if (index > 0 && section.startOffset <= sections[index - 1].startOffset) {
      return { valid: false, error: '大纲偏移必须严格递增' }
    }
  }
  return { valid: true }
}

/**
 * 将章节句子分块，每块带编号文本。
 * 返回 [{ sentences: 原始句子数组, numbered: 带编号文本, baseOffset: 该块在章内的起始句索引 }]
 */
function buildChunks(chapterSentences: string[]): Array<{ numbered: string; baseOffset: number }> {
  const chunks: Array<{ numbered: string; baseOffset: number }> = []
  let charCount = 0
  let chunkStart = 0

  for (let i = 0; i < chapterSentences.length; i++) {
    charCount += chapterSentences[i].length + 1
    if (charCount >= CHUNK_SIZE && i > chunkStart) {
      chunks.push({
        numbered: chapterSentences.slice(chunkStart, i).map((s, idx) => `[${chunkStart + idx}] ${s}`).join('\n'),
        baseOffset: chunkStart
      })
      // 回退重叠：找到重叠起始句
      let overlapChars = 0
      let overlapStart = i
      while (overlapStart > chunkStart && overlapChars < CHUNK_OVERLAP) {
        overlapStart--
        overlapChars += chapterSentences[overlapStart].length + 1
      }
      chunkStart = overlapStart
      charCount = 0
      for (let j = chunkStart; j <= i; j++) charCount += chapterSentences[j].length + 1
    }
  }
  // 最后一块
  if (chunkStart < chapterSentences.length) {
    chunks.push({
      numbered: chapterSentences.slice(chunkStart).map((s, idx) => `[${chunkStart + idx}] ${s}`).join('\n'),
      baseOffset: chunkStart
    })
  }
  return chunks
}

/** 合并多块结果，按 offset 去重（重叠区域优先保留先出现的） */
function mergeChunkResults(allSections: OutlineSection[]): OutlineSection[] {
  const seen = new Set<number>()
  const merged: OutlineSection[] = []
  for (const section of allSections) {
    if (seen.has(section.startOffset)) continue
    seen.add(section.startOffset)
    merged.push(section)
  }
  return merged.sort((a, b) => a.startOffset - b.startOffset)
}

/** 请求间隔，避免触发速率限制 */
const DELAY_BETWEEN_CHUNKS_MS = 3000

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
  })
}

export interface OutlineGeneratorOptions {
  getSettings: () => AiLlmSettings
  getDataDir: () => string
  cache?: boolean
  onProgress?: (chapterIndex: number, total: number) => void
  log?: (level: 'info' | 'error', message: string) => void
}

export class OutlineGenerator {
  constructor(private options: OutlineGeneratorOptions) {}

  /** 生成单章大纲（带缓存） */
  async generateChapter(
    bookId: string,
    sentences: string[],
    chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>,
    chapterIndex: number,
    signal?: AbortSignal
  ): Promise<ChapterOutline> {
    const { getSettings, getDataDir, log } = this.options
    const useCache = this.options.cache !== false
    const contentHash = hashContent(sentences)
    const dataDir = getDataDir()

    // 尝试从缓存中取该章
    if (useCache) {
      const cached = loadCachedOutline(dataDir, bookId, contentHash)
      if (cached) {
        const hit = cached.find((c) => c.chapterIndex === chapterIndex)
        if (hit && !hit.error) return hit
      }
    }

    const chapter = chapters[chapterIndex]
    if (!chapter) return { chapterIndex, sections: [{ title: '未知章节', startOffset: 0 }], error: '章节不存在' }

    const chapterSentences = sentences.slice(chapter.startIndex, chapter.startIndex + chapter.sentenceCount)

    if (isShortChapter(chapterSentences.length)) {
      return { chapterIndex, sections: [{ title: chapter.title, startOffset: 0 }] }
    }

    const config = getSettings()
    let result: ChapterOutline

    try {
      const chunks = buildChunks(chapterSentences)
      const allSections: OutlineSection[] = []

      for (let ci = 0; ci < chunks.length; ci++) {
        if (signal?.aborted) break
        if (ci > 0) {
          try { await delay(DELAY_BETWEEN_CHUNKS_MS, signal) } catch { break }
        }
        const raw = await collectStreamWithRetry(config, [
          { role: 'system', content: `${OUTLINE_PROMPT}\n最低节数：${calculateMinimumSections(chapterSentences.length)}；最多节数：${MAX_OUTLINE_SECTIONS}。startOffset 使用整章相对句号，必须严格递增且第一节为 0；若模型只判断出一个完整单元，也必须返回这一节。` },
          { role: 'user', content: `章节标题：${chapter.title}\n共 ${chapterSentences.length} 句。\n\n${chunks[ci].numbered}` }
        ], signal)
        log?.('info', `大纲原始响应[ch${chapterIndex}][chunk${ci}]: ${raw.slice(0, 300)}`)
        allSections.push(...parseOutlineSections(raw))
      }

      const merged = mergeChunkResults(allSections)
      const validation = validateOutlineSections(merged, chapterSentences.length)
      if (validation.valid) {
        result = { chapterIndex, sections: merged }
      } else {
        const detail = lastParseError ? `（${lastParseError.reason}）` : ''
        result = { chapterIndex, sections: [{ title: chapter.title, startOffset: 0 }], error: `模型未返回有效大纲${detail}` }
      }
    } catch (err) {
      result = { chapterIndex, sections: [{ title: chapter.title, startOffset: 0 }], error: err instanceof Error ? err.message : '生成失败' }
    }

    // 增量写入缓存
    if (useCache && !signal?.aborted) {
      const existing = loadCachedOutline(dataDir, bookId, contentHash) || []
      const updated = existing.filter((c) => c.chapterIndex !== chapterIndex)
      updated.push(result)
      updated.sort((a, b) => a.chapterIndex - b.chapterIndex)
      saveCachedOutline(dataDir, bookId, contentHash, updated)
    }

    return result
  }
}
