/**
 * 内置 AI 工具注册表：把听伴已有能力暴露为 OpenAI function tools，
 * 供 agent 循环被模型真实 tool_call 调用（而非只做预检索摆设）。
 */
import type {
  AiPromptMessage,
  AiSettings,
  AiSourceRef,
  AiWebSourceRef
} from '../../../src/global'
import { detectProvider } from '../../../src/aiProvider'
import { resolveWebSearchHttpBackend } from '../../../src/webSearch'
import { webSearch, type WebSearchResult } from './web-search-service'
import { semanticScholarSearch } from './semantic-scholar-service'
import { sciverseMetaSearch } from './sciverse-service'
import type { NmemMemory } from './nmem-bridge'
import { buildSourceRefs, toWebSourceRefs } from './source-utils'

export interface OpenAiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolExecutionContext {
  settings: AiSettings
  signal: AbortSignal
  bookId?: string
  bookTitle?: string
  currentChapterIndex?: number
  retrieve?: (
    query: string,
    limit: number,
    signal: AbortSignal,
    options: {
      bookId?: string
      chapterIndex?: number
      category?: 'chapter' | 'book_wide' | 'general' | 'selection' | 'current_sentence' | 'greeting'
    }
  ) => Promise<NmemMemory[]>
}

export interface ToolExecutionResult {
  /** 回填模型的 tool 消息正文 */
  content: string
  sources?: AiSourceRef[]
  webSources?: AiWebSourceRef[]
  webSearchUsed?: boolean
}

export const BUILTIN_TOOL_NAMES = {
  searchBook: 'search_book',
  webSearch: 'web_search',
  semanticScholar: 'semantic_scholar',
  sciverse: 'sciverse'
} as const

const RESULT_CHAR_LIMIT = 8000

function findZhipuConfig(settings: AiSettings): { apiKey: string; baseUrl?: string } | null {
  const dedicated = settings.webSearch?.zhipuApiKey?.trim()
  if (dedicated) {
    return {
      apiKey: dedicated,
      baseUrl: settings.webSearch?.zhipuBaseUrl?.trim() || 'https://open.bigmodel.cn/api/paas/v4'
    }
  }
  const engine = settings.engines?.find(
    (e) => (e.provider || detectProvider(e.baseUrl)) === 'zhipu' && e.apiKey
  )
  if (engine) return { apiKey: engine.apiKey, baseUrl: engine.baseUrl }
  return null
}

function findOllamaConfig(
  settings: AiSettings
): { apiKey: string; baseUrl?: string } | null {
  const key = settings.webSearch?.ollamaApiKey?.trim()
  if (!key) return null
  return {
    apiKey: key,
    baseUrl: settings.webSearch?.ollamaBaseUrl?.trim() || 'https://ollama.com'
  }
}

