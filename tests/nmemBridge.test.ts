import assert from 'node:assert/strict'
import { AI_DEFAULTS } from '../src/aiSettings'
import {
  NmemBridge,
  NmemBridgeError,
  extractNmemSourceId,
  normalizeNmemSourceLabel
} from '../electron/services/ai/nmem-bridge'

const originalFetch = globalThis.fetch

async function run(): Promise<void> {
  console.log('\nnmem bridge')

  try {
    assert.equal(extractNmemSourceId('library:src_64460b18'), 'src_64460b18')
    assert.equal(extractNmemSourceId('src_abc'), 'src_abc')
    assert.equal(extractNmemSourceId('书名 [bookId=x]'), null)
    assert.equal(normalizeNmemSourceLabel('书 [bookId=b1].md'), '书 [bookId=b1]')
    console.log('  ok extractNmemSourceId / normalizeNmemSourceLabel')

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

    // 回归：source=library:src_xxx 必须解析为含 [bookId=] 的 original_name
    {
      const resolveRequests: string[] = []
      globalThis.fetch = async (input) => {
        const url = String(input)
        resolveRequests.push(url)
        if (url.includes('/memories/search')) {
          return Response.json({
            memories: [
              {
                id: 'm-lib',
                content: '托洛茨基相关正文',
                source: 'library:src_64460b18',
                score: 0.88
              }
            ]
          })
        }
        if (url.includes('/sources/src_64460b18')) {
          return Response.json({
            id: 'src_64460b18',
            original_name: '先知三部曲 [bookId=book-trotsky].md',
            lifecycle_state: 'indexed'
          })
        }
        return new Response('{"status":"ok"}')
      }
      const resolveBridge = new NmemBridge(() => AI_DEFAULTS.nmem)
      const resolved = await resolveBridge.search('托洛茨基', 3)
      assert.equal(resolved.length, 1)
      assert.equal(resolved[0].source, '先知三部曲 [bookId=book-trotsky]')
      assert.ok(
        resolveRequests.some((u) => u.includes('/sources/src_64460b18')),
        'must resolve library:src via GET /sources/{id}'
      )
      console.log('  ok resolves library:src_xxx to original_name with bookId')
    }

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

    // listSources：读 original_name + lifecycle_state，并按 offset/limit 翻页拉全量
    {
      const pageRequests: string[] = []
      // 构造 150 条，强制至少 2 页（page size=100）
      const all = Array.from({ length: 150 }, (_, i) => ({
        id: `src_${i}`,
        original_name: `书${i} [bookId=book-${i}].md`,
        lifecycle_state: i === 0 ? 'indexed' : i === 1 ? 'processing' : 'indexed',
        version: i === 1 ? 2 : 1
      }))
      // 再塞一条仅 name 字段的兼容项到第 0 页替换
      all[2] = {
        id: 'src_legacy',
        // @ts-expect-error 故意不写 original_name，测 name 回退
        name: 'legacy-name-only',
        status: 'ready',
        version: 1
      } as (typeof all)[0] & { name: string; status: string }

      globalThis.fetch = async (input) => {
        const url = String(input)
        pageRequests.push(url)
        if (url.includes('/sources?')) {
          const u = new URL(url)
          const offset = Number(u.searchParams.get('offset') || '0')
          const limit = Number(u.searchParams.get('limit') || '50')
          const slice = all.slice(offset, offset + limit)
          return Response.json({ sources: slice, total: all.length })
        }
        return new Response('{"status":"ok"}')
      }
      const listBridge = new NmemBridge(() => AI_DEFAULTS.nmem)
      const sources = await listBridge.listSources()
      assert.equal(sources.length, 150)
      const byId = new Map(sources.map((s) => [s.id, s]))
      assert.equal(byId.get('src_0')?.name, '书0 [bookId=book-0].md')
      assert.equal(byId.get('src_0')?.status, 'ready', 'indexed → ready')
      assert.equal(byId.get('src_1')?.status, 'processing')
      assert.equal(byId.get('src_1')?.version, 2)
      assert.equal(byId.get('src_legacy')?.name, 'legacy-name-only')
      assert.ok(pageRequests.some((u) => u.includes('offset=0')))
      assert.ok(
        pageRequests.some((u) => u.includes('offset=100')),
        'must request second page at offset=100'
      )
      console.log('  ok listSources maps original_name/lifecycle_state and paginates')
    }

    // listSources：API 忽略 offset 反复同一页时不得死循环
    {
      let hits = 0
      globalThis.fetch = async () => {
        hits++
        return Response.json({
          sources: [
            {
              id: 'src_stuck',
              original_name: '卡住 [bookId=x].md',
              lifecycle_state: 'indexed',
              version: 1
            }
          ],
          total: 999
        })
      }
      const stuckBridge = new NmemBridge(() => AI_DEFAULTS.nmem)
      const sources = await stuckBridge.listSources()
      assert.equal(sources.length, 1)
      assert.ok(hits <= 3, `must stop when page yields no new ids (hits=${hits})`)
      console.log('  ok listSources stops when pagination stalls')
    }

    console.log('nmem bridge result: 6 passed')
  } finally {
    globalThis.fetch = originalFetch
  }
}

void run()
