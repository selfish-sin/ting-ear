import { useCallback, useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { useBookStore } from '../stores/bookStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { ToastItem } from '../global'

// TTS 错误码
enum TTSError {
  API_KEY_INVALID = 'API_KEY_INVALID',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR'
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
    setCurrentAudio
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
  const apiKeyRef = useRef(settings.qwenApiKey)
  const endpointRef = useRef(settings.qwenEndpoint)
  const engineIdRef = useRef<string>(settings.ttsEngine || 'edge')
  const boundsRef = useRef<{ start: number; end: number }>({ start: 0, end: sentences.length })

  // 预缓存追踪：记录哪句已经后台合成了
  const prefetchSet = useRef(new Set<number>())

  // 预缓存并发池：限制同时请求数，避免压垮 TTS 服务
  const PREFETCH_CONCURRENCY = 1
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

  // Sync refs
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { volumeRef.current = volume }, [volume])
  useEffect(() => { isMutedRef.current = isMuted }, [isMuted])
  useEffect(() => { voiceIdRef.current = voiceId }, [voiceId])
  useEffect(() => { useSystemTTSRef.current = useSystemTTS }, [useSystemTTS])
  useEffect(() => {
    sentencesRef.current = sentences
    boundsRef.current = useBookStore.getState().getRangeBounds()
  }, [sentences, currentBook])
  useEffect(() => { currentIndexRef.current = currentSentenceIndex }, [currentSentenceIndex])
  useEffect(() => { apiKeyRef.current = settings.qwenApiKey }, [settings.qwenApiKey])
  useEffect(() => { endpointRef.current = settings.qwenEndpoint }, [settings.qwenEndpoint])
  useEffect(() => { engineIdRef.current = settings.ttsEngine || usePlayerStore.getState().ttsEngine || 'edge' }, [settings.ttsEngine, usePlayerStore.getState().ttsEngine])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback()
    }
  }, [])

  // --- Atomic index setter ---
  // Every write to currentSentenceIndex MUST go through this to keep ref + store in sync.
  const setCurrentIndex = useCallback((idx: number) => {
    currentIndexRef.current = idx
    setCurrentSentenceIndex(idx)
  }, [setCurrentSentenceIndex])

  // Stop all current playback AND cancel all in-flight TTS requests
  const stopPlayback = useCallback(() => {
    genIdRef.current++  // Invalidate all in-flight generation tokens
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
      setCurrentAudio(null)
    }
    if (utteranceRef.current) {
      window.speechSynthesis.cancel()
      utteranceRef.current = null
    }
  }, [setCurrentAudio])

  // --- Helpers for empty-sentence skipping ---

  /** Find next non-empty sentence index in [start, bounds.end) */
  function skipEmptyForward(start: number, sents: string[], bounds: { start: number; end: number }): number {
    let target = start
    while (target < bounds.end) {
      const t = sents[target]
      if (t && t.trim().length > 0) break
      target++
    }
    return target
  }

  /** Find previous non-empty sentence index in [bounds.start, start] */
  function skipEmptyBackward(start: number, sents: string[], bounds: { start: number; end: number }): number {
    let target = start
    while (target >= bounds.start) {
      const t = sents[target]
      if (t && t.trim().length > 0) break
      target--
    }
    return target < bounds.start ? bounds.start : target
  }

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
      const target = skipEmptyForward(clamped, sents, bounds)
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
      // Edge TTS is free and doesn't need an API key — always try main-process first
      if (!useSystemTTSRef.current) {
        try {
          const result = (await window.api?.ttsSynthesize(
            text,
            voiceIdRef.current,
            speedRef.current,
            isMutedRef.current ? 0 : volumeRef.current,
            engineIdRef.current
          )) as TTSResult

          // Discard stale result (user has moved on)
          if (myGen !== genIdRef.current) return

          if (result?.success && result.audio) {
            // v5: 用 Blob URL 替代 data URL，修复 WAV 在 Electron 中解码失败的问题
            const mime = result.audioFormat === 'wav' ? 'audio/wav' : 'audio/mp3'
            const binaryStr = atob(result.audio)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            const blob = new Blob([bytes], { type: mime })
            const blobUrl = URL.createObjectURL(blob)
            const audio = new Audio(blobUrl)
            const cleanup = () => { try { URL.revokeObjectURL(blobUrl) } catch { /* ignore */ } }

            audio.volume = isMutedRef.current ? 0 : Math.max(0, Math.min(1, volumeRef.current))
            audio.playbackRate = 1.0
            audioRef.current = audio
            setCurrentAudio(audio)

            // === 预缓存后续句子（并发池 + 5句窗口） ===
            // 播当前句时后台合成本句之后的句子到磁盘缓存，切句时命中秒出
            const bounds = useBookStore.getState().getRangeBounds()
            const sents = sentencesRef.current
            const PREFETCH_WINDOW = 5
            for (let i = 1; i <= PREFETCH_WINDOW; i++) {
              const idx = sentIndex + i
              if (idx >= bounds.end) break
              if (prefetchSet.current.has(idx)) continue
              const t = sents[idx]
              if (!t || !t.trim()) continue
              prefetchSet.current.add(idx)
              const task = () => {
                window.api!.ttsSynthesize(
                  t, voiceIdRef.current, speedRef.current,
                  isMutedRef.current ? 0 : volumeRef.current,
                  engineIdRef.current
                ).catch(() => {
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
              cleanup()
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
              cleanup()
              if (myGen !== genIdRef.current) return
              console.error('Audio playback error')
              showToast('warning', '音频播放失败，切换至离线模式')
              setUseSystemTTS(true)
              useSystemTTSRef.current = true
              playWithSystemTTS(text, sentIndex, myGen)
            }

            await audio.play().catch(() => {
              cleanup()
              if (myGen !== genIdRef.current) return
              showToast('warning', '音频播放失败，切换至离线模式')
              setUseSystemTTS(true)
              useSystemTTSRef.current = true
              playWithSystemTTS(text, sentIndex, myGen)
            })
            return
          } else if (result?.fallback) {
            if (myGen !== genIdRef.current) return
            const reason = result.error
            if (reason === TTSError.API_KEY_INVALID) {
              showToast('error', 'API Key 无效，已切换离线 TTS')
            } else if (reason === TTSError.QUOTA_EXCEEDED) {
              showToast('warning', '免费额度已用完，已切换离线 TTS')
            } else if (reason === TTSError.TIMEOUT) {
              showToast('warning', '网络不畅，已切换离线 TTS')
            } else {
              showToast('warning', '网络异常，已切换离线 TTS')
            }
            setUseSystemTTS(true)
            useSystemTTSRef.current = true
            playWithSystemTTS(text, sentIndex, myGen)
            return
          } else {
            if (myGen !== genIdRef.current) return
            showToast('warning', `TTS 错误: ${result?.error || '未知'}，已切换离线 TTS`)
            setUseSystemTTS(true)
            useSystemTTSRef.current = true
            playWithSystemTTS(text, sentIndex, myGen)
            return
          }
        } catch (error) {
          if (myGen !== genIdRef.current) return
          console.error('TTS error:', error)
          showToast('warning', '网络异常，已切换离线 TTS')
          setUseSystemTTS(true)
          useSystemTTSRef.current = true
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
      utterance.volume = isMutedRef.current ? 0 : Math.max(0, Math.min(1, volumeRef.current))

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

  // === Public API ===

  const play = useCallback(() => {
    if (sentencesRef.current.length === 0) {
      showToast('warning', '请先导入书籍')
      return
    }
    boundsRef.current = useBookStore.getState().getRangeBounds()
    // Atomic sync: always read current index from store (fixes bookmark/history/restore entries)
    currentIndexRef.current = usePlayerStore.getState().currentSentenceIndex
    isPlayingRef.current = true
    setPlayState('playing')
    playSentence(currentIndexRef.current)
  }, [playSentence, setPlayState, showToast])

  const pause = useCallback(() => {
    isPlayingRef.current = false
    setPlayState('paused')
    stopPlayback()
  }, [setPlayState, stopPlayback])

  const stop = useCallback(() => {
    isPlayingRef.current = false
    setPlayState('stopped')
    stopPlayback()
    const start = useBookStore.getState().getRangeBounds().start
    setCurrentIndex(start)
  }, [setPlayState, stopPlayback, setCurrentIndex])

  const prevSentence = useCallback(() => {
    const bounds = useBookStore.getState().getRangeBounds()
    const sents = sentencesRef.current
    // Step back then skip empty backward-facing
    const stepped = Math.max(bounds.start, currentIndexRef.current - 1)
    const newIndex = skipEmptyBackward(stepped, sents, bounds)
    setCurrentIndex(newIndex)
    if (isPlayingRef.current) {
      playSentence(newIndex)
    }
  }, [setCurrentIndex, playSentence])

  const nextSentence = useCallback(() => {
    const bounds = useBookStore.getState().getRangeBounds()
    const sents = sentencesRef.current
    // Step forward then skip empty forward-facing
    const stepped = Math.min(bounds.end - 1, currentIndexRef.current + 1)
    const newIndex = skipEmptyForward(stepped, sents, bounds)
    if (newIndex >= bounds.end) {
      setCurrentIndex(bounds.end - 1)
      return
    }
    setCurrentIndex(newIndex)
    if (isPlayingRef.current) {
      playSentence(newIndex)
    }
  }, [setCurrentIndex, playSentence])

  /**
   * seekTo：只跳转位置，不强制改变播放状态。
   *
   * - 进度条拖拽松手 → 仅移动焦点句
   * - 如果正在播放，从新位置继续；如果暂停，保持暂停
   * - index 按全局索引，clamp 到当前窗口
   */
  const seekTo = useCallback(
    (index: number) => {
      const sents = sentencesRef.current
      const bounds = useBookStore.getState().getRangeBounds()
      let newIndex = Math.max(bounds.start, Math.min(bounds.end - 1, index))
      // Skip empty forward
      const target = skipEmptyForward(newIndex, sents, bounds)
      if (target < bounds.end) newIndex = target
      setCurrentIndex(newIndex)
      stopPlayback()
      // Resume if was playing
      if (isPlayingRef.current) {
        playSentence(newIndex)
      }
    },
    [setCurrentIndex, playSentence, stopPlayback]
  )

  /**
   * playFrom：从指定全局索引开始播放（无论之前是否在播放）。
   *
   * 用途：点击句子列表、点击章节下拉 → 用户意图是"从这里开始听"
   * v5 fix: 若整个窗口为空句则 toast + return（防止无提示静默失败）
   */
  const playFrom = useCallback(
    (index: number) => {
      const sents = sentencesRef.current
      if (sents.length === 0) {
        showToast('warning', '请先导入书籍')
        return
      }
      boundsRef.current = useBookStore.getState().getRangeBounds()
      const bounds = boundsRef.current
      let newIndex = Math.max(bounds.start, Math.min(bounds.end - 1, index))
      // Skip empty forward
      const target = skipEmptyForward(newIndex, sents, bounds)
      if (target >= bounds.end) {
        // Entire window is empty — no valid sentence to play
        showToast('success', '🎉 范围内无有效文本')
        return
      }
      newIndex = target
      setCurrentIndex(newIndex)
      stopPlayback()
      isPlayingRef.current = true
      setPlayState('playing')
      playSentence(newIndex)
    },
    [setCurrentIndex, setPlayState, playSentence, stopPlayback, showToast]
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
    resetToQwenTTS
  }
}
