/**
 * 自动生成书籍封面（PNG data URL）。
 *
 * 设计目标：浅色书架与深色书架都好看（不再用「深夜厚色」一刀切）。
 * - 以浅色纸张 / 柔和色块为主底，深色文字保证可读
 * - 每本书标题哈希定色，书架上仍可一眼区分
 * - 轻阴影与纸边感，贴在白卡片上不「发脏」
 */

// ── 配色方案（浅色友好：中浅底 + 深字） ───────────────────
interface Palette {
  bgFrom: string
  bgTo: string
  accent: string
  title: string
  subtitle: string
  pattern: string
  /** 封面外缘细线，浅色模式下与白卡片分离 */
  edge: string
}

const PALETTES: Palette[] = [
  // 雾蓝纸
  {
    bgFrom: '#E8F0FA',
    bgTo: '#D0E0F4',
    accent: '#3B6FB6',
    title: '#1A2B45',
    subtitle: '#4A6488',
    pattern: '#A8C4E4',
    edge: '#B8CEE8'
  },
  // 薄荷绿
  {
    bgFrom: '#E6F5EF',
    bgTo: '#CDEBD9',
    accent: '#2F8F6B',
    title: '#163D2E',
    subtitle: '#3D6B58',
    pattern: '#9DD4BB',
    edge: '#A8D9C4'
  },
  // 淡紫
  {
    bgFrom: '#F0EAF8',
    bgTo: '#DDD0F0',
    accent: '#6B4FA3',
    title: '#2A1F45',
    subtitle: '#5A4A78',
    pattern: '#C4B0E0',
    edge: '#C9B8E4'
  },
  // 暖杏
  {
    bgFrom: '#FBF3E8',
    bgTo: '#F0E0C8',
    accent: '#C07A2C',
    title: '#3D2A14',
    subtitle: '#7A5A38',
    pattern: '#E0C8A0',
    edge: '#E4CFA8'
  },
  // 柔珊瑚
  {
    bgFrom: '#FCEEEC',
    bgTo: '#F5D8D4',
    accent: '#C04A4A',
    title: '#3D1E1E',
    subtitle: '#7A4848',
    pattern: '#E8B8B4',
    edge: '#E8C0BC'
  },
  // 青灰
  {
    bgFrom: '#E8F2F4',
    bgTo: '#D0E4EA',
    accent: '#2E7A8A',
    title: '#163840',
    subtitle: '#3D6870',
    pattern: '#A8D0D8',
    edge: '#B0D4DC'
  },
  // 浅玫瑰
  {
    bgFrom: '#F8EAF2',
    bgTo: '#EDD4E4',
    accent: '#B04A80',
    title: '#3D1F32',
    subtitle: '#784A64',
    pattern: '#E0B0CC',
    edge: '#E4B8D0'
  },
  // 石灰蓝
  {
    bgFrom: '#ECEFF5',
    bgTo: '#D8DEEA',
    accent: '#4A5F9E',
    title: '#1E2740',
    subtitle: '#4A5678',
    pattern: '#B8C0D8',
    edge: '#C0C8DC'
  },
  // 米白绿
  {
    bgFrom: '#F4F6F0',
    bgTo: '#E4EAD8',
    accent: '#5A7A3A',
    title: '#2A341C',
    subtitle: '#5A6848',
    pattern: '#C8D4B0',
    edge: '#D0D8B8'
  },
  // 浅焦糖
  {
    bgFrom: '#F7F0E8',
    bgTo: '#EBDCCC',
    accent: '#8B5E3C',
    title: '#3A2818',
    subtitle: '#6B5040',
    pattern: '#D8C4B0',
    edge: '#DCC8B4'
  }
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * 封面缓存键：含样式版本号，升级配色方案后自动触发重新生成。
 */
const COVER_STYLE_VERSION = 'v2-light'

export function computeCoverHash(title: string, author?: string): string {
  const raw = `${COVER_STYLE_VERSION}|${title.trim()}|${(author || '').trim()}`
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < raw.length; i++) {
    h1 = Math.imul(h1 ^ raw.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ raw.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export const COVER_HASH_KEY_PREFIX = 'ting-ear-cover-hash-'

export function getStoredCoverHash(bookId: string): string | null {
  try {
    return localStorage.getItem(COVER_HASH_KEY_PREFIX + bookId)
  } catch {
    return null
  }
}

export function setStoredCoverHash(bookId: string, hash: string): void {
  try {
    localStorage.setItem(COVER_HASH_KEY_PREFIX + bookId, hash)
  } catch {
    // ignore
  }
}

function getPalette(title: string): Palette {
  return PALETTES[hashStr(title) % PALETTES.length]
}

interface TitleSplit {
  main: string
  sub: string
}

function splitTitle(title: string): TitleSplit | null {
  const delimiters = ['：', ':', '——']
  for (const d of delimiters) {
    const idx = title.indexOf(d)
    if (idx > 0) {
      const main = title.slice(0, idx).trim()
      const sub = title.slice(idx + d.length).trim()
      if (main.length >= 1 && sub.length >= 1) return { main, sub }
    }
  }
  return null
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
  fontSize: number,
  fontFamily: string
): string[] {
  ctx.font = `${fontSize}px ${fontFamily}`
  const chars = text.split('')
  const lines: string[] = []
  let cur = ''

  for (const ch of chars) {
    const test = cur + ch
    if (ctx.measureText(test).width > maxW && cur.length > 0) {
      lines.push(cur)
      cur = ch
      if (lines.length >= maxLines) {
        let last = cur
        while (
          lines.length === maxLines - 1 &&
          ctx.measureText(last + '…').width > maxW &&
          last.length > 0
        ) {
          last = last.slice(0, -1)
        }
        lines.push(last + '…')
        return lines
      }
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

export function generateCoverDataUrl(
  title: string,
  author?: string,
  width = 300,
  height = 400
): string {
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  const w = width
  const h = height
  const pal = getPalette(title)

  // ── 圆角纸面背景 ──
  const r = 10
  const drawRoundRect = (x: number, y: number, rw: number, rh: number, radius: number) => {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + rw, y, x + rw, y + rh, radius)
    ctx.arcTo(x + rw, y + rh, x, y + rh, radius)
    ctx.arcTo(x, y + rh, x, y, radius)
    ctx.arcTo(x, y, x + rw, y, radius)
    ctx.closePath()
  }

  // 轻微外阴影（画在透明底上）
  ctx.save()
  ctx.shadowColor = 'rgba(30, 40, 60, 0.12)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 3
  const grad = ctx.createLinearGradient(0, 0, w * 0.2, h)
  grad.addColorStop(0, pal.bgFrom)
  grad.addColorStop(1, pal.bgTo)
  ctx.fillStyle = grad
  drawRoundRect(2, 2, w - 4, h - 4, r)
  ctx.fill()
  ctx.restore()

  // 内边框
  ctx.strokeStyle = pal.edge
  ctx.lineWidth = 1.5
  drawRoundRect(3, 3, w - 6, h - 6, r - 1)
  ctx.stroke()

  // 顶部色条
  ctx.fillStyle = pal.accent
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(3 + r - 1, 3)
  ctx.lineTo(w - 3 - (r - 1), 3)
  ctx.arcTo(w - 3, 3, w - 3, 3 + r, r - 1)
  ctx.lineTo(w - 3, 3 + 6)
  ctx.lineTo(3, 3 + 6)
  ctx.lineTo(3, 3 + r - 1)
  ctx.arcTo(3, 3, 3 + r, 3, r - 1)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1

  // 右侧竖向装饰块
  ctx.fillStyle = pal.pattern
  ctx.globalAlpha = 0.55
  ctx.fillRect(w - 28, 48, 4, h - 100)
  ctx.globalAlpha = 0.35
  ctx.fillRect(w - 22, 64, 2, h - 120)
  ctx.globalAlpha = 1

  // ── 标题区域 ──
  const padX = 28
  const titleMaxW = w - padX * 2 - 12
  const authorH = author && author.trim() ? 36 : 0
  const titleAreaTop = 42
  const titleAreaBottom = h - 36 - authorH
  const titleAreaH = titleAreaBottom - titleAreaTop
  const fontFamily = '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 浅色底不需要重阴影
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  const split = splitTitle(title)

  if (split) {
    const sepH = 16
    const subRatio = 0.48
    let mainSize = 16
    let mainLines: string[] = []
    let subSize = 12
    let subLines: string[] = []

    for (let fs = 42; fs >= 15; fs -= 1) {
      const sfs = Math.max(12, Math.round(fs * subRatio))
      const mL = wrapText(ctx, split.main, titleMaxW, 3, fs, fontFamily)
      const sL = wrapText(ctx, split.sub, titleMaxW, 3, sfs, fontFamily)
      const totalH = mL.length * fs * 1.28 + sepH + sL.length * sfs * 1.38
      if (totalH <= titleAreaH) {
        mainSize = fs
        mainLines = mL
        subSize = sfs
        subLines = sL
        break
      }
    }
    if (mainLines.length === 0) {
      mainLines = wrapText(ctx, split.main, titleMaxW, 3, 16, fontFamily)
      mainSize = 16
      subSize = 12
      subLines = wrapText(ctx, split.sub, titleMaxW, 3, 12, fontFamily)
    }

    const mainLH = mainSize * 1.28
    const subLH = subSize * 1.38
    const totalH = mainLines.length * mainLH + sepH + subLines.length * subLH
    let y = titleAreaTop + (titleAreaH - totalH) / 2 + mainLH / 2

    ctx.font = `600 ${mainSize}px ${fontFamily}`
    ctx.fillStyle = pal.title
    for (const line of mainLines) {
      ctx.fillText(line, w / 2 - 4, y)
      y += mainLH
    }

    y += sepH / 2
    ctx.strokeStyle = pal.accent
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(w / 2 - 22, y)
    ctx.lineTo(w / 2 + 18, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    y += sepH / 2 + subLH / 2

    ctx.font = `400 ${subSize}px ${fontFamily}`
    ctx.fillStyle = pal.subtitle
    for (const line of subLines) {
      ctx.fillText(line, w / 2 - 4, y)
      y += subLH
    }
  } else {
    const maxLines = 5
    let bestSize = 16
    let bestLines: string[] = []

    for (let fs = 40; fs >= 14; fs -= 1) {
      const lines = wrapText(ctx, title, titleMaxW, maxLines, fs, fontFamily)
      const lh = fs * 1.32
      if (lines.length * lh <= titleAreaH) {
        bestSize = fs
        bestLines = lines
        break
      }
    }
    if (bestLines.length === 0) {
      bestLines = wrapText(ctx, title, titleMaxW, maxLines, 14, fontFamily)
      bestSize = 14
    }

    ctx.font = `600 ${bestSize}px ${fontFamily}`
    ctx.fillStyle = pal.title
    const lh = bestSize * 1.32
    const totalH = bestLines.length * lh
    const startY = titleAreaTop + (titleAreaH - totalH) / 2 + lh / 2
    for (let i = 0; i < bestLines.length; i++) {
      ctx.fillText(bestLines[i], w / 2 - 4, startY + i * lh)
    }
  }

  // ── 作者 ──
  if (author && author.trim()) {
    const authorText = author.trim()
    ctx.font = `400 12px ${fontFamily}`
    ctx.fillStyle = pal.subtitle
    let displayAuthor = authorText
    const authorMaxW = w - 56
    while (ctx.measureText(displayAuthor).width > authorMaxW && displayAuthor.length > 1) {
      displayAuthor = displayAuthor.slice(0, -1)
    }
    if (displayAuthor !== authorText) displayAuthor = displayAuthor.slice(0, -1) + '…'

    ctx.strokeStyle = pal.accent
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2 - 18, h - 40)
    ctx.lineTo(w / 2 + 14, h - 40)
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.fillText(displayAuthor, w / 2 - 4, h - 24)
  }

  // 左上角小角标
  ctx.font = `600 10px ${fontFamily}`
  ctx.fillStyle = pal.accent
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(title.charAt(0).toUpperCase(), 22, 18)

  return canvas.toDataURL('image/png')
}
