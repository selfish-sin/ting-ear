import assert from 'node:assert/strict'
import {
  AiServiceError,
  listModels,
  resolveAxiosProxyConfig,
  sanitizeProxyUrl,
  streamChat
} from '../electron/services/ai/llm-caller'
import type { AiLlmSettings, AiPromptMessage } from '../src/global'

const originalFetch = globalThis.fetch

const config: AiLlmSettings = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'primary-model',
  fallbackModel: 'fallback-model',
  temperature: 0.3,
  timeoutMs: 5000
}

const messages: AiPromptMessage[] = [{ role: 'user', content: '你好' }]

function sseResponse(parts: string[], status = 200): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part))
        controller.close()
      }
    }),
    { status, headers: { 'content-type': 'text/event-stream' } }
  )
}

async function collect(
  signal = new AbortController().signal,
  settings: AiLlmSettings = config
): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of streamChat(settings, messages, signal)) chunks.push(chunk)
  return chunks
}

async function run(): Promise<void> {
  console.log('\nLLM caller')

  try {
    let modelRequest: { url: string; authorization?: string } | null = null
    globalThis.fetch = async (input, init) => {
      modelRequest = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') || undefined
      }
      return Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] })
    }
    assert.deepEqual(await listModels(config), ['model-a', 'model-b'])
    assert.equal(modelRequest?.url, 'https://example.test/v1/models')
    assert.equal(modelRequest?.authorization, 'Bearer test-key')
    console.log('  ok fetches and normalizes OpenAI-compatible model lists')

    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n',
        '\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    }

    assert.deepEqual(await collect(), ['你', '好'])
    assert.equal(requestBodies[0].model, 'primary-model')
    console.log('  ok parses split SSE chunks')

    let attempt = 0
    globalThis.fetch = async (_input, init) => {
      attempt += 1
      const body = JSON.parse(String(init?.body)) as { model: string }
      if (attempt === 1) {
        assert.equal(body.model, 'primary-model')
        return new Response('model unavailable', { status: 500 })
      }
      assert.equal(body.model, 'fallback-model')
      return sseResponse(['data: {"choices":[{"delta":{"content":"备用"}}]}\n\n', 'data: [DONE]\n\n'])
    }

    assert.deepEqual(await collect(), ['备用'])
    console.log('  ok retries once with the fallback model')

    globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
    await assert.rejects(
      () => collect(),
      (error: unknown) => error instanceof AiServiceError && error.code === 'auth_failed'
    )
    console.log('  ok classifies authentication failures')

    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('aborted', 'AbortError')),
              { once: true }
            )
          }
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }
    await assert.rejects(
      () => collect(new AbortController().signal, { ...config, fallbackModel: '', timeoutMs: 5 }),
      (error: unknown) => error instanceof AiServiceError && error.code === 'timeout'
    )
    console.log('  ok classifies timeouts that happen while reading the stream')

    globalThis.fetch = async () =>
      sseResponse([
        'data: {"error":{"message":"model rejected the request","type":"model_error"}}\n\n',
        'data: [DONE]\n\n'
      ])
    await assert.rejects(
      () => collect(new AbortController().signal, { ...config, fallbackModel: '' }),
      (error: unknown) =>
        error instanceof AiServiceError &&
        error.code === 'model_error' &&
        /model rejected/.test(error.message)
    )
    console.log('  ok rejects HTTP-200 streamed API error envelopes')

    globalThis.fetch = async () =>
      sseResponse(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: [DONE]\n\n'])
    await assert.rejects(
      () => collect(),
      (error: unknown) => error instanceof AiServiceError && error.code === 'invalid_response'
    )
    console.log('  ok rejects streams that complete without answer content')

    // 代理 env 带引号时必须能清洗，否则 axios 会 Invalid URL
    assert.equal(sanitizeProxyUrl('"http://127.0.0.1:7897"'), 'http://127.0.0.1:7897')
    assert.equal(sanitizeProxyUrl("'http://127.0.0.1:7897'"), 'http://127.0.0.1:7897')
    assert.equal(sanitizeProxyUrl('http://127.0.0.1:7897'), 'http://127.0.0.1:7897')
    assert.equal(sanitizeProxyUrl(''), null)
    assert.equal(sanitizeProxyUrl('http://'), null)
    assert.equal(sanitizeProxyUrl('socks5://127.0.0.1:1080'), null)
    const prevHttps = process.env.HTTPS_PROXY
    const prevHttp = process.env.HTTP_PROXY
    try {
      process.env.HTTPS_PROXY = '"http://127.0.0.1:7897"'
      process.env.HTTP_PROXY = '"http://127.0.0.1:7897"'
      const proxy = resolveAxiosProxyConfig()
      assert.ok(proxy)
      assert.equal(proxy?.host, '127.0.0.1')
      assert.equal(proxy?.port, 7897)
      assert.equal(proxy?.protocol, 'http')
    } finally {
      if (prevHttps === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prevHttps
      if (prevHttp === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = prevHttp
    }
    console.log('  ok sanitizes quoted proxy env vars for axios')

    console.log('LLM caller result: 8 passed')
  } finally {
    globalThis.fetch = originalFetch
  }
}

void run()
