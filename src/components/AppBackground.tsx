import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

/** 解析当前主题是否为深色（与 App.tsx 的逻辑一致） */
function useIsDark(): boolean {
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
    // system
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setIsDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [theme])
  return isDark
}

/**
 * 全应用根层背景图。disabled 或图片缺失时返回 null，由根 div 纯色兜底。
 * 渲染：<img> 背景层 + 半透明遮罩层；pointer-events-none 不挡交互。
 */
export default function AppBackground() {
  const background = useSettingsStore((s) => s.settings.background)
  const isDark = useIsDark()
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // 图源变化时重新解析为 data URL
  useEffect(() => {
    if (!background?.enabled) {
      setImgUrl(null)
      setFailed(false)
      return
    }
    let cancelled = false
    const key = background.source === 'preset' ? background.presetId : background.customPath
    window.api
      ?.backgroundResolve(background.source, key)
      .then((url) => {
        if (cancelled) return
        setImgUrl(url)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setImgUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [background?.enabled, background?.source, background?.presetId, background?.customPath])

  if (!background?.enabled || !imgUrl || failed) return null

  const overlayHex =
    background.overlayColor === 'auto' ? (isDark ? '#000000' : '#ffffff') : background.overlayColor

  const objectFit =
    background.fit === 'stretch' ? 'fill' : background.fit === 'contain' ? 'contain' : 'cover'

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      <img
        src={imgUrl}
        alt=""
        aria-hidden="true"
        className="w-full h-full"
        style={{
          objectFit,
          filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
          // blur 露出边缘，略微放大遮住透明边
          transform: background.blur > 0 ? 'scale(1.05)' : undefined
        }}
        onError={() => setFailed(true)}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: overlayHex, opacity: background.overlayOpacity }}
      />
    </div>
  )
}