function clip(text: string, max = RESULT_CHAR_LIMIT): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…(已截断，共 ${text.length} 字)`
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return { query: raw }
  }
}

function queryOf(args: Record<string, unknown>): string {
  const q = args.query ?? args.q ?? args.keyword ?? args.text
  return typeof q === 'string' ? q.trim() : ''
}

/** 根据设置开关，生成当前可用的内置 OpenAI tools 定义 */
export function listBuiltinToolDefs(settings: AiSettings): OpenAiToolDef[] {
  const tools: OpenAiToolDef[] = []

  if (settings.retrieval?.enabled) {
    tools.push({
      type: 'function',
      function: {
        name: BUILTIN_TOOL_NAMES.searchBook,
        description:
          '在当前正在阅读的书籍知识库中检索相关段落（本地向量 + nmem）。回答书中内容、情节、概念、作者观点时优先调用。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '检索查询，可用中文关键词或问题改写'
            },
            chapter_only: {
              type: 'boolean',
              description: '为 true 时只在当前章节内检索'
            }
          },
          required: ['query']
        }
      }
    })
  }

  if (settings.webSearch?.enabled) {
    tools.push({
      type: 'function',
      function: {
        name: BUILTIN_TOOL_NAMES.webSearch,
        description:
          '联网搜索公开网页信息（Ollama Cloud / 智谱 / DuckDuckGo）。需要最新事实、背景补充、书外资料时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词或问题' }
          },
          required: ['query']
        }
      }
    })
  }

  if (settings.webSearch?.academicEnabled) {
    tools.push({
      type: 'function',
      function: {
        name: BUILTIN_TOOL_NAMES.semanticScholar,
        description:
          'Semantic Scholar 学术论文检索（标题/摘要/引用）。查论文、学者、学术定义时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '学术检索查询（中英文均可）' }
          },
          required: ['query']
        }
      }
    })
  }

  if (settings.webSearch?.sciverseEnabled && settings.webSearch?.sciverseApiKey?.trim()) {
    tools.push({
      type: 'function',
      function: {
        name: BUILTIN_TOOL_NAMES.sciverse,
        description:
          'SciVerse 学术元搜索（标题/DOI/年份/期刊）。需要结构化论文元数据时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '学术检索查询' }
          },
          required: ['query']
        }
      }
    })
  }

  return tools
}

export function isBuiltinTool(name: string): boolean {
  return Object.values(BUILTIN_TOOL_NAMES).includes(name as (typeof BUILTIN_TOOL_NAMES)[keyof typeof BUILTIN_TOOL_NAMES])
}

export async function executeBuiltinTool(
  name: string,
  argumentsJson: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const args = parseArgs(argumentsJson)
  const query = queryOf(args)
  if (!query) {
    return { content: JSON.stringify({ error: '缺少 query 参数' }) }
  }

  const maxResults = Math.min(10, Math.max(1, ctx.settings.webSearch?.maxResults ?? 5))
  const topK = Math.min(20, Math.max(1, ctx.settings.retrieval?.topK ?? 6))

  if (name === BUILTIN_TOOL_NAMES.searchBook) {
    if (!ctx.retrieve) {
      return { content: JSON.stringify({ error: '书内检索未接线' }) }
    }
    if (!ctx.settings.retrieval?.enabled) {
      return { content: JSON.stringify({ error: '书内检索已关闭' }) }
    }
    const chapterOnly = Boolean(args.chapter_only)
    try {
      const memories = await ctx.retrieve(query, topK, ctx.signal, {
        bookId: ctx.bookId,
        chapterIndex: ctx.currentChapterIndex,
        category: chapterOnly ? 'chapter' : 'book_wide'
      })
      const sources = buildSourceRefs(memories, {
        bookId: ctx.bookId,
        currentChapterIndex: Math.max(0, ctx.currentChapterIndex ?? 0),
        category: chapterOnly ? 'chapter' : 'book_wide'
      })
      if (sources.length === 0) {
        const hint =
          memories.length > 0
            ? `知识库返回了 ${memories.length} 条片段，但来源标签无法匹配当前书籍（bookId=${ctx.bookId || '无'}）。请重建本地知识库，或检查 nmem 源名是否含 [bookId=…]。`
            : '未检索到书内片段。可尝试：1) AI 面板点「知识库」建立本地向量；2) 确认 nmem 在线且本书已同步；3) 换更具体的关键词。'
        return {
          content: JSON.stringify({
            count: 0,
            results: [],
            hint,
            raw_hits: memories.length
          }),
          sources: []
        }
      }
      const payload = {
        count: sources.length,
        results: sources.map((s) => ({
          index: s.index,
          chapter: s.chapterTitle,
          score: s.score,
          content: s.content.slice(0, 1200)
        }))
      }
      return {
        content: clip(JSON.stringify(payload, null, 0)),
        sources
      }
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  if (name === BUILTIN_TOOL_NAMES.webSearch) {
    if (!ctx.settings.webSearch?.enabled) {
      return { content: JSON.stringify({ error: '联网搜索已关闭' }) }
    }
    try {
      const preferred = resolveWebSearchHttpBackend(ctx.settings)
      const results = await webSearch(query, {
        maxResults,
        signal: ctx.signal,
        preferred,
        ollama: findOllamaConfig(ctx.settings),
        zhipu: findZhipuConfig(ctx.settings)
      })
      return formatWebToolResult(results, '联网搜索')
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          hint: '联网搜索失败。请检查 Ollama/智谱 Key 与网络；可在设置中切换搜索后端。'
        }),
        webSearchUsed: true
      }
    }
  }

  if (name === BUILTIN_TOOL_NAMES.semanticScholar) {
    if (!ctx.settings.webSearch?.academicEnabled) {
      return { content: JSON.stringify({ error: 'Semantic Scholar 已关闭' }) }
    }
    try {
      const results = await semanticScholarSearch(query, {
        maxResults: Math.min(5, maxResults),
        signal: ctx.signal,
        apiKey: ctx.settings.webSearch?.semanticScholarApiKey
      })
      return formatWebToolResult(results, 'Semantic Scholar')
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }),
        webSearchUsed: true
      }
    }
  }

  if (name === BUILTIN_TOOL_NAMES.sciverse) {
    if (!ctx.settings.webSearch?.sciverseEnabled || !ctx.settings.webSearch?.sciverseApiKey?.trim()) {
      return { content: JSON.stringify({ error: 'SciVerse 未启用或未配置 Key' }) }
    }
    try {
      const results = await sciverseMetaSearch(query, {
        maxResults: Math.min(5, maxResults),
        signal: ctx.signal,
        apiKey: ctx.settings.webSearch.sciverseApiKey!,
        baseUrl: ctx.settings.webSearch.sciverseBaseUrl
      })
      return formatWebToolResult(results, 'SciVerse')
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }),
        webSearchUsed: true
      }
    }
  }

  return { content: JSON.stringify({ error: `未知内置工具: ${name}` }) }
}

function formatWebToolResult(
  results: WebSearchResult[],
  channelLabel = '外部检索'
): ToolExecutionResult {
  const webSources = toWebSourceRefs(results)
  if (results.length === 0) {
    return {
      content: JSON.stringify({
        count: 0,
        results: [],
        hint: `${channelLabel}无结果。请检查：Ollama/智谱 Key 是否有效、网络是否可达；DuckDuckGo 在部分网络会超时。可在「设置 → AI → 工具服务」切换搜索后端。`
      }),
      webSources: [],
      // 已真实发起过检索请求，即使 0 条也算「用过」
      webSearchUsed: true
    }
  }
  const payload = {
    count: results.length,
    results: results.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      provider: r.provider,
      sourceType: r.sourceType
    }))
  }
  return {
    content: clip(JSON.stringify(payload, null, 0)),
    webSources,
    webSearchUsed: true
  }
}

/** 注入 system 提示：告诉模型可用工具 */
export function toolsSystemPrompt(toolNames: string[]): AiPromptMessage | null {
  if (toolNames.length === 0) return null
  return {
    role: 'system',
    content:
      '你可以使用工具获取证据。需要书中原文时调用 search_book；需要网络事实时调用 web_search；' +
      '需要学术论文时调用 semantic_scholar 或 sciverse；外部 MCP 工具（如 Zotero）名称以 mcp_ 开头。' +
      '先判断是否需要工具，再回答。引用书内证据用 [N]，网络/学术用来源标题或链接。' +
      `当前可用工具：${toolNames.join(', ')}。`
  }
}
