import { useCallback, useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useSettingsStore } from '../stores/settingsStore'
import {
  resumeAudioContext,
  clampSystemSpeechVolume,
  getReusableAudio
} from '../utils/audioOutput'
import {
  findNextPlayableSentence,
  findPreviousPlayableSentence,
  getPlayablePrefetchIndices
} from '../utils/ttsSkip'
import { splitReadableSentences } from '../utils/bookData'
import {
  createCancelableTtsOperation,
  TTS_OPERATION_CANCELLED,
  TtsSessionController,
  waitForCurrentTtsGeneration,
  type RawResumePoint
} from '../utils/ttsSession'
import type { ToastItem } from '../global'

// TTS 错误码
enum TTSError {
  API_KEY_INVALID = 'API_KEY_INVALID',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

export function normalizeRawSpeechText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\u0060#>*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface UseTTSOptions {
  showToast: (type: ToastItem['type'], message: string) => void
}

interface TTSResult {
  success: boolean
  audio?: string // base64 mp3 or wav
  audioFormat?: 'mp3' | 'wav'  // v5: for correct MIME type selection
  error?: string
  fallback?: boolean // whether to fall back to system TTS
}

/**
 * TTS Hook: handles playback of sentences using Qwen TTS with system TTS fallback.
 *
 * Playback strategy:
 * - Qwen TTS: synthesize current sentence via IPC, play as <audio> element
 * - On error/timeout/quota: fall back to Web Speech API (system TTS)
 * - When a sentence finishes, automatically advance to next sentence
 *
 * v5 fixes:
 * - Generation token (genId) cancels stale in-flight requests
 * - setCurrentIndex() atomically syncs ref + store
 * - play() syncs currentIndexRef from store at entry
 * - prevSentence skips empty sentences going backwards
 * - playFrom returns on empty-window (prevents no-op bug)
 */
