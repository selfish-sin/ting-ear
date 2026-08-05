import assert from 'node:assert/strict'
import { AiService, buildPromptMessages } from '../electron/services/ai/ai-service'
import { AI_DEFAULTS } from '../electron/services/ai/ai-config'
import type { AiChatPayload, AiHistoryRepository, AiPromptMessage, AiSettings } from '../src/global'

const PREFETCH_DEFAULTS: AiSettings = {
  ...AI_DEFAULTS,
  agent: { mode: 'prefetch', maxToolRounds: 4 }
}

interface SentEvent {
  channel: string
  payload: Record<string, unknown>
}

function payload(text: string): AiChatPayload {
  return {
    bookId: 'book-1',
    bookTitle: '测试书',
    messages: [{ role: 'user', content: text }]
  }
}

async function run(): Promise<void> {
  console.log('\nAI IPC streaming')

  const contextual = buildPromptMessages(AI_DEFAULTS, {
    ...payload('解释这一段'),
    autoContext: '当前读到：测试上下文'
  })
  assert.equal(contextual.some((message) => message.content.includes('测试上下文')), true)
  const greeting = buildPromptMessages(AI_DEFAULTS, {
    ...payload('你好'),
    autoContext: '不应注入的上下文'
  })
  assert.equal(greeting.some((message) => message.content.includes('不应注入')), false)
  console.log('  ok skips automatic reading context for greetings')

  const sent: SentEvent[] = []
  const saved: AiPromptMessage[][] = []
  const history: AiHistoryRepository = {
    load: () => [],
    save: (_bookId, messages) => saved.push(messages),
    clear: () => undefined
  }
  const service = new AiService({
    getSettings: () => PREFETCH_DEFAULTS,
    history,
    stream: async function* () {
      yield '第'
      yield '一段'
    }
  })

  await service.chat('request-1', payload('问题'), {
    send: (channel, eventPayload) => sent.push({ channel, payload: eventPayload })
  })

  assert.deepEqual(
    sent.filter((event) => event.channel === 'ai:chat:chunk').map((event) => event.payload.seq),
    [0, 1]
  )
  assert.equal(sent.at(-1)?.channel, 'ai:chat:done')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].at(-1)?.content, '第一段')
  console.log('  ok emits ordered chunks and persists the completed answer')

  const cancellationEvents: SentEvent[] = []
  const waitingService = new AiService({
    getSettings: () => PREFETCH_DEFAULTS,
    history,
    stream: async function* (_config, requestMessages, signal) {
      const question = requestMessages.at(-1)?.content
      if (question === '保留') {
        yield '继续'
        return
      }
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  })
  const sender = {
    send: (channel: string, eventPayload: Record<string, unknown>) =>
      cancellationEvents.push({ channel, payload: eventPayload })
  }

  const canceled = waitingService.chat('cancel-me', payload('取消'), sender)
  const retained = waitingService.chat('keep-me', payload('保留'), sender)
  assert.equal(waitingService.cancel('cancel-me'), true)
  await Promise.all([canceled, retained])

  const canceledDone = cancellationEvents.find(
    (event) => event.channel === 'ai:chat:done' && event.payload.requestId === 'cancel-me'
  )
  const retainedChunk = cancellationEvents.find(
    (event) => event.channel === 'ai:chat:chunk' && event.payload.requestId === 'keep-me'
  )
  assert.equal(canceledDone?.payload.cancelled, true)
  assert.equal(retainedChunk?.payload.text, '继续')
  console.log('  ok cancels only the requested stream')

  console.log('AI IPC streaming result: 3 passed')
}

void run()
