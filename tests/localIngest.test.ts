import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import axios from 'axios'
import { ingestBookLocal } from '../electron/services/ai/local-ingest'
import { loadVectors } from '../electron/services/ai/vector-store'
import type { AiEmbeddingSettings, BookData } from '../src/global'

const settings: AiEmbeddingSettings = {
  baseUrl: 'https://embed.test/v1',
  apiKey: 'test-key',
  model: 'embed-m',
  batchSize: 2,
  dimension: 0
}

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
  const err: Record<string, unknown> = { isAxiosError: true }
  err.response = { status, data: `server ${status}` }
  Object.setPrototypeOf(err, new Error())
  err.name = 'AxiosError'
  err.message = `Request failed with status code ${status}`
  return err
}

/** 构造一本能切出多个 chunk 的书（每句足够长，确保跨多个 800 字块） */
function makeBook(): BookData {
  // 80 句 × 约 45 字 ≈ 3600 字 → 约 4~5 个 chunk（CHUNK_SIZE=800）
  const longSentence = '这是一段足够长的句子用来确保分块时超过八百字阈值从而产生多个独立的文本块。'
  return {
    id: 'ingest-test-book',
    title: '测试书',
    author: '',
    sentences: Array.from({ length: 80 }, (_, i) => `${longSentence}（第${i + 1}句）`),
    chapters: [{ startIndex: 0, sentenceCount: 80, title: '第一章' }],
    structureMeta: { version: 4, contentHash: 'testhash' }
  } as unknown as BookData
}

async function run(): Promise<void> {
  console.log('\nLocal ingest (partial failure)')

  // 第 2 批持续 503 → callEmbedding 重试 4 次仍失败 → local-ingest 跳过该批，
  // 但第 1 批的向量仍应被保存到文件，整本不抛错。
  {
    let calls = 0
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      calls++
      // 第 1、3 次调用（第 1 批的两轮重试里只有首轮真实发起，这里按"第几次调用"计数）
      // 简化：让前两次成功（第 1 批），之后全部 503（第 2 批重试耗尽）
      if (calls <= 1) return okResponse(2)
      throw httpError(503)
    }
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-'))
    try {
      const getDir = () => root
      const progresses: { phase: string; skipped?: number }[] = []
      const data = await ingestBookLocal(makeBook(), settings, getDir, (p) => {
        progresses.push({ phase: p.phase, skipped: p.skipped })
      })

      // 第 1 批成功 → 至少有 2 块向量；第 2 批全部失败被跳过
      assert.ok(data.chunks.length >= 2, `expected >=2 chunks saved, got ${data.chunks.length}`)
      assert.equal(data.dimension, 3)

      // 进度中应有 skipped > 0 的 embedding 事件
      const skippedEvent = progresses.find((p) => p.phase === 'embedding' && p.skipped && p.skipped > 0)
      assert.ok(skippedEvent, `should emit embedding progress with skipped count, got: ${JSON.stringify(progresses)}`)

      // 文件落盘且可读回
      const reloaded = await loadVectors(getDir, 'ingest-test-book')
      assert.ok(reloaded, 'vectors file should be persisted')
      assert.ok((reloaded?.chunks.length ?? 0) >= 2)
      console.log(`  ok partial batch failure: ${data.chunks.length} chunks saved, ${skippedEvent?.skipped} skipped`)
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
      rmSync(root, { recursive: true, force: true })
    }
  }

  // 全部批次持续失败 → 抛错，不写空文件
  {
    const original = axios.post
    ;(axios as unknown as { post: unknown }).post = async () => {
      throw httpError(503)
    }
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-ingest-'))
    try {
      const getDir = () => root
      await assert.rejects(
        ingestBookLocal(makeBook(), settings, getDir),
        (e: unknown) => e instanceof Error && /嵌入服务持续不可用|HTTP 503/.test(e.message)
      )
      const reloaded = await loadVectors(getDir, 'ingest-test-book')
      assert.equal(reloaded, null, 'should not write vector file when all batches fail')
      console.log('  ok all batches fail → throws, no file written')
    } finally {
      ;(axios as unknown as { post: unknown }).post = original
      rmSync(root, { recursive: true, force: true })
    }
  }

  console.log('Local ingest result: 2 passed')
}

void run()
