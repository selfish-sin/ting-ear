/**
 * EngineManager one-click deploy import tests.
 *
 * Run: npx tsx tests/engineImport.test.ts
 */
import { EngineManager } from '../electron/services/tts-engines/engine-manager'
import type { TTSEngineConfig } from '../electron/services/tts-engines/adapter'

type TestEngineManager = EngineManager & {
  config: TTSEngineConfig[]
  addCustomEngine: (config: TTSEngineConfig) => void
}

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label} - assertion returned false`)
    }
  } catch (e) {
    failed++
    console.log(`  fail ${label} - threw: ${(e as Error).message}`)
  }
}

function createManager(): TestEngineManager {
  const manager = Object.create(EngineManager.prototype) as TestEngineManager
  manager.config = []
  manager.addCustomEngine = (config: TTSEngineConfig) => {
    manager.config.push(config)
  }
  return manager
}

console.log('\nEngine import')

assert('imports JSON deploy config with response and voice fields', () => {
  const manager = createManager()
  const result = manager.importEngine(JSON.stringify({
    name: 'Local Voice',
    apiUrl: 'http://127.0.0.1:8880/v1/audio/speech',
    type: 'http',
    apiKey: 'secret',
    requestMethod: 'POST',
    requestTemplate: { input: 'sample text', voice: 'sample_voice' },
    responseAudioField: 'audio',
    responseFormat: 'base64',
    voices: [{ id: 'zf_xiaobei', name: 'Xiaobei', language: 'zh-CN', gender: 'female' }]
  }))

  return Boolean(
    result.success &&
    result.config?.type === 'http' &&
    result.config.requestTemplate?.input === '{text}' &&
    result.config.requestTemplate?.voice === '{voice}' &&
    result.config.responseAudioField === 'audio' &&
    result.config.responseFormat === 'base64' &&
    result.config.voices?.[0]?.id === 'zf_xiaobei'
  )
})

assert('imports nested ting-ear deploy package', () => {
  const manager = createManager()
  const result = manager.importEngine(JSON.stringify({
    format: 'ting-ear-engine-deploy',
    config: {
      name: 'Nested Engine',
      url: 'https://example.com/tts',
      method: 'POST',
      body: { text: 'hello', speaker: 'alice' }
    }
  }))

  return Boolean(
    result.success &&
    result.config?.apiUrl === 'https://example.com/tts' &&
    result.config.requestTemplate?.text === '{text}' &&
    result.config.requestTemplate?.speaker === '{voice}'
  )
})

assert('imports curl and extracts bearer token', () => {
  const manager = createManager()
  const result = manager.importEngine(`curl https://api.openai.com/v1/audio/speech \\
  -H "Authorization: Bearer sk-test" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Hello","voice":"alloy"}'`)

  return Boolean(
    result.success &&
    result.detectedFormat === 'curl' &&
    result.config?.type === 'openai' &&
    result.config.apiKey === 'sk-test' &&
    result.config.requestTemplate?.input === '{text}' &&
    result.config.requestTemplate?.voice === '{voice}'
  )
})

assert('imports chat-completions TTS curl and exposes nested audio voice', () => {
  const manager = createManager()
  const result = manager.importEngine(`curl -X POST https://api.xiaomimimo.com/v1/chat/completions \\
  -H "Authorization: Bearer your-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"mimo-v2.5-tts","messages":[{"role":"user","content":"Bright, bouncy tone."},{"role":"assistant","content":"Hey boss, I passed!"}],"audio":{"format":"wav","voice":"Chloe"}}'`)

  const messages = result.config?.requestTemplate?.messages as Array<Record<string, unknown>> | undefined
  const audio = result.config?.requestTemplate?.audio as Record<string, unknown> | undefined

  return Boolean(
    result.success &&
    result.config?.apiUrl === 'https://api.xiaomimimo.com/v1/chat/completions' &&
    result.config.voices?.[0]?.id === 'Chloe' &&
    result.config.voices?.some((voice) => voice.id === '冰糖') &&
    result.config.responseFormat === 'base64' &&
    result.config.responseAudioField === 'choices.0.message.audio.data' &&
    messages?.[0]?.content === 'Bright, bouncy tone.' &&
    messages?.[1]?.content === '{text}' &&
    audio?.voice === '{voice}'
  )
})

assert('invalid URL returns a business error instead of throwing', () => {
  const manager = createManager()
  const result = manager.importEngine(JSON.stringify({
    name: 'Bad Engine',
    apiUrl: 123
  }) as unknown as string)

  return result.success === false && Boolean(result.error)
})

console.log(`\nEngine import result: ${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exit(1)
