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
  blur: 0,
  overlayOpacity: 0.55,
  baseColor: 'auto',
  baseColorCached: null,
  panelOpacity: 0.72,
  contentOpacity: 0.9,
  glass: false
}

assert('defaultSettings.background 精简默认完整', () => {
  const bg = defaultSettings.background as BackgroundSettings | undefined
  if (!bg) return false
  return (Object.keys(expectedDefault) as Array<keyof BackgroundSettings>).every(
    (k) => bg[k] === expectedDefault[k]
  )
})

assert('setBackground 局部更新', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ enabled: true, overlayOpacity: 0.4 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.enabled === true && bg.overlayOpacity === 0.4 && bg.blur === 0 && bg.glass === false
})

assert('setBackground glass 毛玻璃', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ glass: true, panelOpacity: 0.5 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.glass === true && bg.panelOpacity === 0.5
})

assert('setBackground baseColor fromImage', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ baseColor: 'fromImage', baseColorCached: '#112233' })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.baseColor === 'fromImage' && bg.baseColorCached === '#112233'
})

assert('setBackground contentOpacity 阅读遮罩', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ contentOpacity: 0.84 })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.contentOpacity === 0.84
})

assert('「无背景」选项：enabled=false 且保留源', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ source: 'preset', presetId: 'aurora', enabled: true })
  // 选中「无背景」只关 enabled，不破坏其他字段
  useSettingsStore.getState().setBackground({ enabled: false })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return bg.enabled === false && bg.presetId === 'aurora'
})

assert('删除自定义图落到「无背景」有效态', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings } })
  useSettingsStore.getState().setBackground({ source: 'custom', customPath: 'custom/x.jpg', enabled: true })
  // 面板删除逻辑：presetId:null + enabled:false = 无背景（不是坏 preset 态）
  useSettingsStore.getState().setBackground({ source: 'preset', presetId: null, enabled: false })
  const bg = useSettingsStore.getState().settings.background as BackgroundSettings
  return (
    bg.enabled === false &&
    bg.source === 'preset' &&
    bg.presetId === null &&
    bg.customPath === 'custom/x.jpg'
  )
})

assert('默认配置不含旧 fit/overlayColor/panelColor 字段', () => {
  const bg = defaultSettings.background as BackgroundSettings
  return (
    'fit' in bg === false &&
    'overlayColor' in bg === false &&
    'panelColor' in bg === false &&
    bg.panelEffect === undefined
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
