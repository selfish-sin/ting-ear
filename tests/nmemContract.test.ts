import assert from 'node:assert/strict'
import { AI_DEFAULTS } from '../src/aiSettings'
import { NmemBridge, NmemBridgeError } from '../electron/services/ai/nmem-bridge'

const originalFetch = globalThis.fetch

async function run(): Promise<void> {
  console.log('\nnmem contract validation')
  const bridge = new NmemBridge(() => AI_DEFAULTS.nmem)

  try {
    globalThis.fetch = async () => Response.json({ memories: [{ id: 42, content: '正文' }] })
    assert.deepEqual(await bridge.search('问题', 1), [
      { id: '42', content: '正文', source: '', score: 0 }
    ])
    console.log('  ok normalizes optional memory fields')

    globalThis.fetch = async () => Response.json({ unexpected: [] })
    await assert.rejects(
      () => bridge.search('问题', 1),
      (error: unknown) => error instanceof NmemBridgeError && error.code === 'invalid_response'
    )

    globalThis.fetch = async () => Response.json({ source_id: 123, is_duplicate: true })
    assert.deepEqual(
      await bridge.ingestContent({ content: '正文', name: '测试章', sourceType: 'text' }),
      { sourceId: '123', isDuplicate: true }
    )
    console.log('  ok rejects malformed responses and normalizes ingest results')

    console.log('nmem contract result: 2 passed')
  } finally {
    globalThis.fetch = originalFetch
  }
}

void run()
