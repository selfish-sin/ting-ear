import assert from 'node:assert/strict'
import { classifyUrlType } from '../electron/services/ai/web-search-service'
import { toWebSourceRefs } from '../electron/services/ai/ai-service'
import { mergeAiSettings, AI_DEFAULTS } from '../src/aiSettings'
import { resolveWebSearchHttpBackend } from '../src/webSearch'

console.log('\nWeb search service & settings')

assert.equal(classifyUrlType('https://pubmed.ncbi.nlm.nih.gov/123'), '学术数据库')
assert.equal(classifyUrlType('https://arxiv.org/abs/1'), '学术预印本')
assert.equal(classifyUrlType('https://www.xinhuanet.com/a'), '权威新闻')
assert.equal(classifyUrlType('https://example.com/page'), '网页')
console.log('  ok classifyUrlType labels')

const refs = toWebSourceRefs([
  {
    title: 'Ollama',
    url: 'https://ollama.com',
    snippet: 'local models',
    provider: 'ollama',
    sourceType: '网页',
    fetchedAt: '2026-01-01T00:00:00.000Z'
  }
])
assert.equal(refs.length, 1)
assert.equal(refs[0].index, 1)
assert.equal(refs[0].provider, 'ollama')
assert.equal(refs[0].title, 'Ollama')
console.log('  ok toWebSourceRefs mapping')

const defaults = mergeAiSettings()
assert.equal(defaults.webSearch.backend, 'auto')
assert.equal(defaults.webSearch.ollamaBaseUrl, 'https://ollama.com')
assert.equal(defaults.webSearch.maxResults, 5)
assert.deepEqual(defaults.webSearch.customSources, [])

const withKey = mergeAiSettings({
  webSearch: {
    enabled: true,
    backend: 'ollama',
    ollamaApiKey: '  test-key  ',
    customSources: [
      {
        id: 's1',
        name: '新华社',
        url: 'https://www.xinhuanet.com',
        sourceType: '权威新闻',
        status: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  }
})
assert.equal(withKey.webSearch.ollamaApiKey, 'test-key')
assert.equal(withKey.webSearch.customSources?.length, 1)
assert.equal(withKey.webSearch.customSources?.[0].name, '新华社')

// 旧值 zhipu-native 仍可解析为 http zhipu
assert.equal(
  resolveWebSearchHttpBackend({ webSearch: { enabled: true, prompt: '', backend: 'zhipu-native' } }),
  'zhipu'
)
assert.equal(
  resolveWebSearchHttpBackend({ webSearch: { enabled: true, prompt: '', backend: 'ollama' } }),
  'ollama'
)

// 兼容：旧配置无 ollama 字段时 merge 不炸
const legacy = mergeAiSettings({
  webSearch: { enabled: true, prompt: AI_DEFAULTS.webSearch.prompt, backend: 'auto' as never }
})
assert.equal(legacy.webSearch.backend, 'auto')
assert.equal(typeof legacy.webSearch.ollamaApiKey, 'string')
console.log('  ok mergeAiSettings ollama defaults & custom sources')

// Semantic Scholar 映射：provider 字段合法
assert.equal(
  toWebSourceRefs([
    {
      title: 'Social Capital',
      url: 'https://www.semanticscholar.org/paper/abc',
      snippet: 'abstract…',
      provider: 'semantic-scholar',
      sourceType: '学术论文',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    }
  ])[0].provider,
  'semantic-scholar'
)
console.log('  ok semantic-scholar web source mapping')

console.log('webSearchService result: ok')
