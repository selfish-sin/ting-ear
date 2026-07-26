export type TtsSessionState =
  | 'idle'
  | 'book_playing'
  | 'book_paused'
  | 'raw_speaking'
  | 'raw_paused'

export interface RawResumePoint {
  shouldResumeBook: boolean
  sentenceIndex: number
}

export const TTS_OPERATION_CANCELLED = Symbol('tts-operation-cancelled')

export function createCancelableTtsOperation<T>(operation: Promise<T>): {
  result: Promise<T | typeof TTS_OPERATION_CANCELLED>
  cancel: () => void
} {
  let cancel = (): void => undefined
  const cancellation = new Promise<typeof TTS_OPERATION_CANCELLED>((resolve) => {
    cancel = () => resolve(TTS_OPERATION_CANCELLED)
  })
  return {
    result: Promise.race([operation, cancellation]),
    cancel
  }
}

export async function waitForCurrentTtsGeneration(
  operation: Promise<unknown>,
  isCurrent: () => boolean
): Promise<boolean> {
  await operation
  return isCurrent()
}

export class TtsSessionController {
  private currentState: TtsSessionState = 'idle'
  private resumePoint: RawResumePoint = { shouldResumeBook: false, sentenceIndex: 0 }

  get state(): TtsSessionState {
    return this.currentState
  }

  get isRawActive(): boolean {
    return this.currentState === 'raw_speaking' || this.currentState === 'raw_paused'
  }

  get pendingRawResume(): RawResumePoint | null {
    return this.isRawActive ? { ...this.resumePoint } : null
  }

  beginBook(): void {
    this.currentState = 'book_playing'
    this.resumePoint = { shouldResumeBook: false, sentenceIndex: 0 }
  }

  pauseBook(): void {
    this.currentState = 'book_paused'
  }

  stopBook(): void {
    this.currentState = 'idle'
  }

  beginRaw(wasBookPlaying: boolean, sentenceIndex: number): void {
    this.resumePoint = {
      shouldResumeBook: wasBookPlaying,
      sentenceIndex: Math.max(0, Math.trunc(sentenceIndex))
    }
    this.currentState = 'raw_speaking'
  }

  pauseRaw(): boolean {
    if (this.currentState !== 'raw_speaking') return false
    this.currentState = 'raw_paused'
    return true
  }

  resumeRaw(): boolean {
    if (this.currentState !== 'raw_paused') return false
    this.currentState = 'raw_speaking'
    return true
  }

  finishRaw(): RawResumePoint {
    const result = { ...this.resumePoint }
    this.currentState = result.shouldResumeBook ? 'book_playing' : 'idle'
    this.resumePoint = { shouldResumeBook: false, sentenceIndex: 0 }
    return result
  }

  cancelRaw(restoreBook: boolean): RawResumePoint {
    const saved = { ...this.resumePoint }
    this.currentState = restoreBook && saved.shouldResumeBook ? 'book_playing' : 'idle'
    this.resumePoint = { shouldResumeBook: false, sentenceIndex: 0 }
    return saved
  }
}
