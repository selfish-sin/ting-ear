import type { AiLlmSettings } from '../../../src/global'
import { AiServiceError, streamChat } from './llm-caller'

export interface OutlineSection {
  title: string
  /** 相对于章节起始的句子偏移 */
  startOffset: number
  /** 该段核心论点/主张（一两句话） */
  point?: string
  /** 一句话描述本节在总纲中的论证角色：做什么、思想张力、论证结构 */
  summary?: string
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

/**
 * 大纲落盘缓存已统一到 outline-repository（OUTLINE_CACHE_VERSION=4）。
 * 本模块只负责 LLM 生成；不再维护第二套整书 CACHE_VERSION 缓存。
 */

/** 默认大纲提示词（设置可覆盖）；强制简体中文 + 逻辑先后 */
export const DEFAULT_OUTLINE_SYSTEM_PROMPT = `你是文本结构分析助手。根据一章中带编号的句子，把「本部分」划分成有逻辑先后关系的论述小节。

规则：
- 只返回 2～4 个小节（最多 4 个）
- 各小节必须按论述推进排序（如：背景→展开→转折→结论），前后有逻辑承接，禁止无序主题堆砌
- title、point、summary 必须使用简体中文（专有名词可保留原文并配中文）
- title ≤10 个汉字；point 可选，≤20 字；summary 必填，≤30 字，用一句话说明该小节在整体论证中的角色（它在做什么、思想张力在哪、论证结构上的承上启下关系）
- 只输出完整 JSON 数组，不要 markdown、不要解释：
[{"title":"...","startOffset":0,"point":"...","summary":"..."}]
- startOffset = 括号中的绝对句号，如 [26] → 26
- 必须闭合每个字符串/对象和最外层数组 ]，禁止半截 JSON`

const OUTLINE_PROMPT = DEFAULT_OUTLINE_SYSTEM_PROMPT

/** 分块更小：输入短 → 模型输出更短，更不易截断 */
const CHUNK_SIZE = 5000
const CHUNK_OVERLAP = 300
/** 输出 token 上限（短 JSON 足够；过大时部分供应商反而易截断） */
const OUTLINE_MAX_TOKENS = 2048

/** 收集流式响应为完整文本 */
async function collectStream(
  config: AiLlmSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  signal?: AbortSignal,
  maxTokens?: number
): Promise<string> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let result = ''
    const gen = streamChat(config, messages, controller.signal, {
      maxTokens: maxTokens ?? OUTLINE_MAX_TOKENS
    })
    for await (const chunk of gen) {
      result += chunk
    }
    return result
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 可重试的瞬时错误：限流 / 空正文 / 网络抖动 */
function isRetryableOutlineError(err: unknown): boolean {
  if (!(err instanceof AiServiceError)) return false
  return (
    err.code === 'rate_limited' ||
    err.code === 'network_error' ||
    err.code === 'timeout' ||
    (err.code === 'invalid_response' && /未包含有效正文|无法解析的流式数据/.test(err.message))
  )
}

/** 带重试的 collectStream（限流/空响应/网络错误会退避重试） */
async function collectStreamWithRetry(
  config: AiLlmSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  signal?: AbortSignal,
  maxTokens?: number
): Promise<string> {
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await collectStream(config, messages, signal, maxTokens)
    } catch (err) {
      if (!isRetryableOutlineError(err) || attempt === maxRetries || signal?.aborted) throw err
      const waitMs = err instanceof AiServiceError && err.code === 'rate_limited'
        ? 5000 * Math.pow(2, attempt)
        : 1200 * (attempt + 1)
      await delay(waitMs, signal)
    }
  }
  throw new Error('unreachable')
}

let lastParseError: { raw: string; reason: string } | null = null
export function getLastOutlineParseError(): { raw: string; reason: string } | null {
  return lastParseError
}

