import assert from 'node:assert/strict'
import { normalizeRawSpeechText } from '../src/hooks/useTTS'
import {
  createCancelableTtsOperation,
  TTS_OPERATION_CANCELLED,
  TtsSessionController,
  waitForCurrentTtsGeneration
} from '../src/utils/ttsSession'

let passed = 0

function test(name: string, run: () => void): void {
  run()
  passed += 1
  console.log(`  ok ${name}`)
}

console.log('\nTTS session')

test('restores a book only when raw speech interrupted active playback', () => {
  const session = new TtsSessionController()
  session.beginBook()
  session.beginRaw(true, 12)

  const resume = session.finishRaw()

  assert.deepEqual(resume, { shouldResumeBook: true, sentenceIndex: 12 })
  assert.equal(session.state, 'book_playing')
})

test('does not start book playback after raw speech from paused or idle states', () => {
  const paused = new TtsSessionController()
  paused.beginBook()
  paused.pauseBook()
  paused.beginRaw(false, 7)
  assert.deepEqual(paused.finishRaw(), { shouldResumeBook: false, sentenceIndex: 7 })
  assert.equal(paused.state, 'idle')

  const idle = new TtsSessionController()
  idle.beginRaw(false, 3)
  assert.deepEqual(idle.finishRaw(), { shouldResumeBook: false, sentenceIndex: 3 })
  assert.equal(idle.state, 'idle')
})

test('supports raw pause/resume and rejects invalid transitions', () => {
  const session = new TtsSessionController()
  assert.equal(session.pauseRaw(), false)
  assert.equal(session.resumeRaw(), false)
  assert.equal(session.state, 'idle')

  session.beginRaw(false, 0)
  assert.equal(session.pauseRaw(), true)
  assert.equal(session.state, 'raw_paused')
  assert.equal(session.pauseRaw(), false)
  assert.equal(session.resumeRaw(), true)
  assert.equal(session.state, 'raw_speaking')
  assert.equal(session.resumeRaw(), false)
})

test('cancellation resumes only when explicitly requested', () => {
  const session = new TtsSessionController()
  session.beginBook()
  session.beginRaw(true, 5)

  assert.deepEqual(session.cancelRaw(false), { shouldResumeBook: true, sentenceIndex: 5 })
  assert.equal(session.state, 'idle')

  session.beginBook()
  session.beginRaw(true, 9)
  assert.deepEqual(session.cancelRaw(true), { shouldResumeBook: true, sentenceIndex: 9 })
  assert.equal(session.state, 'book_playing')
})

test('exposes the original resume point while replacing active raw speech', () => {
  const session = new TtsSessionController()
  session.beginBook()
  session.beginRaw(true, 14)

  const inherited = session.pendingRawResume
  assert.deepEqual(inherited, { shouldResumeBook: true, sentenceIndex: 14 })

  session.cancelRaw(false)
  session.beginRaw(inherited!.shouldResumeBook, inherited!.sentenceIndex)
  assert.deepEqual(session.finishRaw(), { shouldResumeBook: true, sentenceIndex: 14 })
})

test('normalizes Markdown before raw speech', () => {
  assert.equal(
    normalizeRawSpeechText('![封面](cover.png) [链接标题](https://example.com) **重点** `代码`'),
    '链接标题 重点 代码'
  )
})

async function verifyCancelableOperation(): Promise<void> {
  let resolvePending: ((value: string) => void) | undefined
  const pending = new Promise<string>((resolve) => {
    resolvePending = resolve
  })
  const operation = createCancelableTtsOperation(pending)

  operation.cancel()
  assert.equal(await operation.result, TTS_OPERATION_CANCELLED)
  resolvePending?.('too late')
  passed += 1
  console.log('  ok settles a pending asynchronous operation when raw speech is canceled')
}

async function verifyGenerationAfterAsyncBoundary(): Promise<void> {
  let finishResume: (() => void) | undefined
  let current = true
  const resume = new Promise<void>((resolve) => {
    finishResume = resolve
  })
  const waiting = waitForCurrentTtsGeneration(resume, () => current)

  current = false
  finishResume?.()
  assert.equal(await waiting, false)
  passed += 1
  console.log('  ok rejects a stale book generation after an asynchronous audio-context resume')
}

void Promise.all([verifyCancelableOperation(), verifyGenerationAfterAsyncBoundary()]).then(() => {
  console.log(`TTS session result: ${passed} passed`)
})
