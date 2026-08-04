import { defaultSettings, useSettingsStore } from '../src/stores/settingsStore'
import type { BackgroundSettings } from '../src/global'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label}`)
    }
  } catch (error) {
    failed++
    console.log(`  fail ${label} - ${(error as Error).message}`)
  }
}

const expectedDefault: BackgroundSettings = {
  enabled: false,
  source: 'preset',
  presetId: null,
  customPath: null,
  fit: 'cover',
  blur: 0,
  overlayColor: 'auto',
  overlayOpacity: 0.7
}

assert('defaultSettings.background 字段完整且默认关闭', () => {
  const bg = defaultSettings.background as BackgroundSettings | undefined
  if (!bg) return false
  return (Object.keys(expectedDefault) as Array<keyof BackgroundSettings>).every(
    (k) => bg[k] === expectedDefault[k]
  )
})

assert('setBackground 局部更新并保留其它字段', () => {
  const store = useSettingsStore.getState()
  // 重置到默认，避免被前序 case 污染
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  store.setBackground({ enabled: true, overlayOpacity: 0.5 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.enabled === true && bg.overlayOpacity === 0.5 && bg.fit === 'cover' && bg.blur === 0
})

assert('setBackground 未提供的字段保持不变', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ blur: 8 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.blur === 8 && bg.enabled === false && bg.overlayOpacity === 0.7
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
