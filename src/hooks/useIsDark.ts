import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * 当前是否深色主题：显式 light/dark 直接定；system 跟随系统 prefers-color-scheme。
 * 与 App.tsx 的 applyTheme 逻辑一致（App 的效果里因 hooks 规则保留内联 matchMedia）。
 */
export function useIsDark(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme)
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    if (theme === 'dark') {
      setIsDark(true)
      return
    }
    if (theme === 'light') {
      setIsDark(false)
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setIsDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [theme])
  return isDark
}
