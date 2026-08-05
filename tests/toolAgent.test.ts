import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_DEFAULTS, mergeAiSettings } from '../src/aiSettings'
import {
  listBuiltinToolDefs,
  executeBuiltinTool,
  isBuiltinTool
} from '../electron/services/ai/tool-registry'
import { extractStreamMeta, streamPartFromData } from '../electron/services/ai/llm-caller'
import { exposeMcpToolName, mergeMcpServers } from '../electron/services/ai/mcp-host'
import { healMcpServerConfig, isMcpServerConfigured } from '../src/aiSettings'
import { JsonAiHistoryRepository } from '../electron/services/ai/ai-history'
import { AiService } from '../electron/services/ai/ai-service'
import type { AiHistoryMessage, AiPromptMessage, AiLlmSettings } from '../src/global'
import type { StreamPart } from '../electron/services/ai/llm-caller'

console.log('\nTool agent + MCP host + conv ensure')

// --- builtin tools ---
{
  const allOff = mergeAiSettings({
    retrieval: { enabled: false },
    webSearch: { enabled: false, academicEnabled: false, sciverseEnabled: false }
  })
  assert.equal(listBuiltinToolDefs(allOff).length, 0)

  const allOn = mergeAiSettings({
    retrieval: { enabled: true },
    webSearch: {
      enabled: true,
      academicEnabled: true,
      sciverseEnabled: true,
      sciverseApiKey: 'sci_test'
    }
  })
  const names = listBuiltinToolDefs(allOn).map((t) => t.function.name)
  assert.deepEqual(
    names.sort(),
    ['search_book', 'semantic_scholar', 'sciverse', 'web_search'].sort()
  )
  assert.equal(isBuiltinTool('search_book'), true)
  assert.equal(isBuiltinTool('mcp_zotero_x'), false)
  console.log('  ok builtin tool defs respect switches')
}

// --- stream tool_calls meta ---
{
  const meta = extractStreamMeta(
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'web_search', arguments: '{"q' }
              }
            ]
          }
        }
      ]
    })
  )
  assert.equal(meta.toolCallDeltas?.[0]?.name, 'web_search')
  assert.equal(meta.toolCallDeltas?.[0]?.arguments, '{"q')

  const finish = extractStreamMeta(
    JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }] })
  )
  assert.equal(finish.finishReason, 'tool_calls')

  assert.equal(
    streamPartFromData(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }
              ]
            }
          }
        ]
      })
    ),
    null
  )
  console.log('  ok stream tool_calls meta parsing')
}

// --- MCP name + templates ---
{
  assert.equal(exposeMcpToolName('zotero', 'search_items'), 'mcp_zotero_search_items')
  const merged = mergeMcpServers([])
  assert.ok(merged.some((s) => s.id === 'zotero' && s.enabled === false))
  const withCustom = mergeMcpServers([
    {
      id: 'custom',
      name: 'C',
      enabled: true,
      transport: 'http',
      url: 'http://127.0.0.1:9'
    }
  ])
  assert.ok(withCustom.some((s) => s.id === 'zotero'))
  assert.ok(withCustom.some((s) => s.id === 'custom'))
  console.log('  ok MCP expose names + default zotero template')
}

// --- settings merge defaults ---
{
  const m = mergeAiSettings({})
  assert.equal(m.agent.mode, 'auto')
  assert.equal(m.agent.maxToolRounds, 4)
  assert.equal(m.mcp.enabled, false)
  assert.ok(m.mcp.servers.some((s) => s.id === 'zotero'))
  console.log('  ok agent/mcp defaults in mergeAiSettings')
}

// --- MCP 坏配置自愈：http + 空 url 的 zotero 应回到 stdio+uvx ---
{
  const healed = healMcpServerConfig({
    id: 'zotero',
    name: 'Zotero MCP',
    enabled: true,
    transport: 'http',
    command: 'uvx',
    args: ['zotero-mcp'],
    url: '',
    env: {},
    timeoutMs: 30000
  })
  assert.equal(healed.transport, 'stdio')
  assert.equal(healed.command, 'uvx')
  assert.ok(isMcpServerConfigured(healed).ok)

  const brokenHttp = healMcpServerConfig({
    id: 'custom',
    name: 'C',
    enabled: true,
    transport: 'http',
    url: '',
    command: '',
    args: [],
    env: {}
  })
  assert.equal(isMcpServerConfigured(brokenHttp).ok, false)

  const merged = mergeAiSettings({
    mcp: {
      enabled: true,
      servers: [
        {
          id: 'zotero',
          name: 'Zotero MCP',
          enabled: false,
          transport: 'http',
          url: '',
          command: 'uvx',
          args: ['zotero-mcp']
        }
      ]
    }
  })
  const z = merged.mcp.servers.find((s) => s.id === 'zotero')
  assert.ok(z)
  assert.equal(z!.transport, 'stdio', 'merge must heal zotero http+empty url')
  console.log('  ok MCP heal broken http/empty-url configs')
}

