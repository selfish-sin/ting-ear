import type { TTSVoice, TTSEngineConfig } from './adapter'

export interface ProviderVoiceContext {
  apiUrl?: string
  requestTemplate?: Record<string, unknown>
  type?: TTSEngineConfig['type']
}

interface ProviderVoicePreset {
  id: string
  voices: TTSVoice[]
  matches: (context: ProviderVoiceContext) => boolean
}

const OPENAI_TTS_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', description: '中性 · 英文', language: 'en-US' },
  { id: 'ash', name: 'Ash', description: '男声 · 英文', gender: 'male', language: 'en-US' },
  { id: 'ballad', name: 'Ballad', description: '男声 · 英文', gender: 'male', language: 'en-US' },
  { id: 'coral', name: 'Coral', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'echo', name: 'Echo', description: '男声 · 英文', gender: 'male', language: 'en-US' },
  { id: 'fable', name: 'Fable', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'nova', name: 'Nova', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'onyx', name: 'Onyx', description: '男声 · 英文', gender: 'male', language: 'en-US' },
  { id: 'sage', name: 'Sage', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'shimmer', name: 'Shimmer', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'verse', name: 'Verse', description: '男声 · 英文', gender: 'male', language: 'en-US' },
  { id: 'marin', name: 'Marin', description: '女声 · 英文', gender: 'female', language: 'en-US' },
  { id: 'cedar', name: 'Cedar', description: '男声 · 英文', gender: 'male', language: 'en-US' }
]

const MIMO_TTS_VOICES: TTSVoice[] = [
  { id: 'mimo_default', name: 'MiMo-默认', description: '小米 MiMo 默认音色' },
  { id: '冰糖', name: '冰糖', language: 'zh-CN', gender: 'female', description: '小米 MiMo 精品音色' },
  { id: '茉莉', name: '茉莉', language: 'zh-CN', gender: 'female', description: '小米 MiMo 精品音色' },
  { id: '苏打', name: '苏打', language: 'zh-CN', gender: 'male', description: '小米 MiMo 精品音色' },
  { id: '白桦', name: '白桦', language: 'zh-CN', gender: 'male', description: '小米 MiMo 精品音色' },
  { id: 'Mia', name: 'Mia', language: 'en-US', gender: 'female', description: '小米 MiMo 精品音色' },
  { id: 'Chloe', name: 'Chloe', language: 'en-US', gender: 'female', description: '小米 MiMo 精品音色' },
  { id: 'Milo', name: 'Milo', language: 'en-US', gender: 'male', description: '小米 MiMo 精品音色' },
  { id: 'Dean', name: 'Dean', language: 'en-US', gender: 'male', description: '小米 MiMo 精品音色' }
]

const PROVIDER_VOICE_PRESETS: ProviderVoicePreset[] = [
  {
    id: 'mimo',
    voices: MIMO_TTS_VOICES,
    matches: (context) => {
      const model = getTemplateModel(context.requestTemplate)
      return Boolean(context.apiUrl?.includes('xiaomimimo.com') || /^mimo-/i.test(model))
    }
  },
  {
    id: 'openai',
    voices: OPENAI_TTS_VOICES,
    matches: (context) => context.type === 'openai'
  }
]

export function getProviderVoices(context: ProviderVoiceContext): TTSVoice[] {
  const preset = PROVIDER_VOICE_PRESETS.find((candidate) => candidate.matches(context))
  return preset?.voices || []
}

export function mergeVoices(primary: TTSVoice[], fallback: TTSVoice[]): TTSVoice[] | undefined {
  const seen = new Set<string>()
  const merged: TTSVoice[] = []

  for (const voice of [...primary, ...fallback]) {
    if (!voice.id || seen.has(voice.id)) continue
    seen.add(voice.id)
    merged.push(voice)
  }

  return merged.length > 0 ? merged : undefined
}

function getTemplateModel(template: Record<string, unknown> | undefined): string {
  return typeof template?.model === 'string' ? template.model : ''
}
