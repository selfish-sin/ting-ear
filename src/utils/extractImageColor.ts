/**
 * 从图片 data URL 取样主色（缩小后平均，忽略近白/近黑极端像素）。
 * 用于「底层纯色 = 取自背景图」。
 */

const SAMPLE = 48

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/**
 * 从 data:image/... 取平均色。失败返回 null。
 * 浏览器 / Electron 渲染进程可用；Node 测试用 mock 或跳过 DOM 路径。
 */
export function extractAverageColorFromDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE
        canvas.height = SAMPLE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          if (a < 200) continue
          const pr = data[i]
          const pg = data[i + 1]
          const pb = data[i + 2]
          // 跳过过亮/过暗，避免纯白边或死黑拖色
          const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb
          if (lum < 18 || lum > 240) continue
          r += pr
          g += pg
          b += pb
          n++
        }
        if (n === 0) {
          // 全极端时退回全像素平均
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 200) continue
            r += data[i]
            g += data[i + 1]
            b += data[i + 2]
            n++
          }
        }
        if (n === 0) {
          resolve(null)
          return
        }
        resolve(rgbToHex(r / n, g / n, b / n))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/** 浅色主题默认底色 / 深色主题默认底色（与 tailwind surface 一致） */
export const THEME_BASE_LIGHT = '#F8F9FC'
export const THEME_BASE_DARK = '#1C1F28'

/**
 * 解析底层纯色。
 * baseColor: 'auto' | 'fromImage' | #hex
 */
export function resolveBaseColor(
  baseColor: string | undefined,
  isDark: boolean,
  cachedFromImage: string | null | undefined
): string {
  const mode = baseColor ?? 'auto'
  if (mode === 'auto') return isDark ? THEME_BASE_DARK : THEME_BASE_LIGHT
  if (mode === 'fromImage') {
    if (cachedFromImage && /^#[0-9A-Fa-f]{6}$/.test(cachedFromImage)) {
      return cachedFromImage.toUpperCase()
    }
    // 图还没取到色时，先跟主题，避免闪白
    return isDark ? THEME_BASE_DARK : THEME_BASE_LIGHT
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(mode)) return mode.toUpperCase()
  return isDark ? THEME_BASE_DARK : THEME_BASE_LIGHT
}
