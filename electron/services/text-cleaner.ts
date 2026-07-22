/**
 * AI 文本清洗服务（两阶段：正则主力 + LLM 补刀）。
 *
 * 阶段 A（免费秒出）：对全文跑 enhancedClean 正则清洗——
 *   去页码、去重复页眉页脚、合硬断行、去字间空格、标点全角、压空行。
 * 阶段 B（按需省钱）：只挑"可疑段落"（疑似乱码/超短行/含私用区字符）
 *   发给 LLM 补刀"保正文、删真乱码"，其余正文一字不动。
 *
 * 设计动机：清洗是机械活，正则是强项；只在语义判断（这堆字符是不是乱码、
 * 这段是不是版权声明该删）上才需要 LLM。避免整篇塞给 LLM 导致的慢、贵、
 * 不可靠（尤其推理模型会把 token 全花在"思考"上、输出被吞）。
 */

import type { ILLMAdapter } from './llm/adapter'
import { enhancedClean } from './parsers/textPreprocessor'

export const DEFAULT_CLEAN_PROMPT = `你是文档清洗助手。下面给你的是一段【可能含乱码或断词丢失】的文档片段。请执行：

1. 仅删除真正的乱码：显示为方块(■□)、Unicode 私用区字符、连串无意义符号、损坏的编码字符
2. 恢复竖排拆分丢失的英文词间空格：把因分行被合并、本该分开的英文单词重新用空格断开。
   例如 "Journalof Fujian Normal Uni" 应为 "Journal of Fujian Normal Uni"。
   只断明显是英语单词的粘连，不要拆化学式/编号/缩写（如 ISBN、CO2）。
3. 保留所有正文语义、正常外文术语、人名、参考文献、数字、标点
4. 不要改写、不要补全、不要分句、不要换行、不要输出任何解释

严禁添加内容或删除正文语义。只返回清洗后的纯文本片段。`

/**
 * 根据模型 contextWindow 和 maxTokens 计算推荐的【补刀段】最大字符数。
 *
 * 新架构下 LLM 只处理可疑段落（通常很短），这个值仅用于保证单段不超窗口；
 * 不再有"整篇塞"场景，故移除原先的 2000 字硬上限（那会误切碎可疑段落）。
 *
 * @param userChunkSize 用户手动设定的值，作为参考上限之一
 */
// 约 1.3 字/token（中文）
const CHARS_PER_TOKEN = 1.3

/**
 * 单块字符数硬上限。
 *
 * 经验值：清洗任务的输出长度≈输入，块太大时模型常出现两种极端——
 *   1) 直接原样复读（懒得处理 / maxTokens 装不下等长输出）
 *   2) 把正文当废料大量删除（prompt 让它"删页码/删乱码"，它连正文一起删）
 * 实测同一文档切 11 块（≈2200字/块）能正常清洗，整篇 1 块（24000字）则两端崩。
 * 因此无论用户配置多少，单块都不允许超过这个上限。
 */
const MAX_CHUNK_CHARS = 2000

/**
 * 根据模型 contextWindow 和 maxTokens 计算推荐的分块大小（字符数）。
 *
 * 清洗任务中输入≈输出，分块大小取多个约束的较小值：
 *   1) contextWindow 约束：输入+输出+prompt 不超窗口 → 输入 ≈ 窗口×0.45
 *   2) maxTokens 约束：输出不超过 maxTokens → 输入 ≈ maxTokens×CHARS_PER_TOKEN×0.7
 *      （×0.7 留余量：清洗后输出长度≈输入，避免顶满 maxTokens 被截尾）
 *   3) 硬上限 MAX_CHUNK_CHARS：块太大易触发模型"复读/误删"，必须切小
 *
 * @param userChunkSize 用户手动设定的值，作为参考上限之一（不再无条件采用）
 */
export function getChunkSize(
  contextWindow: number,
  maxTokens?: number,
  userChunkSize?: number
): number {
  const byContext = Math.floor(contextWindow * 0.45 * CHARS_PER_TOKEN)
  let size: number
  if (maxTokens && maxTokens > 0) {
    const byMaxTokens = Math.floor(maxTokens * CHARS_PER_TOKEN * 0.7)
    size = Math.min(byContext, byMaxTokens)
  } else {
    size = byContext
  }
  // 用户配置作为参考上限，但不允许超过硬上限
  if (userChunkSize && userChunkSize > 0) {
    size = Math.min(size, userChunkSize)
  }
  return Math.max(1, size)
}

/**
 * 把超长单段落进一步切分：先按句子边界（。！？及换行），再按字符硬切兜底。
 * 保证返回的每个片段都不超过 maxChars。
 */
function splitLongParagraph(para: string, maxChars: number): string[] {
  // 按句子切分（保留句末标点）
  const sentences = para.match(/[^。！？\n]*[。！？\n]?/g) || [para]
  const pieces: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (buf.length + s.length > maxChars && buf) {
      pieces.push(buf.trim())
      buf = s
    } else {
      buf += s
    }
  }
  if (buf.trim()) pieces.push(buf.trim())

  // 极端情况：单句超长（无标点），按字符硬切
  const result: string[] = []
  for (const p of pieces) {
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) {
        result.push(p.slice(i, i + maxChars))
      }
    } else {
      result.push(p)
    }
  }
  return result
}

