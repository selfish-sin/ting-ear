import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encodeVec,
  decodeVec,
  saveVectors,
  searchVectors,
  searchBookVectors,
  getCachedVectors,
  invalidateVectorCache,
  assertVectorCompat,
  VectorCompatError,
  type VectorBookData
} from '../electron/services/ai/vector-store'

function book(
  overrides: Partial<VectorBookData> & { chunks?: VectorBookData['chunks'] } = {}
): VectorBookData {
  return {
    bookId: 'book-x',
    model: 'embed-test',
    dimension: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    chunks: [
      { chapter: 0, index: 0, chapterTitle: '第一章', text: '经济危机的内容', vec: encodeVec([1, 0, 0]) },
      { chapter: 0, index: 1, chapterTitle: '第一章', text: '无关噪声块', vec: encodeVec([0, 1, 0]) },
      { chapter: 1, index: 2, chapterTitle: '第二章', text: '政治整合的内容', vec: encodeVec([0, 0, 1]) }
    ],
    ...overrides
  }
}

async function run(): Promise<void> {
  console.log('\nVector store')

  // 编解码往返（Float32 精度有限，用整数向量避免表示误差）
  {
    const arr = [1, -2, 5]
    assert.deepEqual(Array.from(new Float32Array(arr)), arr, 'sanity')
    assert.deepEqual(Array.from(decodeVec(encodeVec(arr))), arr)
    console.log('  ok base64 Float32 round-trips')
  }

  const data = book()

  // 章节过滤下推：chapter 类问题只在该章算 cosine，避免槽位被别章占满
  {
    const results = searchVectors(data, [0, 0, 1], 6, 12000, { chapterFilter: 1 })
    assert.equal(results.length, 1)
    assert.equal(results[0].chapter, 1)
    assert.equal(results[0].chapterTitle, '第二章')
    assert.equal(results[0].text, '政治整合的内容')
    const none = searchVectors(data, [0, 0, 1], 6, 12000, { chapterFilter: 9 })
    assert.equal(none.length, 0)
    console.log('  ok chapterFilter restricts cosine to one chapter')
  }

  // 相对分数阈值：去掉断崖后的噪声，不再硬塞 topK 个
  {
    const strict = searchVectors(data, [1, 0, 0], 10, 12000)
    assert.equal(strict.length, 1, 'noise below 0.5×top must drop')
    assert.equal(strict[0].text, '经济危机的内容')
    // 关闭阈值 → 旧行为，全部返回（受 topK/maxChars 截断）
    const loose = searchVectors(data, [1, 0, 0], 10, 12000, { minScoreRatio: 0 })
    assert.equal(loose.length, 3)
    console.log('  ok relative score threshold trims noise (and can be disabled)')
  }

  // 章名回退：旧文件无 chapterTitle →「第 N 章」
  {
    const legacy = book({
      chunks: data.chunks.map((c) => ({ chapter: c.chapter, index: c.index, text: c.text, vec: c.vec }))
    })
    const results = searchVectors(legacy, [1, 0, 0], 10, 12000, { minScoreRatio: 0 })
    assert.equal(results[0].chapterTitle, '第 1 章')
    console.log('  ok chapterTitle falls back to 第 N 章 for legacy files')
  }

  // 维度不一致：绝不截断后照算 cosine
  {
    assert.throws(
      () => searchVectors(data, [1, 0], 6, 12000),
      (e: unknown) => e instanceof VectorCompatError && /维度与索引不一致/.test((e as Error).message)
    )
    assert.throws(
      () => assertVectorCompat(data, [1, 0, 0], 'other-model'),
      (e: unknown) => e instanceof VectorCompatError && /模型与索引不一致/.test((e as Error).message)
    )
    // 一致时不抛
    assert.doesNotThrow(() => assertVectorCompat(data, [1, 0, 0], 'embed-test'))
    console.log('  ok dimension/model mismatch raises VectorCompatError instead of silent garbage')
  }

  // 进程内缓存：searchBookVectors 端到端，命中缓存跳过逐块解码
  {
    const root = mkdtempSync(join(tmpdir(), 'ting-ear-vec-'))
    try {
      const getDir = () => root
      await saveVectors(getDir, data)
      // 缓存被 saveVectors 清掉，首次加载重建
      const loaded = await getCachedVectors(getDir, 'book-x')
      assert.equal(loaded?.bookId, 'book-x')

      const results = await searchBookVectors(getDir, 'book-x', [1, 0, 0], 10, 12000)
      assert.equal(results.length, 1)
      assert.equal(results[0].chapterTitle, '第一章')

      // 缓存命中：再查不读文件（mtime 不变）——校验返回一致
      const again = await searchBookVectors(getDir, 'book-x', [0, 0, 1], 6, 12000, { chapterFilter: 1 })
      assert.equal(again.length, 1)
      assert.equal(again[0].text, '政治整合的内容')

      invalidateVectorCache('book-x')
      const afterInvalidate = await getCachedVectors(getDir, 'book-x')
      assert.equal(afterInvalidate?.bookId, 'book-x', 'rebuilds after invalidate')
      console.log('  ok in-memory cache loads, searches, and invalidates')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  console.log('Vector store result: 6 passed')
}

void run()
