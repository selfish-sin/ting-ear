import assert from 'node:assert/strict'
import { AI_DEFAULTS } from '../src/aiSettings'
import { NmemBridge, NmemBridgeError } from '../electron/services/ai/nmem-bridge'

const originalFetch = globalThis.fetch

async function run(): Promise<void> {
  console.log('\nnmem bridge')

  try {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      if (String(input).endsWith('/health')) return new Response('{"status":"ok"}')
      if (String(input).includes('/memories/search')) {
        return Response.json({
          memories: [
            {
              id: 'memory-1',
              content: '检索到的正文',
              source: '[bookId=book-1][ch=2] 第三章',
              score: 0.91
            }
          ]
        })
      }
      return Response.json({ source_id: 'source-1', is_duplicate: false })
    }

    const bridge = new NmemBridge(() => AI_DEFAULTS.nmem)
    assert.equal((await bridge.checkHealth({ force: true })).status, 'online')
    assert.deepEqual(await bridge.search('辩证法 是什么', 4), [
      {
        id: 'memory-1',
        content: '检索到的正文',
        source: '[bookId=book-1][ch=2] 第三章',
        score: 0.91
      }
    ])
    const searchUrl = new URL(requests[1].url)
    assert.equal(`${searchUrl.origin}${searchUrl.pathname}`, `${AI_DEFAULTS.nmem.baseUrl}/memories/search`)
    assert.equal(searchUrl.searchParams.get('q'), '辩证法 是什么')
    assert.equal(searchUrl.searchParams.get('limit'), '4')

    const ingestResult = await bridge.ingestContent({
      content: '本章正文',
      name: '[bookId=book-1][ch=2] 第三章',
      sourceType: 'text'
    })
    assert.deepEqual(ingestResult, { sourceId: 'source-1', isDuplicate: false })
    assert.equal(requests[2].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {
      content: '本章正文',
      name: '[bookId=book-1][ch=2] 第三章',
      source_type: 'text'
    })
    console.log('  ok follows the health, search, and ingest HTTP contract')

    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await assert.rejects(
      () => bridge.search('问题', 2),
      (error: unknown) => error instanceof NmemBridgeError && error.code === 'nmem_offline'
    )
    console.log('  ok classifies connection failures as offline')

    const recoveryBridge = new NmemBridge(() => ({
      ...AI_DEFAULTS.nmem,
      statusCacheMs: 60000
    }))
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await assert.rejects(() => recoveryBridge.checkHealth({ force: true }))
    globalThis.fetch = async () => Response.json({ memories: [] })
    await recoveryBridge.search('恢复连接', 1)
    assert.equal((await recoveryBridge.checkHealth()).status, 'online')
    console.log('  ok clears a cached offline status after a successful search')

    const timeoutBridge = new NmemBridge(() => ({
      ...AI_DEFAULTS.nmem,
      healthTimeoutMs: 5
    }))
    globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        )
      })
    await assert.rejects(
      () => timeoutBridge.checkHealth({ force: true }),
      (error: unknown) => error instanceof NmemBridgeError && error.code === 'timeout'
    )
    console.log('  ok enforces the configured timeout')

    console.log('nmem bridge result: 4 passed')
  } finally {
    globalThis.fetch = originalFetch
  }
}

void run()