/** 按段落边界切分文本，每个 chunk 不超过 maxChars（单段落超长也会再切） */
function splitIntoChunks(text: string, maxChars: number): string[] {
  // 先用双换行分割段落
  const paragraphs = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) {
      chunks.push(current.trim())
      current = ''
    }
  }

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    // 单个段落超过 maxChars，进一步按句子/字符切分
    if (trimmed.length > maxChars) {
      flush()
      for (const piece of splitLongParagraph(trimmed, maxChars)) {
        chunks.push(piece)
      }
      continue
    }

    if (current && current.length + trimmed.length + 2 > maxChars) {
      // 当前块满了，保存并开始新块
      flush()
      current = trimmed
    } else if (current) {
      current += '\n\n' + trimmed
    } else {
      current = trimmed
    }
  }

  flush()
  return chunks
}

export interface CleanProgress {
  current: number
  total: number
  phase: 'chunking' | 'cleaning' | 'done'
}

export interface CleanResult {
  text: string
  stats: {
    originalLength: number
    cleanedLength: number
    chunksUsed: number
    /** 触发兜底回退的块数（清洗结果长度异常，已回退到预处理文本） */
    anomalyChunks: number
    /** 短块用正则降级处理的块数（未调用 LLM） */
    regexChunks: number
  }
}

/**
 * 检测"可疑段落"——需要 LLM 语义判断、正则处理不了的部分。
 *
 * 启发式（命中任一即视为可疑）：
 *   1) 含 Unicode 私用区字符（U+E000~U+F8FF）或常见方块占位符（■□□）
 *   2) 含较多非常规字符：CJK/常见标点/常见外文以外的字符占比 > 15%
 *   3) 含疑似"竖排拆分断词丢失"的粘连小写英文串（如 Journalof）：
 *      连续 ≥6 个小写字母、内部无空格、且不在常见英文单词里。
 *      竖排合成后大小写跳变可补空格（FujianNormal→Fujian Normal），
 *      但全小写衔接（Journal+of）信息已丢失，需 LLM 断词。
 *
 * 其余正文段落一律不发给 LLM（正则已处理干净），节省 token 与时间。
 */
function isSuspiciousParagraph(para: string): boolean {
  if (!para) return false
  // 1. 私用区 / 方块占位符
  if (/[-]/.test(para) || /[■□]/.test(para)) return true

  // 2. 非常规字符占比 > 15%
  //    "常规"= CJK、拉丁、常见标点、数字、空格、换行
  // eslint-disable-next-line no-irregular-whitespace
  const normalRe = /[一-鿿　-〿＀-￯A-Za-z0-9\s.,;:!?，。；：！？、（）【】《》「」『』""''…—-]/g
  const normalCount = (para.match(normalRe) || []).length
  const ratio = 1 - normalCount / para.length
  if (ratio > 0.15) return true

  // 3. 疑似竖排断词丢失：连续 ≥8 个小写字母粘连（前后无空格）。
  //    典型如 "Journalof"（ournalof=8）、"Fujianof" 等，本该是两个词。
  //    注意：会连带把 information(11)、communication(13) 等长单词也判为可疑，
  //    但 prompt 要求 LLM"不拆正常单词"，误判最长单词只是多花点 token、原样返回，不破坏。
  //    取 8 是为抓 "短词+of/the" 这类最常见的竖排断词。
  if (/[a-z]{8,}/.test(para)) return true

  return false
}

/**
 * 清洗文本（纯正则主力，LLM 不再参与改写）。
 *
 * 设计变更（见 plan）：LLM 职责从"改写补刀"改为"审校助手"（见 text-reviewer.ts），
 * 不再产生第二份文本。本函数退化为只跑 enhancedClean 正则。
 * 保留函数签名以兼容现有 IPC 调用；"AI 审校"按钮流程为：先调本函数拿正则结果，
 * 再调 text-reviewer 的 reviewTextWithLLM 标疑点。
 *
 * @param rawText 原始文本（adapter/systemPrompt 等参数保留但不再用于改写，仅兼容签名）
 */
export async function cleanTextWithLLM(
  rawText: string,
  _adapter: ILLMAdapter,
  onProgress?: (p: CleanProgress) => void,
  _systemPrompt?: string,
  _temperature?: number,
  _maxTokens?: number,
  _userChunkSize?: number,
  signal?: AbortSignal
): Promise<CleanResult> {
  onProgress?.({ current: 0, total: 0, phase: 'chunking' })
  if (signal?.aborted) {
    return { text: '', stats: { originalLength: rawText.length, cleanedLength: 0, chunksUsed: 0, anomalyChunks: 0, regexChunks: 0 } }
  }
  const regexCleaned = enhancedClean(rawText)
  onProgress?.({ current: 1, total: 1, phase: 'done' })
  return {
    text: regexCleaned,
    stats: {
      originalLength: rawText.length,
      cleanedLength: regexCleaned.length,
      chunksUsed: 1,
      anomalyChunks: 0,
      regexChunks: 1
    }
  }
}