/** 从 start 位置的 `{` 找到匹配的 `}`（正确处理字符串转义）；截断则返回 -1 */
export function findMatchingBrace(source: string, start: number): number {
  if (source[start] !== '{') return -1
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function normalizeSectionItem(item: {
  title?: unknown
  startOffset?: unknown
  point?: unknown
  summary?: unknown
}): OutlineSection | null {
  if (typeof item.title !== 'string' || item.startOffset == null) return null
  const startOffset = Math.floor(Number(item.startOffset))
  if (!Number.isFinite(startOffset)) return null
  const section: OutlineSection = {
    title: String(item.title).trim(),
    startOffset
  }
  // 仅在有值时写入可选字段，避免 summary: undefined 导致 deepEqual / 序列化噪音
  if (typeof item.point === 'string' && item.point.trim()) {
    section.point = item.point.trim()
  }
  if (typeof item.summary === 'string' && item.summary.trim()) {
    section.summary = item.summary.trim()
  }
  return section
}

/**
 * 从截断/损坏的模型输出中抢救已完整的大纲对象。
 * 例如数组末尾对象写到一半被 max_tokens 截断时，前面完整的 `{...}` 仍可保留。
 */
export function salvageOutlineObjects(raw: string): OutlineSection[] {
  const text = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '')
  const sections: OutlineSection[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const end = findMatchingBrace(text, i)
    if (end < 0) break // 后续对象已截断，停止
    const slice = text.slice(i, end + 1)
    try {
      const parsed = JSON.parse(slice) as {
        title?: unknown
        startOffset?: unknown
        point?: unknown
        summary?: unknown
      }
      const section = normalizeSectionItem(parsed)
      if (section && section.title) sections.push(section)
    } catch {
      // 非大纲对象，跳过
    }
    i = end
  }
  return sections.sort((a, b) => a.startOffset - b.startOffset)
}

