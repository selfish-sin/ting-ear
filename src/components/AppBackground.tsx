import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useIsDark } from '../hooks/useIsDark'
import {
  extractAverageColorFromDataUrl,
  resolveBaseColor
} from '../utils/extractImageColor'

/**
 * 根层背景两层：
 *  ① 底层纯色（跟日夜 / 取自图 / 自定义）
 *  ② 可选底图 + 压暗遮罩（遮罩色固定跟日夜）
 * 组件层在 App 其它子树之上。
 */
export default function AppBackground() {
  const background = useSettingsStore((s) => s.settings.background)
  const setBackground = useSettingsStore((s) => s.setBackground)
  const isDark = useIsDark()
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

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

  // 取自背景图：加载后取样
  useEffect(() => {
    if (background?.baseColor !== 'fromImage') return
    if (!background?.enabled || !imgUrl || failed) return
    let cancelled = false
    void extractAverageColorFromDataUrl(imgUrl).then((hex) => {
      if (cancelled || !hex) return
      const prev = background.baseColorCached
      if (prev && prev.toUpperCase() === hex.toUpperCase()) return
      setBackground({ baseColorCached: hex })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    background?.baseColor,
    background?.enabled,
    background?.source,
    background?.presetId,
    background?.customPath,
    imgUrl,
    failed,
    setBackground
  ])

  const baseHex = resolveBaseColor(background?.baseColor, isDark, background?.baseColorCached)
  const showImage = Boolean(background?.enabled && imgUrl && !failed)
  // 压暗：浅色用白罩、深色用黑罩（不再单独选遮罩色）
  const overlayHex = isDark ? '#000000' : '#ffffff'
  const dim = typeof background?.overlayOpacity === 'number' ? background.overlayOpacity : 0.55
  const blur = background?.blur ?? 0

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0" style={{ backgroundColor: baseHex }} />
      {showImage && (
        <>
          <img
            src={imgUrl!}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              filter: blur > 0 ? `blur(${blur}px)` : undefined,
              transform: blur > 0 ? 'scale(1.05)' : undefined
            }}
            onError={() => setFailed(true)}
          />
          <div className="absolute inset-0" style={{ backgroundColor: overlayHex, opacity: dim }} />
        </>
      )}
    </div>
  )
}