// --- ensureActiveConversation ---
{
  const dir = mkdtempSync(join(tmpdir(), 'ting-ear-conv-ensure-'))
  try {
    const history = new JsonAiHistoryRepository(dir)
    const a = history.ensureActiveConversation('book-1')
    const b = history.ensureActiveConversation('book-1')
    assert.equal(a.id, b.id)
    history.createConversation('book-1', '新对话')
    history.createConversation('book-1', '新对话')
    const listed = history.listConversations('book-1')
    const emptyNew = listed.conversations.filter(
      (c) => c.title === '新对话' && c.messageCount === 0
    )
    assert.ok(emptyNew.length <= 1, `expected <=1 empty 新对话, got ${emptyNew.length}`)
    const ensured = history.ensureActiveConversation('book-1')
    assert.ok(ensured.id)
    history.flushSync()
    console.log('  ok ensureActiveConversation + prune empty 新对话')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function runAgentLoopTest(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ting-ear-agent-'))
  try {
    const history = new JsonAiHistoryRepository(dir)
    const events: Array<{ channel: string; payload: Record<string, unknown> }> = []
    let streamRound = 0

    async function* mockStream(
      _config: AiLlmSettings,
      messages: AiPromptMessage[],
      _signal: AbortSignal,
      toolsOrOptions?: unknown
    ): AsyncGenerator<StreamPart> {
      streamRound += 1
      const hasTools =
        (Array.isArray(toolsOrOptions) && toolsOrOptions.length > 0) ||
        (toolsOrOptions &&
          typeof toolsOrOptions === 'object' &&
          Array.isArray((toolsOrOptions as { tools?: unknown[] }).tools) &&
          ((toolsOrOptions as { tools: unknown[] }).tools?.length || 0) > 0)

      if (streamRound === 1 && hasTools) {
        yield {
          toolCalls: [
            {
              id: 'call_web_1',
              name: 'web_search',
              arguments: JSON.stringify({ query: '测试查询' })
            }
          ],
          finishReason: 'tool_calls'
        }
        return
      }
      const hasToolMsg = messages.some((m) => m.role === 'tool')
      assert.equal(hasToolMsg, true, 'second round should include tool result')
      yield { text: '根据搜索结果：答案' }
    }

    const service = new AiService({
      getSettings: () =>
        mergeAiSettings({
          ...AI_DEFAULTS,
          agent: { mode: 'tools', maxToolRounds: 4 },
          retrieval: { enabled: false },
          webSearch: {
            enabled: true,
            academicEnabled: false,
            sciverseEnabled: false,
            backend: 'none'
          },
          engines: [
            {
              id: 'default',
              name: 't',
              baseUrl: 'https://example.test/v1',
              apiKey: 'k',
              model: 'm',
              fallbackModel: '',
              temperature: 0.3,
              timeoutMs: 5000
            }
          ]
        }),
      history,
      stream: mockStream
    })

    const userMessages: AiHistoryMessage[] = [
      { id: 'u1', role: 'user', content: '帮我搜一下测试查询' }
    ]
    history.createConversation('book-agent', '测试')
    const conv = history.listConversations('book-agent')
    await service.chat(
      'req-1',
      {
        bookId: 'book-agent',
        bookTitle: '测试书',
        conversationId: conv.activeId || undefined,
        messages: userMessages
      },
      {
        send: (channel, payload) => {
          events.push({ channel, payload })
        }
      }
    )

    const done = events.find((e) => e.channel === 'ai:chat:done')
    assert.ok(done, 'should emit done')
    assert.equal(done.payload.cancelled, false)

    const chunks = events.filter((e) => e.channel === 'ai:chat:chunk')
    const text = chunks.map((c) => String(c.payload.text || '')).join('')
    assert.match(text, /根据搜索结果/)
    assert.ok(streamRound >= 2, `expected >=2 stream rounds, got ${streamRound}`)
    history.flushSync()
    console.log('  ok agent loop executes tool_call then answers')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function runBuiltinValidate(): Promise<void> {
  const result = await executeBuiltinTool('web_search', '{}', {
    settings: mergeAiSettings({ webSearch: { enabled: true, backend: 'none' } }),
    signal: new AbortController().signal
  })
  assert.match(result.content, /query/)
  console.log('  ok executeBuiltinTool validates query')
}

void (async () => {
  await runBuiltinValidate()
  await runAgentLoopTest()
  console.log('Tool agent result: passed')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
