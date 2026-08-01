import assert from 'node:assert/strict'
import axios from 'axios'
import { callEmbedding } from '../electron/services/ai/embedding-caller'
import type { AiEmbeddingSettings } from '../src/global'

const settings: AiEmbeddingSettings = {
  baseUrl: 'https://embed.test/v1',
  apiKey: 'test-key',
  model: 'embed-m',
  batchSize: 2,
  dimension: 0
}

/** 构造一个假的 axios 响应（data.data 已按 index 排好序） */
function okResponse(count: number, dim = 3): unknown {
  return {
    data: {
      data: Array.from({ length: count }, (_, i) => ({
        index: i,
        embedding: Array.from({ length: dim }, (_, k) => (k === i % dim ? 1 : 0))
      }))
    }
  }
}

function httpError(status: number): unknown {
  // axios.isAxiosError 依赖 error.response 存在
  const err: Record<string, unknown> = { isAxiosError: true }
  err.response = { status, data: `server ${status}` }
  // 让 axios.isAxiosError(error) 返回 true
  Object.setPrototypeOf(err, new Error())
  err.name = 'AxiosError'
  err.message = `Request failed with status code ${status}`
  return err
}

function networkError(): unknown {
  const err: Record<string, unknown> = { isAxiosError: true }
  Object.setPrototypeOf(err, new Error())
  err.name = 'AxiosError'
  err.message = 'connect ETIMEDOUT'
  // 无 response → 视为网络层错误，可重试
  return err
}

async function run(): Promise<void> {
  console.log('\nEmbedding caller')

  // 1. 502 首次失败、第二次成功 → 重试后返回向量
  {
    let calls = 0
    const original = axios.post
    let capturedUrl = ''
    let capturedAuth = ''
    ;(axios as unknown as { post: unknown }).post = async (
      url: string,
      _body: unknown,
      config: { headers: Record<string, string> }
    ) => {
      capturedUrl = url
      capturedAuth = config.headers.Authorization
      calls++
      if (calls === 1) throw httpError(502)
      return okResponse(1)
    }
    try {
      // 缩短退避间隔：临时覆盖 Promise 延时不可行，直接用最小批次
      const result = await callEmbedding(['hello'], settings)
      assert.equal(calls, 2, 'should retry once after 502')
      assert.equal(result.vectors.length, 1)
      assert.equal(result.dimension, 3)
      assert.equal(capturedUrl, 'https://embed.test/v1/embeddings')
      assert.equal(capturedAuth, 'Bearer test-key')
      console.log('  ok 502 retried then succeeded')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  // 2. 429 重试成功
  {
    let calls = 0
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      calls++
      if (calls < 3) throw httpError(429)
      return okResponse(1, 4)
    }
    try {
      const result = await callEmbedding(['x'], settings)
      assert.equal(calls, 3, 'should retry 429 twice then succeed')
      assert.equal(result.dimension, 4)
      console.log('  ok 429 retried then succeeded')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  // 3. 4xx（非 429）不重试，直接抛错且信息带状态码
  {
    let calls = 0
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      calls++
      throw httpError(401)
    }
    try {
      await assert.rejects(
        callEmbedding(['x'], settings),
        (e: unknown) => e instanceof Error && /HTTP 401/.test(e.message)
      )
      assert.equal(calls, 1, 'should not retry on 4xx')
      console.log('  ok 4xx not retried, error carries status')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  // 4. 网络层错误（无 response）重试后成功
  {
    let calls = 0
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      calls++
      if (calls === 1) throw networkError()
      return okResponse(1)
    }
    try {
      const result = await callEmbedding(['x'], settings)
      assert.equal(calls, 2)
      assert.equal(result.vectors.length, 1)
      console.log('  ok network error retried then succeeded')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  // 5. 持续 502 达到重试上限 → 抛错
  {
    let calls = 0
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      calls++
      throw httpError(503)
    }
    try {
      await assert.rejects(
        callEmbedding(['x'], settings),
        (e: unknown) => e instanceof Error && /HTTP 503/.test(e.message)
      )
      assert.equal(calls, 4, 'should exhaust retries (4 attempts)')
      console.log('  ok persistent 5xx exhausts retries then throws')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  // 6. 取消信号立即中止（不重试）
  {
    const ac = new AbortController()
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      ac.abort()
      throw new Error('cancelled')
    }
    try {
      await assert.rejects(
        callEmbedding(['x'], settings, ac.signal),
        (e: unknown) => e instanceof Error && /cancelled/i.test(e.message)
      )
      console.log('  ok abort signal stops retry')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
    }
  }

  console.log('Embedding caller result: 6 passed')
}

void run()