export function useTTS({ showToast }: UseTTSOptions) {
  const {
    currentSentenceIndex,
    speed,
    volume,
    isMuted,
    voiceId,
    useSystemTTS,
    setPlayState,
    setCurrentSentenceIndex,
    setUseSystemTTS,
    setCurrentAudio,
    setRawSpeechActive
  } = usePlayerStore()

  const { sentences, currentBook } = useBookStore()
  const { settings } = useSettingsStore()

  // Refs to always have fresh values in callbacks
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const isPlayingRef = useRef(false)
  const currentIndexRef = useRef(0)
  const speedRef = useRef(speed)
  const volumeRef = useRef(volume)
  const isMutedRef = useRef(isMuted)
  const voiceIdRef = useRef(voiceId)
  const useSystemTTSRef = useRef(useSystemTTS)
  const sentencesRef = useRef(sentences)
  const currentBookRef = useRef(currentBook)
  const currentBookIdRef = useRef(currentBook?.id ?? null)
  const apiKeyRef = useRef(settings.qwenApiKey)
  const endpointRef = useRef(settings.qwenEndpoint)
  const engineIdRef = useRef<string>(settings.ttsEngine || 'edge')
  const boundsRef = useRef<{ start: number; end: number }>({ start: 0, end: sentences.length })

  // 预缓存追踪：记录哪句已经后台合成了
  const prefetchSet = useRef(new Set<number>())
  // 内存级预取缓存：idx → { audio, audioFormat }，播放时直接取用跳过 IPC
  const prefetchCache = useRef(new Map<number, { audio: string; audioFormat?: string }>())
  // 当前 blob URL（切换 src 时释放旧的）
  const currentBlobUrl = useRef<string | null>(null)

  // 预缓存并发池：限制同时请求数，避免压垮 TTS 服务
  const PREFETCH_CONCURRENCY = 2
  const prefetchActiveRef = useRef(0)
  const prefetchQueueRef = useRef<Array<() => void>>([])

  const drainPrefetchQueue = useCallback(() => {
    while (prefetchActiveRef.current < PREFETCH_CONCURRENCY && prefetchQueueRef.current.length > 0) {
      const task = prefetchQueueRef.current.shift()!
      prefetchActiveRef.current++
      task()
    }
  }, [])

  // Generation token: incremented on every new play/stop to cancel stale in-flight requests
  const genIdRef = useRef(0)
  const rawTokenRef = useRef(0)
  const rawSettleRef = useRef<(() => void) | null>(null)
  const ttsSessionRef = useRef(new TtsSessionController())

  const waitForRawOperation = useCallback(async <T,>(operation: Promise<T>) => {
    const cancellable = createCancelableTtsOperation(operation)
    rawSettleRef.current = cancellable.cancel
    try {
      return await cancellable.result
    } finally {
      if (rawSettleRef.current === cancellable.cancel) rawSettleRef.current = null
    }
  }, [])

  // playerStore 中的 ttsEngine（离线按钮等会改，不一定同步 settings）
  const playerTtsEngine = usePlayerStore((s) => s.ttsEngine)

  // Sync refs
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { volumeRef.current = volume }, [volume])
  useEffect(() => { isMutedRef.current = isMuted }, [isMuted])
  useEffect(() => { voiceIdRef.current = voiceId }, [voiceId])
  useEffect(() => { useSystemTTSRef.current = useSystemTTS }, [useSystemTTS])
  useEffect(() => {
    sentencesRef.current = sentences
    currentBookRef.current = currentBook
    boundsRef.current = useBookStore.getState().getRangeBounds()
  }, [sentences, currentBook])
  useEffect(() => { currentIndexRef.current = currentSentenceIndex }, [currentSentenceIndex])
  useEffect(() => { apiKeyRef.current = settings.qwenApiKey }, [settings.qwenApiKey])
  useEffect(() => { endpointRef.current = settings.qwenEndpoint }, [settings.qwenEndpoint])
  useEffect(() => {
    // 优先 settings 持久化引擎；离线按钮改的是 playerStore.ttsEngine
    const fromSettings = settings.ttsEngine
    if (fromSettings && fromSettings !== 'system') {
      engineIdRef.current = fromSettings
    } else if (playerTtsEngine && playerTtsEngine !== 'system') {
      engineIdRef.current = playerTtsEngine
    } else {
      engineIdRef.current = fromSettings || playerTtsEngine || 'edge'
    }
  }, [settings.ttsEngine, playerTtsEngine])

  // --- Atomic index setter ---
  // Every write to currentSentenceIndex MUST go through this to keep ref + store in sync.
  const setCurrentIndex = useCallback((idx: number) => {
    currentIndexRef.current = idx
    setCurrentSentenceIndex(idx)
  }, [setCurrentSentenceIndex])

  // Stop all current playback AND cancel all in-flight TTS requests
  const stopPlayback = useCallback(() => {
    genIdRef.current++  // Invalidate all in-flight generation tokens
    // 清空预取队列，避免切书/停止后仍占用并发与带宽
    prefetchQueueRef.current = []
    prefetchSet.current.clear()
    prefetchCache.current.clear()
    prefetchActiveRef.current = 0
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()  // 释放解码资源
      setCurrentAudio(null)
    }
    if (currentBlobUrl.current) {
      try { URL.revokeObjectURL(currentBlobUrl.current) } catch { /* ignore */ }
      currentBlobUrl.current = null
    }
    if (utteranceRef.current) {
      window.speechSynthesis.cancel()
      utteranceRef.current = null
    }
  }, [setCurrentAudio])

  // Play a specific sentence by GLOBAL index.
  const playSentence = useCallback(
    async (index: number) => {
      const sents = sentencesRef.current
      const bounds = useBookStore.getState().getRangeBounds()  // Live read, no stale boundsRef

      // Clamp into window
      let clamped = index
      if (clamped < bounds.start) clamped = bounds.start

      // Out of window → done
      if (clamped >= bounds.end || sents.length === 0) {
        setPlayState('idle')
        isPlayingRef.current = false
        showToast('success', '🎉 已读完')
        return
      }

      // Skip empty sentences forward
      const target = findNextPlayableSentence(sents, currentBookRef.current, clamped, bounds)
      if (target >= bounds.end) {
        setCurrentIndex(bounds.end - 1)
        setPlayState('idle')
        isPlayingRef.current = false
        showToast('success', '🎉 已读完')
        return
      }

      const text = sents[target]
      const sentIndex = target
      setCurrentIndex(target)

      // Stop existing playback + cancel stale in-flight requests
      stopPlayback()

      // Acquire fresh generation token AFTER stopPlayback (stopPlayback itself bumps genId)
      const myGen = genIdRef.current

      // Try main-process TTS first (Edge / Qwen / custom engines)
      if (!useSystemTTSRef.current) {
        try {
          // 优先从内存预取缓存取（跳过 IPC 往返）
          let result: TTSResult | undefined
          const cached = prefetchCache.current.get(sentIndex)
          if (cached) {
            prefetchCache.current.delete(sentIndex)
            result = { success: true, audio: cached.audio, audioFormat: cached.audioFormat as 'mp3' | 'wav' }
          } else {
            result = (await window.api?.ttsSynthesize(
              text,
              voiceIdRef.current,
              speedRef.current,
              1.0,
              engineIdRef.current
            )) as TTSResult
          }

          // Discard stale result (user has moved on)
          if (myGen !== genIdRef.current) return

          if (result?.success && result.audio) {
            const mime = result.audioFormat === 'wav' ? 'audio/wav' : 'audio/mp3'
            // 快速 base64 → Uint8Array（分块处理避免主线程长时间阻塞）
            const binaryStr = atob(result.audio)
            const len = binaryStr.length
            const bytes = new Uint8Array(len)
            for (let i = 0; i < len; i += 8192) {
              const end = Math.min(i + 8192, len)
              for (let j = i; j < end; j++) {
                bytes[j] = binaryStr.charCodeAt(j)
              }
            }
            const blob = new Blob([bytes], { type: mime })
            const blobUrl = URL.createObjectURL(blob)

            // 释放上一个 blob URL
            if (currentBlobUrl.current) {
              try { URL.revokeObjectURL(currentBlobUrl.current) } catch { /* ignore */ }
            }
            currentBlobUrl.current = blobUrl

            // 复用 Audio 元素（避免频繁 createMediaElementSource）
            const { audio, gain } = getReusableAudio()
            audio.src = blobUrl
            audio.playbackRate = 1.0

            const generationIsCurrent = await waitForCurrentTtsGeneration(
              resumeAudioContext(),
              () => myGen === genIdRef.current
            )
            if (!generationIsCurrent) {
              try { URL.revokeObjectURL(blobUrl) } catch { /* ignore */ }
              if (currentBlobUrl.current === blobUrl) currentBlobUrl.current = null
              return
            }
            gain.gain.value = isMutedRef.current ? 0 : Math.max(0, Math.min(2.0, volumeRef.current))
            audioRef.current = audio
            setCurrentAudio(audio)

            // === 预缓存后续句子（并发池 + 5句窗口，结果存内存） ===
            const curBounds = useBookStore.getState().getRangeBounds()
            const curSents = sentencesRef.current
            const PREFETCH_WINDOW = 5
            const prefetchIndices = getPlayablePrefetchIndices(
              curSents,
              currentBookRef.current,
              sentIndex,
              curBounds,
              PREFETCH_WINDOW
            )
            for (const idx of prefetchIndices) {
              if (prefetchSet.current.has(idx)) continue
              const t = curSents[idx]
              prefetchSet.current.add(idx)
              const task = () => {
                window.api!.ttsSynthesize(
                  t, voiceIdRef.current, speedRef.current,
                  1.0,
                  engineIdRef.current
                ).then((r: TTSResult) => {
                  if (r?.success && r.audio) {
                    prefetchCache.current.set(idx, { audio: r.audio, audioFormat: r.audioFormat })
                  }
                }).catch(() => {
                  prefetchSet.current.delete(idx)
                }).finally(() => {
                  prefetchActiveRef.current--
                  drainPrefetchQueue()
                })
              }
              prefetchQueueRef.current.push(task)
            }
            drainPrefetchQueue()

            audio.onended = () => {
              if (myGen !== genIdRef.current) return
              if (audio.duration && !isNaN(audio.duration)) {
                const durMs = Math.round(audio.duration * 1000)
                usePlayerStore.getState().updateTimeMapEntry(sentIndex, durMs)
              }
              if (isPlayingRef.current) {
                playSentence(currentIndexRef.current + 1)
              }
            }

            audio.onerror = () => {
              if (myGen !== genIdRef.current) return
              console.error('Audio playback error')
              showToast('warning', '在线音频播放失败，本句使用离线语音')
              playWithSystemTTS(text, sentIndex, myGen)
            }

            await audio.play().catch(() => {
              if (myGen !== genIdRef.current) return
              showToast('warning', '在线音频播放失败，本句使用离线语音')
              playWithSystemTTS(text, sentIndex, myGen)
            })
            return
            } else if (result?.fallback) {
              if (myGen !== genIdRef.current) return
              const reason = result.error
              if (reason === TTSError.API_KEY_INVALID) {
                showToast('error', 'API Key 无效，本句使用离线 TTS')
              } else if (reason === TTSError.QUOTA_EXCEEDED) {
                showToast('warning', '免费额度已用完，本句使用离线 TTS')
              } else if (reason === TTSError.TIMEOUT) {
                showToast('warning', '网络不畅，本句使用离线 TTS')
              } else {
                showToast('warning', `在线 TTS 失败，本句使用离线语音${reason ? `（${reason}）` : ''}`)
              }
              playWithSystemTTS(text, sentIndex, myGen)
              return
            } else {
              if (myGen !== genIdRef.current) return
              showToast('warning', `在线 TTS 失败，本句使用离线语音${result?.error ? `（${result.error}）` : ''}`)
              playWithSystemTTS(text, sentIndex, myGen)
              return
            }
        } catch (error) {
          if (myGen !== genIdRef.current) return
          console.error('TTS error:', error)
          showToast('warning', '在线 TTS 请求异常，本句使用离线语音')
          playWithSystemTTS(text, sentIndex, myGen)
          return
        }
      } else {
        // Use system TTS directly
        playWithSystemTTS(text, sentIndex, myGen)
      }
    },
    [setCurrentIndex, setPlayState, setUseSystemTTS, setCurrentAudio, showToast, stopPlayback]
  )

  // Play using Web Speech API (system TTS)
  const playWithSystemTTS = useCallback(
    (text: string, index: number, gen: number) => {
      if (!('speechSynthesis' in window)) {
        showToast('error', '系统 TTS 不可用，请配置千问 API')
        setPlayState('idle')
        isPlayingRef.current = false
        return
      }

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = Math.max(0.5, Math.min(3.0, speedRef.current))
      // Web Speech 无法 >100%，超额部分无效
      utterance.volume = clampSystemSpeechVolume(volumeRef.current, isMutedRef.current)

      const voices = window.speechSynthesis.getVoices()
      // 根据 voiceId 选择系统语音：system-zh-male → 男声，system-zh-female → 女声
      const preferMale = voiceIdRef.current === 'system-zh-male'
      const zhVoices = voices.filter((v) => v.lang.startsWith('zh'))
      const bestVoice = preferMale
        ? zhVoices.find((v) => v.name.includes('Kangkang') || v.name.includes('Hao') || v.name.includes('Nan'))
          || zhVoices[0]
        : zhVoices.find((v) => v.name.includes('Huihui') || v.name.includes('Yaoyao') || v.name.includes('Nu'))
          || zhVoices[0]
      if (bestVoice) {
        utterance.voice = bestVoice
      }

      const startTime = performance.now()
      utterance.onend = () => {
        if (gen !== genIdRef.current) return
        const elapsed = performance.now() - startTime
        usePlayerStore.getState().updateTimeMapEntry(index, Math.round(elapsed))
        if (isPlayingRef.current) {
          playSentence(currentIndexRef.current + 1)
        }
      }

      utterance.onerror = (event) => {
        if (gen !== genIdRef.current) return
        console.error('Speech synthesis error:', event)
        if (isPlayingRef.current) {
          playSentence(currentIndexRef.current + 1)
        }
      }

      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    },
    [showToast, setPlayState, playSentence]
  )

  const playRawWithSystemTTS = useCallback(
    (text: string, token: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
          resolve(false)
          return
        }
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.rate = Math.max(0.5, Math.min(3, speedRef.current))
        utterance.volume = clampSystemSpeechVolume(volumeRef.current, isMutedRef.current)
        const voices = window.speechSynthesis.getVoices()
        const preferred = voices.find((voice) => voice.lang.startsWith('zh'))
        if (preferred) utterance.voice = preferred

        let settled = false
        const finish = (success: boolean) => {
          if (settled) return
          settled = true
          if (rawSettleRef.current === cancel) rawSettleRef.current = null
          resolve(success)
        }
        const cancel = () => finish(false)
        rawSettleRef.current = cancel
        utterance.onend = () => finish(token === rawTokenRef.current)
        utterance.onerror = () => finish(false)
        utteranceRef.current = utterance
        window.speechSynthesis.speak(utterance)
      }),
    []
  )

  const playRawWithOnlineTTS = useCallback(
    async (text: string, token: number): Promise<boolean> => {
      if (useSystemTTSRef.current) return false
      try {
        const synthesis = Promise.resolve(
          window.api?.ttsSynthesize(
            text,
            voiceIdRef.current,
            speedRef.current,
            1,
            engineIdRef.current
          ) as Promise<TTSResult> | undefined
        )
        const result = await waitForRawOperation(synthesis)
        if (
          result === TTS_OPERATION_CANCELLED ||
          token !== rawTokenRef.current ||
          !result?.success ||
          !result.audio
        ) {
          return false
        }

        const binary = atob(result.audio)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const blobUrl = URL.createObjectURL(
          new Blob([bytes], {
            type: result.audioFormat === 'wav' ? 'audio/wav' : 'audio/mp3'
          })
        )
        const resumed = await waitForRawOperation(resumeAudioContext())
        if (resumed === TTS_OPERATION_CANCELLED || token !== rawTokenRef.current) {
          URL.revokeObjectURL(blobUrl)
          return false
        }

        if (currentBlobUrl.current) URL.revokeObjectURL(currentBlobUrl.current)
        currentBlobUrl.current = blobUrl
        const { audio, gain } = getReusableAudio()
        audio.src = blobUrl
        audio.playbackRate = 1
        gain.gain.value = isMutedRef.current
          ? 0
          : Math.max(0, Math.min(2, volumeRef.current))
        audioRef.current = audio
        setCurrentAudio(audio)

        return await new Promise<boolean>((resolve) => {
          let settled = false
          const finish = (success: boolean) => {
            if (settled) return
            settled = true
            if (rawSettleRef.current === cancel) rawSettleRef.current = null
            audio.onended = null
            audio.onerror = null
            resolve(success)
          }
          const cancel = () => finish(false)
          rawSettleRef.current = cancel
          audio.onended = () => finish(token === rawTokenRef.current)
          audio.onerror = () => finish(false)
          void audio.play().catch(() => finish(false))
        })
      } catch {
        return false
      }
    },
    [setCurrentAudio, waitForRawOperation]
  )

  const stopRaw = useCallback(
    (restoreBook = true): RawResumePoint | null => {
      if (!ttsSessionRef.current.isRawActive) return null
      rawTokenRef.current += 1
      rawSettleRef.current?.()
      rawSettleRef.current = null
      const resumePoint = ttsSessionRef.current.cancelRaw(restoreBook)
      stopPlayback()
      if (restoreBook && resumePoint.shouldResumeBook) {
        isPlayingRef.current = true
        usePlayerStore.setState({ rawSpeechActive: false, playState: 'playing' })
        playSentence(resumePoint.sentenceIndex)
      } else {
        setRawSpeechActive(false)
      }
      return resumePoint
    },
    [playSentence, setRawSpeechActive, stopPlayback]
  )

  useEffect(() => {
    const nextBookId = currentBook?.id ?? null
    if (currentBookIdRef.current !== nextBookId) {
      stopRaw(false)
      currentBookIdRef.current = nextBookId
    }
  }, [currentBook?.id, stopRaw])

  useEffect(
    () => () => {
      stopRaw(false)
      stopPlayback()
    },
    [stopPlayback, stopRaw]
  )

  const speakRaw = useCallback(
    async (
      rawText: string,
      onSentence?: (sentenceIndex: number, total: number) => void
    ): Promise<void> => {
      const text = normalizeRawSpeechText(rawText)
      const rawSentences = splitReadableSentences(text)
      if (rawSentences.length === 0) return

      const inheritedResume = ttsSessionRef.current.isRawActive ? stopRaw(false) : null
      const wasBookPlaying = inheritedResume?.shouldResumeBook ?? isPlayingRef.current
      const resumeIndex =
        inheritedResume?.sentenceIndex ?? usePlayerStore.getState().currentSentenceIndex
      ttsSessionRef.current.beginRaw(wasBookPlaying, resumeIndex)
      isPlayingRef.current = false
      usePlayerStore.setState({
        rawSpeechActive: true,
        ...(wasBookPlaying ? { playState: 'paused' as const } : {})
      })
      stopPlayback()
      const token = ++rawTokenRef.current

      for (let index = 0; index < rawSentences.length; index += 1) {
        if (token !== rawTokenRef.current) return
        onSentence?.(index, rawSentences.length)
        const onlinePlayed = await playRawWithOnlineTTS(rawSentences[index], token)
        if (token !== rawTokenRef.current) return
        if (!onlinePlayed) {
          await playRawWithSystemTTS(rawSentences[index], token)
        }
      }

      if (token !== rawTokenRef.current) return
      stopPlayback()
      const resumePoint = ttsSessionRef.current.finishRaw()
      if (resumePoint.shouldResumeBook) {
        isPlayingRef.current = true
        usePlayerStore.setState({ rawSpeechActive: false, playState: 'playing' })
        playSentence(resumePoint.sentenceIndex)
      } else {
        setRawSpeechActive(false)
      }
    },
    [
      playRawWithOnlineTTS,
      playRawWithSystemTTS,
      playSentence,
      setRawSpeechActive,
      stopPlayback,
      stopRaw
    ]
  )

  // === Public API ===

  const play = useCallback(() => {
    if (ttsSessionRef.current.isRawActive) stopRaw(false)
    if (sentencesRef.current.length === 0) {
      showToast('warning', '请先导入书籍')
      return
    }
    boundsRef.current = useBookStore.getState().getRangeBounds()
    const bounds = boundsRef.current
    const sents = sentencesRef.current
    const book = currentBookRef.current
    // 从当前播放头找下一句可播；当前句空/跳过时自动推进，避免胶囊“不知道播哪句”
    let idx = usePlayerStore.getState().currentSentenceIndex
    let target = findNextPlayableSentence(sents, book, idx, bounds)
    if (target >= bounds.end) {
      target = findNextPlayableSentence(sents, book, bounds.start, bounds)
    }
    if (target >= bounds.end) {
      showToast('warning', '没有可播放的句子')
      return
    }
    idx = target
    setCurrentIndex(idx)
    ttsSessionRef.current.beginBook()
    isPlayingRef.current = true
    setPlayState('playing')
    playSentence(idx)
  }, [playSentence, setPlayState, setCurrentIndex, showToast, stopRaw])

  const pause = useCallback(() => {
    if (ttsSessionRef.current.isRawActive) stopRaw(false)
    ttsSessionRef.current.pauseBook()
    isPlayingRef.current = false
    setPlayState('paused')
    stopPlayback()
  }, [setPlayState, stopPlayback, stopRaw])

  const stop = useCallback(() => {
    if (ttsSessionRef.current.isRawActive) stopRaw(false)
    ttsSessionRef.current.stopBook()
    isPlayingRef.current = false
    setPlayState('stopped')
    stopPlayback()
    const start = useBookStore.getState().getRangeBounds().start
    setCurrentIndex(start)
  }, [setPlayState, stopPlayback, setCurrentIndex, stopRaw])

  const prevSentence = useCallback(() => {
    const rawResume = ttsSessionRef.current.isRawActive ? stopRaw(false) : null
    const shouldContinue = rawResume?.shouldResumeBook ?? isPlayingRef.current
    const bounds = useBookStore.getState().getRangeBounds()
    const sents = sentencesRef.current
    // Step back then skip empty backward-facing
    const stepped = Math.max(bounds.start, currentIndexRef.current - 1)
    const target = findPreviousPlayableSentence(sents, currentBookRef.current, stepped, bounds)
    const newIndex = target < bounds.start ? bounds.start : target
    setCurrentIndex(newIndex)
    if (shouldContinue) {
      ttsSessionRef.current.beginBook()
      isPlayingRef.current = true
      setPlayState('playing')
      playSentence(newIndex)
    }
  }, [setCurrentIndex, setPlayState, playSentence, stopRaw])

  const nextSentence = useCallback(() => {
    const rawResume = ttsSessionRef.current.isRawActive ? stopRaw(false) : null
    const shouldContinue = rawResume?.shouldResumeBook ?? isPlayingRef.current
    const bounds = useBookStore.getState().getRangeBounds()
    const sents = sentencesRef.current
    // Step forward then skip empty forward-facing
    const stepped = Math.min(bounds.end - 1, currentIndexRef.current + 1)
    const newIndex = findNextPlayableSentence(sents, currentBookRef.current, stepped, bounds)
    if (newIndex >= bounds.end) {
      setCurrentIndex(bounds.end - 1)
      return
    }
    setCurrentIndex(newIndex)
    if (shouldContinue) {
      ttsSessionRef.current.beginBook()
      isPlayingRef.current = true
      setPlayState('playing')
      playSentence(newIndex)
    }
  }, [setCurrentIndex, setPlayState, playSentence, stopRaw])

  /**
   * seekTo：只跳转位置，不强制改变播放状态。
   *
   * - 进度条拖拽松手 → 仅移动焦点句
   * - 如果正在播放，从新位置继续；如果暂停，保持暂停
   * - index 按全局索引，clamp 到当前窗口
   */
  const seekTo = useCallback(
    (index: number) => {
      const rawResume = ttsSessionRef.current.isRawActive ? stopRaw(false) : null
      const shouldContinue = rawResume?.shouldResumeBook ?? isPlayingRef.current
      const sents = sentencesRef.current
      const bounds = useBookStore.getState().getRangeBounds()
      let newIndex = Math.max(bounds.start, Math.min(bounds.end - 1, index))
      // Skip empty forward
      const target = findNextPlayableSentence(sents, currentBookRef.current, newIndex, bounds)
      if (target < bounds.end) newIndex = target
      setCurrentIndex(newIndex)
      stopPlayback()
      // Resume if was playing
      if (shouldContinue) {
        ttsSessionRef.current.beginBook()
        isPlayingRef.current = true
        setPlayState('playing')
        playSentence(newIndex)
      }
    },
    [setCurrentIndex, setPlayState, playSentence, stopPlayback, stopRaw]
  )

  /**
   * playFrom：从指定全局索引开始播放（无论之前是否在播放）。
   *
   * 用途：点击句子列表、点击章节下拉 → 用户意图是"从这里开始听"
   * v5 fix: 若整个窗口为空句则 toast + return（防止无提示静默失败）
   */
  const playFrom = useCallback(
    (index: number) => {
      if (ttsSessionRef.current.isRawActive) stopRaw(false)
      const sents = sentencesRef.current
      if (sents.length === 0) {
        showToast('warning', '请先导入书籍')
        return
      }
      boundsRef.current = useBookStore.getState().getRangeBounds()
      const bounds = boundsRef.current
      let newIndex = Math.max(bounds.start, Math.min(bounds.end - 1, index))
      // Skip empty forward
      const target = findNextPlayableSentence(sents, currentBookRef.current, newIndex, bounds)
      if (target >= bounds.end) {
        // Entire window is empty — no valid sentence to play
        showToast('success', '🎉 范围内无有效文本')
        return
      }
      newIndex = target
      setCurrentIndex(newIndex)
      stopPlayback()
      ttsSessionRef.current.beginBook()
      isPlayingRef.current = true
      setPlayState('playing')
      playSentence(newIndex)
    },
    [setCurrentIndex, setPlayState, playSentence, stopPlayback, showToast, stopRaw]
  )

  // Reset to Qwen TTS mode (e.g., when API key is updated)
  const resetToQwenTTS = useCallback(() => {
    setUseSystemTTS(false)
    useSystemTTSRef.current = false
  }, [setUseSystemTTS])

  return {
    play,
    pause,
    stop,
    prevSentence,
    nextSentence,
    seekTo,
    playFrom,
    speakRaw,
    stopRaw,
    resetToQwenTTS
  }
}