export function parseOutlineSections(raw: string): OutlineSection[] {
  lastParseError = null
  // 去掉 markdown 代码块包裹
  const text = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()

  // 1) 尝试完整 JSON 数组
  const arrayStart = text.indexOf('[')
  if (arrayStart >= 0) {
    // 找最后一个可能的 ]，先试严格 parse
    const arrayEnd = text.lastIndexOf(']')
    if (arrayEnd > arrayStart) {
      const candidate = text.slice(arrayStart, arrayEnd + 1)
      try {
        const parsed = JSON.parse(candidate) as Array<{
          title?: unknown
          startOffset?: unknown
          point?: unknown
          summary?: unknown
        }>
        if (Array.isArray(parsed)) {
          const sections = parsed
            .map((item) => normalizeSectionItem(item))
            .filter((item): item is OutlineSection => Boolean(item && item.title))
            .sort((a, b) => a.startOffset - b.startOffset)
          if (sections.length > 0) return sections
          lastParseError = { raw: raw.slice(0, 500), reason: 'JSON 解析成功但无有效条目' }
        }
      } catch (err) {
        // 2) 完整数组失败 → 抢救其中完整对象
        const salvaged = salvageOutlineObjects(candidate)
        if (salvaged.length > 0) {
          lastParseError = null
          return salvaged
        }
        lastParseError = {
          raw: raw.slice(0, 500),
          reason: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    } else {
      // 没有闭合 ]，直接抢救完整对象
      const salvaged = salvageOutlineObjects(text.slice(arrayStart))
      if (salvaged.length > 0) {
        lastParseError = null
        return salvaged
      }
      lastParseError = { raw: raw.slice(0, 500), reason: 'JSON 数组被截断且无完整条目' }
    }
  } else {
    // 无数组括号，仍尝试抢救散落对象
    const salvaged = salvageOutlineObjects(text)
    if (salvaged.length > 0) return salvaged
    lastParseError = { raw: raw.slice(0, 500), reason: '未找到 JSON 数组' }
  }

  return []
}

export function validateOutlineSections(
  sections: OutlineSection[],
  sentenceCount: number
): OutlineValidation {
  if (sections.length < 1) return { valid: false, error: '至少需要一个大纲节' }
  if (sections.length > MAX_OUTLINE_SECTIONS) return { valid: false, error: `大纲节数不能超过 ${MAX_OUTLINE_SECTIONS}` }

  // 自动修正：第一节 offset 不为 0 时强制归零
  if (sections[0].startOffset !== 0) sections[0].startOffset = 0

  // 自动修正：clamp 超出范围的 offset
  for (const section of sections) {
    if (section.startOffset >= sentenceCount) section.startOffset = sentenceCount - 1
    if (section.startOffset < 0) section.startOffset = 0
  }

  // 修正后去重（offset 相同的只保留第一个）
  const seen = new Set<number>()
  const deduped: OutlineSection[] = []
  for (const section of sections) {
    if (seen.has(section.startOffset)) continue
    seen.add(section.startOffset)
    deduped.push(section)
  }
  sections.length = 0
  sections.push(...deduped)

  if (sections.length < 1) return { valid: false, error: '修正后无有效大纲节' }
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    if (!section.title.trim() || section.title.length > 120) return { valid: false, error: '大纲标题无效' }
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

/** 合并多块结果，按 offset 去重（重叠区域优先保留先出现的）；超限时均匀抽样保留 */
function mergeChunkResults(allSections: OutlineSection[]): OutlineSection[] {
  const seen = new Set<number>()
  const merged: OutlineSection[] = []
  for (const section of allSections) {
    if (seen.has(section.startOffset)) continue
    seen.add(section.startOffset)
    merged.push(section)
  }
  merged.sort((a, b) => a.startOffset - b.startOffset)
  if (merged.length <= MAX_OUTLINE_SECTIONS) return merged
  // 保留首尾 + 中间均匀抽样
  const first = merged[0]
  const last = merged[merged.length - 1]
  const middle = merged.slice(1, -1)
  const keepMiddle = Math.max(0, MAX_OUTLINE_SECTIONS - 2)
  const sampled: OutlineSection[] = []
  if (keepMiddle > 0 && middle.length > 0) {
    for (let i = 0; i < keepMiddle; i++) {
      const idx = Math.floor((i * middle.length) / keepMiddle)
      sampled.push(middle[Math.min(idx, middle.length - 1)])
    }
  }
  const result = [first, ...sampled, last]
  // 抽样后可能重复 offset，再去重
  const out: OutlineSection[] = []
  const outSeen = new Set<number>()
  for (const section of result) {
    if (outSeen.has(section.startOffset)) continue
    outSeen.add(section.startOffset)
    out.push(section)
  }
  return out
}

function buildChunkUserPrompt(
  chapterTitle: string,
  totalSentences: number,
  chunkIndex: number,
  chunkCount: number,
  chunk: { numbered: string; baseOffset: number },
  chunkSentenceCount: number
): string {
  const rangeStart = chunk.baseOffset
  const rangeEnd = chunk.baseOffset + chunkSentenceCount - 1
  const isFirst = chunkIndex === 0
  return [
    `Chapter title: ${chapterTitle}`,
    `Whole chapter has ${totalSentences} sentences (indices 0–${Math.max(0, totalSentences - 1)}).`,
    `This is PART ${chunkIndex + 1}/${chunkCount} covering sentences [${rangeStart}–${rangeEnd}] only.`,
    `Return 2–4 COMPLETE sections for THIS PART only.`,
    isFirst
      ? `The first section MUST have startOffset ${rangeStart}.`
      : `startOffset values MUST fall within [${rangeStart}, ${rangeEnd}].`,
    `Prefer short titles; point is optional (≤20 words). Close the JSON array.`,
    '',
    chunk.numbered
  ].join('\n')
}

/**
 * 安全请求一块大纲：网络/空正文失败返回 null，不抛到外层，
 * 这样前面已抢救的小节不会整章作废。
 */
async function requestChunkOutline(
  config: AiLlmSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  signal: AbortSignal | undefined,
  log?: (level: 'info' | 'error', message: string) => void,
  label?: string
): Promise<OutlineSection[]> {
  try {
    const raw = await collectStreamWithRetry(config, messages, signal, OUTLINE_MAX_TOKENS)
    log?.('info', `大纲原始响应${label || ''}: ${raw.slice(0, 400)}`)
    const parsed = parseOutlineSections(raw)
    if (parsed.length > 0) {
      log?.('info', `大纲解析成功${label || ''}: ${parsed.length} 节`)
      return parsed
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log?.('error', `大纲请求失败${label || ''}: ${msg}`)
    // 空正文等：再试一次极简提示
  }

  if (signal?.aborted) return []

  try {
    await delay(1000, signal)
  } catch {
    return []
  }

  const retryMessages: Array<{ role: 'system' | 'user'; content: string }> = [
    {
      role: 'system',
      content:
        '只输出 JSON 数组，2～3 个对象：{"title":"中文标题","startOffset":数字}。' +
        '不要 point。title 必须简体中文。必须闭合数组。'
    },
    {
      role: 'user',
      content:
        messages[messages.length - 1]?.content +
        '\n\n重试：上次失败或截断。最多 3 条，只要 title（中文）+ startOffset，输出完整 JSON 数组。'
    }
  ]

  try {
    const raw = await collectStreamWithRetry(config, retryMessages, signal, 1024)
    log?.('info', `大纲重试响应${label || ''}: ${raw.slice(0, 400)}`)
    const parsed = parseOutlineSections(raw)
    if (parsed.length > 0) {
      log?.('info', `大纲重试成功${label || ''}: ${parsed.length} 节`)
      return parsed
    }
    log?.('error', `大纲重试仍无有效条目${label || ''}${lastParseError ? `（${lastParseError.reason}）` : ''}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log?.('error', `大纲重试失败${label || ''}: ${msg}`)
  }
  return []
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
  /** 可配置大纲 system 提示词（默认中文逻辑链） */
  getOutlineSystemPrompt?: () => string
  onProgress?: (chapterIndex: number, total: number) => void
  log?: (level: 'info' | 'error', message: string) => void
}

export class OutlineGenerator {
  constructor(private options: OutlineGeneratorOptions) {}

  private outlineSystemPrompt(): string {
    const custom = this.options.getOutlineSystemPrompt?.()?.trim()
    return custom || OUTLINE_PROMPT
  }

  /**
   * 生成单章大纲（纯 LLM，不落盘）。
   * 缓存读写由 outline-repository / generateChapterOutlineRecord 统一负责。
   */
  async generateChapter(
    bookId: string,
    sentences: string[],
    chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>,
    chapterIndex: number,
    signal?: AbortSignal
  ): Promise<ChapterOutline> {
    const { getSettings, log } = this.options
    void bookId // 保留参数以兼容调用方签名与日志上下文

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
      let chunkFailures = 0
      log?.('info', `大纲分块: 章${chapterIndex + 1} 共 ${chapterSentences.length} 句 → ${chunks.length} 块`)

      for (let ci = 0; ci < chunks.length; ci++) {
        if (signal?.aborted) break
        if (ci > 0) {
          try { await delay(DELAY_BETWEEN_CHUNKS_MS, signal) } catch { break }
        }

        const chunk = chunks[ci]
        const chunkSentenceCount = Math.max(1, chunk.numbered.split('\n').filter(Boolean).length)
        const messages = [
          { role: 'system' as const, content: this.outlineSystemPrompt() },
          {
            role: 'user' as const,
            content: buildChunkUserPrompt(
              chapter.title,
              chapterSentences.length,
              ci,
              chunks.length,
              chunk,
              chunkSentenceCount
            )
          }
        ]

        // 单块失败不抛出，避免「空正文」毁掉前面已抢救的小节
        const parsed = await requestChunkOutline(
          config,
          messages,
          signal,
          log,
          `[ch${chapterIndex}][chunk${ci}]`
        )

        if (parsed.length === 0) {
          chunkFailures += 1
        } else {
          const lo = Math.max(0, chunk.baseOffset - 8)
          const hi = Math.min(
            chapterSentences.length - 1,
            chunk.baseOffset + chunkSentenceCount + 8
          )
          const inRange = parsed.filter((s) => s.startOffset >= lo && s.startOffset <= hi)
          allSections.push(...(inRange.length ? inRange : parsed))
        }
      }

      const merged = mergeChunkResults(allSections)
      const validation = validateOutlineSections(merged, chapterSentences.length)
      if (validation.valid) {
        if (chunkFailures > 0) {
          log?.('info', `大纲部分成功：${merged.length} 节，${chunkFailures}/${chunks.length} 块失败已跳过`)
        } else {
          log?.('info', `大纲生成成功：${merged.length} 节`)
        }
        result = { chapterIndex, sections: merged }
      } else {
        const detail = lastParseError
          ? `（${lastParseError.reason}）`
          : validation.error
            ? `（${validation.error}）`
            : chunkFailures > 0
              ? `（${chunkFailures} 个分块请求失败或返回空）`
              : ''
        result = {
          chapterIndex,
          sections: [{ title: chapter.title, startOffset: 0 }],
          error: `模型未返回有效大纲${detail}`
        }
      }
    } catch (err) {
      result = {
        chapterIndex,
        sections: [{ title: chapter.title, startOffset: 0 }],
        error: err instanceof Error ? err.message : '生成失败'
      }
    }

    return result
  }
}
