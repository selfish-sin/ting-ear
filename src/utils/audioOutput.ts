/**
 * 播放音量输出。
 *
 * HTMLAudioElement.volume 只能 0~1；要做「超过 100%」增益（类似播放器的音量提升），
 * 必须走 Web Audio GainNode。每个 <audio> 只能 createMediaElementSource 一次。
 *
 * 优化策略：
 * - latencyHint:'playback' → 更大内部 buffer，减少 underrun（颤音/电子音）
 * - 复用单一 Audio 元素 → 避免频繁 createMediaElementSource
 */

/** 最大线性音量倍数：2 = 200%（与 playerStore 共用） */
export const VOLUME_MAX = 2.0

let sharedCtx: AudioContext | null = null
const gainByAudio = new WeakMap<HTMLAudioElement, GainNode>()

// 复用的 Audio 元素（整个生命周期只创建一次 MediaElementSource）
let reusableAudio: HTMLAudioElement | null = null
let reusableGain: GainNode | null = null

function getAudioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext({ latencyHint: 'playback' })
  }
  return sharedCtx
}

/** 确保 AudioContext 已恢复（用户手势后浏览器可能 suspend） */
export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      // ignore
    }
  }
}

/**
 * 获取复用的 Audio 元素 + GainNode（幂等）。
 * 整个应用生命周期只创建一次 MediaElementSource，后续只换 src。
 */
export function getReusableAudio(): { audio: HTMLAudioElement; gain: GainNode } {
  if (reusableAudio && reusableGain) {
    return { audio: reusableAudio, gain: reusableGain }
  }
  const ctx = getAudioContext()
  const audio = new Audio()
  audio.preload = 'auto'
  const source = ctx.createMediaElementSource(audio)
  const gain = ctx.createGain()
  source.connect(gain)
  gain.connect(ctx.destination)
  audio.volume = 1
  reusableAudio = audio
  reusableGain = gain
  gainByAudio.set(audio, gain)
  return { audio, gain }
}

/**
 * 将 audio 接入增益管线（幂等）。
 * 元素 volume 固定为 1，实际响度由 GainNode 控制。
 */
export function attachBoostPipeline(audio: HTMLAudioElement): GainNode {
  const existing = gainByAudio.get(audio)
  if (existing) return existing

  const ctx = getAudioContext()
  const source = ctx.createMediaElementSource(audio)
  const gain = ctx.createGain()
  source.connect(gain)
  gain.connect(ctx.destination)
  audio.volume = 1
  gainByAudio.set(audio, gain)
  return gain
}

/**
 * 设置播放响度。volume 为线性倍数：1 = 100%，2 = 200%。
 * muted 时为 0。
 */
export function setPlaybackVolume(
  audio: HTMLAudioElement | null,
  volume: number,
  muted = false
): void {
  if (!audio) return
  const linear = muted ? 0 : Math.max(0, Math.min(VOLUME_MAX, volume))
  const gain = attachBoostPipeline(audio)
  audio.volume = 1
  gain.gain.value = linear
}

/** 系统 Web Speech 只支持 0~1，超限时钳到 1 */
export function clampSystemSpeechVolume(volume: number, muted: boolean): number {
  if (muted) return 0
  return Math.max(0, Math.min(1, volume))
}
