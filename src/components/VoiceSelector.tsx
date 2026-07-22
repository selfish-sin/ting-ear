import { useEffect, useState, useRef, useCallback } from 'react'
import { ChevronDown, Volume2, Loader2, Check } from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { TTSVoice, TTSEngineConfig, ToastItem } from '../global'

interface VoiceSelectorProps {
  /** 紧凑模式（ControlBar 用）：宽度更窄，仅显示音色名 */
  compact?: boolean
  showToast: (type: ToastItem['type'], message: string) => void
}

/** 性别 → 中文标签 + emoji */
function genderLabel(g?: 'male' | 'female'): { text: string; emoji: string } | null {
  if (g === 'female') return { text: '女声', emoji: '♀' }
  if (g === 'male') return { text: '男声', emoji: '♂' }
  return null
}

/** 语言代码 → 简短标签 */
function languageLabel(lang?: string): string | null {
  if (!lang) return null
  if (lang.startsWith('zh')) return '中文'
  if (lang.startsWith('en')) return '英文'
  return lang
}

export default function VoiceSelector({ compact = false, showToast }: VoiceSelectorProps) {
  const { voiceId, setVoiceId, useSystemTTS, setUseSystemTTS } = usePlayerStore()
  const { setSettings, saveSettings } = useSettingsStore()

  const [engines, setEngines] = useState<TTSEngineConfig[]>([])
  const [activeEngine, setActiveEngine] = useState<string>('edge')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 初次挂载拉取引擎列表 + 当前活动引擎
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, active] = await Promise.all([
          window.api?.ttsGetEngines(),
          window.api?.ttsGetActiveEngine()
        ])
        if (cancelled) return
        if (list) setEngines(list.filter((e) => e.enabled && e.voices && e.voices.length > 0))
        if (active) setActiveEngine(active)
      } catch (e) {
        console.error('Failed to load TTS engines:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  // 卸载时停止试听
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current.src = ''
      }
    }
  }, [])

  // 当前选中的音色对象（用于触发按钮显示）
  const currentVoice: TTSVoice | null = (() => {
    for (const e of engines) {
      const v = e.voices?.find((vv) => vv.id === voiceId)
      if (v) return v
    }
    return null
  })()
  const currentEngine = engines.find((e) => e.id === activeEngine)

  // 选中某个音色：更新 store + 持久化 + 同步后端活动引擎
  const handleSelect = useCallback(
    async (engine: TTSEngineConfig, voice: TTSVoice) => {
      setVoiceId(voice.id)
      // 系统引擎 → 离线模式；在线引擎 → 关闭离线模式
      if (engine.id === 'system') {
        setUseSystemTTS(true)
        setSettings({ voiceId: voice.id, ttsEngine: 'system' })
        void saveSettings()
        setOpen(false)
        return
      }
      // 切换回在线引擎时关闭离线模式
      if (useSystemTTS) {
        setUseSystemTTS(false)
      }
      // 若音色所属引擎与当前活动引擎不同，切换之（后端 + 本地状态）
      if (engine.id !== activeEngine) {
        setActiveEngine(engine.id)
        try {
          await window.api?.ttsSetActiveEngine(engine.id)
        } catch (e) {
          console.error('setActiveEngine failed:', e)
        }
      }
      // 持久化到 settings.json
      setSettings({ voiceId: voice.id, ttsEngine: engine.id })
      void saveSettings()
      setOpen(false)
    },
    [voiceId, activeEngine, useSystemTTS, setVoiceId, setUseSystemTTS, setSettings, saveSettings]
  )

  // 试听：调用 ttsPreviewVoice 合成一句示例，用 <audio> 播放
  const handlePreview = useCallback(
    async (engine: TTSEngineConfig, voice: TTSVoice, e: React.MouseEvent) => {
      e.stopPropagation()
      // 停止上一个试听
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current.src = ''
      }
      setPreviewingId(voice.id)
      try {
        const result = await window.api?.ttsPreviewVoice(engine.id, voice.id)
        if (result?.success && result.audio) {
          const mime = result.audioFormat === 'wav' ? 'audio/wav' : 'audio/mp3'
          const audio = new Audio(`data:${mime};base64,${result.audio}`)
          previewAudioRef.current = audio
          audio.onended = () => setPreviewingId(null)
          audio.onerror = () => {
            setPreviewingId(null)
            showToast('error', '试听失败')
          }
          await audio.play().catch(() => {
            setPreviewingId(null)
            showToast('warning', '试听播放失败')
          })
        } else {
          setPreviewingId(null)
          showToast('warning', result?.error || '试听失败，可能需要配置 API Key')
        }
      } catch (err) {
        setPreviewingId(null)
        showToast('error', `试听失败: ${String(err)}`)
      }
    },
    [showToast]
  )

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>加载音色…</span>
      </div>
    )
  }

  if (engines.length === 0) {
    return (
      <div className="text-xs text-gray-400" title="未配置可用 TTS 引擎">
        无可用音色
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-600 dark:text-gray-300 hover:border-primary/50 transition-colors ${
          compact ? 'max-w-[130px]' : 'max-w-[220px]'
        }`}
        title={currentVoice ? `${currentVoice.name}${currentEngine ? ' · ' + currentEngine.name.split('（')[0] : ''}` : '选择音色'}
      >
        <span className="truncate flex-1 text-left">
          {currentVoice ? currentVoice.name : '选择音色'}
        </span>
        {!compact && currentEngine && (
          <span className="flex-shrink-0 text-[10px] text-primary/70 bg-primary/10 px-1 rounded">
            {currentEngine.name.split('（')[0]}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-80 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
          {engines.map((engine, ei) => (
            <div key={engine.id}>
              {/* 引擎名头部 */}
              {ei > 0 && <div className="h-px bg-gray-100 dark:bg-gray-700 my-1.5 mx-3" />}
              <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 mx-1 rounded">
                {engine.name.split('（')[0]}
              </div>
              {/* 音色列表 */}
              {engine.voices?.map((voice) => {
                const g = genderLabel(voice.gender)
                const lang = languageLabel(voice.language)
                const isSelected = voice.id === voiceId
                const isPreviewing = previewingId === voice.id
                return (
                  <div
                    key={voice.id}
                    onClick={() => handleSelect(engine, voice)}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary/10'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    {/* 选中标记 */}
                    <div className="w-4 flex-shrink-0">
                      {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    {/* 音色名 + 徽章 */}
                    <span className={`text-xs truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-gray-700 dark:text-gray-200'}`}>
                      {voice.name}
                    </span>
                    {g && (
                      <span className="text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {g.text}
                      </span>
                    )}
                    {lang && (
                      <span className="text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {lang}
                      </span>
                    )}
                    {/* 试听按钮 */}
                    <button
                      onClick={(e) => handlePreview(engine, voice, e)}
                      className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-primary hover:bg-primary/10 transition-colors"
                      title="试听"
                      disabled={isPreviewing}
                    >
                      {isPreviewing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
