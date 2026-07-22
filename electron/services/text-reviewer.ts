/**
 * AI 审校服务（LLM 不改文本，只标疑点）。
 *
 * 设计动机：LLM"改写"不可控（曾把2万字正文删成282字），但"指出疑点"它擅长
 * 且输出短——不会被推理模型吞输出（输出的是"第N段疑误删"JSON，不是重写全文）。
 * 审校本就是人的活，LLM 当可疑标记器放大效率，不替人做决定。
 *
 * 流程：把正则清洗结果按双换行分段 → 逐段发 LLM → LLM 返回该段疑点 JSON
 *       → 容错解析 → 汇总。全程不改文本，疑点供前端高亮+人审。
 */

import type { ILLMAdapter } from './llm/adapter'

/** 疑点类型 */
export type ReviewIssueType = 'suspect-deleted' | 'suspect-missed' | 'suspect-break' | 'other'

/** 单个疑点 */
export interface ReviewIssue {
  /** 段落序号（参考用，前端不依赖它定位） */
  paraIndex: number
  /** 疑点句子的【完整原文句】——前端用 sentences.find(s => s === sentence) 精确定位。
   *  必须是清洗结果里逐字存在的一整句（含句末标点）。比"第N句"下标稳：
   *  不受 LLM 分段、不受采纳改文本后下标漂移影响。 */
  sentence: string
  type: ReviewIssueType
  /** LLM 说明为什么觉得可疑 */
  reason: string
  /** 可选建议（不自动应用，供人参考） */
  suggestion?: string
}

export interface ReviewResult {
  issues: ReviewIssue[]
  parasTotal: number
}

export interface ReviewProgress {
  current: number
  total: number
}

/**
 * 审校 prompt。
 * 关键约束：
 *   - 输入是"已经过正则清洗"的段落，paraIndex 由调用方在 user 消息里给出
 *   - 只审校，绝不改写文字
 *   - 只输出 JSON 数组，无解释、无 markdown 包裹（但容错解析会处理 ```json 包裹的情况）
 *   - 无疑点返回 []
 */
export const DEFAULT_REVIEW_PROMPT = `你是一个文档审校助手。下面给你一段【已经过正则清洗】的文本，段落编号为 paraIndex=N（N 由用户消息给出）。

请只做"审校"，绝不改写文字。找出以下三类疑点：

1. suspect-deleted：疑似把正文当废料误删。表现：句子中途断裂、上下文不连贯、明显缺失主语或谓语。
2. suspect-missed：疑似漏改。还残留页码(如"第12页"、"Page 5")、乱码(■□、私用区字符)、竖排单字母分行、多余空格。
3. suspect-break：疑似断词错误。如"Journalof"应为"Journal of"、"FujianNormal"应为"Fujian Normal"。

输出格式：仅输出一个 JSON 数组，不要任何解释、不要 markdown 代码块标记。每个元素：
{"paraIndex": N, "sentence": "完整原文句(必须从原文逐字复制,含句末标点)", "type": "suspect-deleted|suspect-missed|suspect-break", "reason": "简短原因", "suggestion": "可选建议"}

关键：sentence 字段必须是原文中【逐字存在】的完整一句（用于精确定位），不要截断、不要改写。无疑点就输出 [] 。`

/**
 * 从 LLM 输出中提取 JSON 数组（容错）。
 * 处理：去 ```json``` 包裹 → 去 ``` 包裹 → trim → 找第一个 [ 到最后一个 ] → JSON.parse。
 * 解析失败返回 null。
 */
function extractIssuesJson(raw: string): unknown[] | null {
  if (!raw) return null
  let s = raw.trim()
  // 去 markdown 代码块包裹
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // 找第一个 [ 到最后一个 ]
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  const jsonStr = s.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonStr)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 把原始解析结果规范化成 ReviewIssue[]（过滤无效项、补字段） */
function normalizeIssues(arr: unknown[], paraIndex: number): ReviewIssue[] {
  const validTypes: ReviewIssueType[] = ['suspect-deleted', 'suspect-missed', 'suspect-break', 'other']
  const out: ReviewIssue[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const type = validTypes.includes(o.type as ReviewIssueType) ? (o.type as ReviewIssueType) : 'other'
    // sentence 必须是字符串（原文逐字句）；没有 sentence 的疑点无法定位，跳过
    const sentence = typeof o.sentence === 'string' ? o.sentence.trim() : ''
    const reason = typeof o.reason === 'string' ? o.reason.slice(0, 200) : ''
    const suggestion = typeof o.suggestion === 'string' && o.suggestion.trim() ? o.suggestion.slice(0, 200) : undefined
    if (!sentence) continue // 没有定位句的疑点无法用，丢弃
    out.push({
      paraIndex: typeof o.paraIndex === 'number' ? o.paraIndex : paraIndex,
      sentence,
      type,
      reason: reason || '未说明原因',
      suggestion
    })
  }
  return out
}

/**
 * 用 LLM 审校文本（不改文本，只返回疑点）。
 *
 * @param regexCleaned 正则清洗后的全文
 * @param adapter      LLM 适配器
 * @param onProgress   进度回调（current/total，按段计）
 * @param systemPrompt 审校 prompt（默认 DEFAULT_REVIEW_PROMPT）
 * @param temperature  温度，默认 0.2（审校要稳）
 * @param maxTokens    单段输出上限，默认 2048（疑点JSON通常很短）
 * @param signal       取消信号
 */
export async function reviewTextWithLLM(
  regexCleaned: string,
  adapter: ILLMAdapter,
  onProgress?: (p: ReviewProgress) => void,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal
): Promise<ReviewResult> {
  const segments = regexCleaned.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) {
    return { issues: [], parasTotal: 0 }
  }

  const issues: ReviewIssue[] = []
  onProgress?.({ current: 0, total: segments.length })

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) break
    onProgress?.({ current: i + 1, total: segments.length })

    const seg = segments[i]
    // 太短的段（<8字）跳过审校，省 token
    if (seg.length < 8) continue

    try {
      const result = await adapter.chat(
        [
          { role: 'system', content: systemPrompt || DEFAULT_REVIEW_PROMPT },
          { role: 'user', content: `paraIndex=${i}\n\n段落内容：\n${seg}` }
        ],
        { temperature: temperature ?? 0.2, maxTokens: maxTokens ?? 2048, signal }
      )

      const parsed = extractIssuesJson(result)
      if (parsed) {
        issues.push(...normalizeIssues(parsed, i))
      }
      // 解析失败：静默跳过（该段无有效疑点），不中断
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
      // 推理模型吞输出：内容为空 → extractIssuesJson 返回 null，会走到这里仅当 fetch 抛错
      console.error(`[TextReviewer] 段 ${i + 1}/${segments.length} 审校失败:`, error)
      // 失败不中断，继续下一段
    }
  }

  return { issues, parasTotal: segments.length }
}
