import assert from 'node:assert/strict'
import { OutlineGenerationQueue } from '../electron/services/ai/outline-queue'

void (async () => {
  const queue = new OutlineGenerationQueue()
  const events: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

  const first = queue.enqueue(async () => {
    events.push('first-start')
    await firstGate
    events.push('first-end')
    return 'one'
  })
  const second = queue.enqueue(async () => {
    events.push('second')
    return 'two'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(events, ['first-start'])
  releaseFirst()
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two'])
  assert.deepEqual(events, ['first-start', 'first-end', 'second'])
  console.log('Outline queue result: FIFO single-flight passed')
})()
