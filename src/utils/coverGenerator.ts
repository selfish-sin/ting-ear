/**
 * 自动生成书籍封面（PNG data URL）。
 *
 * 设计理念：
 * - 渐变背景 + 书名居中自适应 + 作者底部 + 顶部装饰
 * - 标题字号在可用区域内尽可能大，长标题自动缩字而非无限换行
 * - 每本书根据标题哈希获得独立配色，书架上一眼可辨
 */

// ── 配色方案 ──────────────────────────────────────────────
interface Palette {
  bgFrom: string
  bgTo: string
  accent: string
  title: string
  subtitle: string
  pattern: string // 装饰图形颜色
}

const PALETTES: Palette[] = [
  // 深蓝
  { bgFrom: '#1a2744', bgTo: '#2d4373', accent: '#5b8def', title: '#ffffff', subtitle: '#a8c0e8', pattern: '#3a5a9a' },
  // 墨绿
  { bgFrom: '#1a3a2e', bgTo: '#2d5a45', accent: '#4ec38a', title: '#ffffff', subtitle: '#a0d8bf', pattern: '#357a5a' },
  // 暗紫
  { bgFrom: '#2d1f4a', bgTo: '#4a3470', accent: '#a78bfa', title: '#ffffff', subtitle: '#c8b8e8', pattern: '#5a4080' },
  // 砖红
  { bgFrom: '#3a1f1f', bgTo: '#5a3030', accent: '#f08a7a', title: '#ffffff', subtitle: '#e8b8b0', pattern: '#704040' },
  // 暖棕
  { bgFrom: '#3a2e1f', bgTo: '#5a4530', accent: '#e8b04a', title: '#ffffff', subtitle: '#e8d0a0', pattern: '#6a5535' },
  // 青灰
  { bgFrom: '#1f2d3a', bgTo: '#34506a', accent: '#5ab8d8', title: '#ffffff', subtitle: '#a0d0e8', pattern: '#3a6580' },
  // 玫紫
  { bgFrom: '#3a1f33', bgTo: '#5a3050', accent: '#e87ab0', title: '#ffffff', subtitle: '#e8b0d0', pattern: '#704060' },
  // 靛蓝
  { bgFrom: '#1f243a', bgTo: '#34406a', accent: '#7a8bf0', title: '#ffffff', subtitle: '#b0c0e8', pattern: '#3a4580' },
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * 计算封面缓存键：基于书名+作者生成稳定哈希字符串。
 * 用于判断已存封面是否需要重新生成（标题/作者变化时哈希不同→需重新生成）。
 */
export function computeCoverHash(title: string, author?: string): string {
  const raw = `${title.trim()}|${(author || '').trim()}`
  // 用更长的位宽减少碰撞
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < raw.length; i++) {
    h1 = Math.imul(h1 ^ raw.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ raw.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/** localStorage 封面哈希存储键前缀 */
export const COVER_HASH_KEY_PREFIX = 'ting-ear-cover-hash-'

/** 从 localStorage 读取某书的已存封面哈希 */
export function getStoredCoverHash(bookId: string): string | null {
  try {
    return localStorage.getItem(COVER_HASH_KEY_PREFIX + bookId)
  } catch {
    return null
  }
}

/** 向 localStorage 写入某书的封面哈希 */
export function setStoredCoverHash(bookId: string, hash: string): void {
  try {
    localStorage.setItem(COVER_HASH_KEY_PREFIX + bookId, hash)
  } catch {
    // ignore quota errors
  }
}

function getPalette(title: string): Palette {
  return PALETTES[hashStr(title) % PALETTES.length]
}

// ── 大小字拆分 ────────────────────────────────────────────
interface TitleSplit {
  main: string
  sub: string
}

/** 按分隔符拆分主副标题（：: ——），无有效拆分返回 null */
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

// ── 文本换行 ──────────────────────────────────────────────
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
        // 最后一行加省略号
        let last = cur
        while (lines.length === maxLines - 1 && ctx.measureText(last + '…').width > maxW && last.length > 0) {
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

// ── 主函数 ────────────────────────────────────────────────
export function generateCoverDataUrl(
  title: string,
  author?: string,
  width = 300,
  height = 400
): string {
  const canvas = document.createElement('canvas')
  // 2x 高清渲染
  const scale = 2
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  const w = width
  const h = height
  const pal = getPalette(title)

  // ── 背景渐变 ──
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, pal.bgFrom)
  grad.addColorStop(1, pal.bgTo)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // ── 顶部装饰：几何条纹 ──
  const stripeH = 5
  ctx.fillStyle = pal.accent
  ctx.fillRect(0, 0, w, stripeH)

  // 顶部右上角装饰小方块
  ctx.fillStyle = pal.pattern
  ctx.globalAlpha = 0.4
  ctx.fillRect(w - 40, 16, 24, 3)
  ctx.fillRect(w - 70, 16, 16, 3)
  ctx.globalAlpha = 1

  // ── 底部装饰 ──
  ctx.fillStyle = pal.accent
  ctx.globalAlpha = 0.6
  ctx.fillRect(0, h - stripeH, w, stripeH)
  ctx.globalAlpha = 1

  // ── 侧边竖装饰线 ──
  ctx.strokeStyle = pal.pattern
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(20, 50)
  ctx.lineTo(20, h - 50)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(w - 20, 50)
  ctx.lineTo(w - 20, h - 50)
  ctx.stroke()
  ctx.globalAlpha = 1

  // ── 标题区域 ──
  const padX = 32
  const titleMaxW = w - padX * 2
  const authorH = author && author.trim() ? 36 : 0
  const titleAreaTop = 50
  const titleAreaBottom = h - 40 - authorH
  const titleAreaH = titleAreaBottom - titleAreaTop

  const fontFamily = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 文字阴影增加可读性
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1

  const split = splitTitle(title)

  if (split) {
    // ── 大小字模式：主标题大字 + 副标题小字 ──
    const sepH = 14 // 分隔装饰占高
    const subRatio = 0.45

    // 二分查找主标题字号（最多 3 行），同时副标题按比例
    let mainSize = 16
    let mainLines: string[] = []
    let subSize = 12
    let subLines: string[] = []

    for (let fs = 48; fs >= 16; fs -= 1) {
      const sfs = Math.max(12, Math.round(fs * subRatio))
      const mL = wrapText(ctx, split.main, titleMaxW, 3, fs, fontFamily)
      const sL = wrapText(ctx, split.sub, titleMaxW, 3, sfs, fontFamily)
      const totalH = mL.length * fs * 1.3 + sepH + sL.length * sfs * 1.4
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

    const mainLH = mainSize * 1.3
    const subLH = subSize * 1.4
    const totalH = mainLines.length * mainLH + sepH + subLines.length * subLH
    let y = titleAreaTop + (titleAreaH - totalH) / 2 + mainLH / 2

    // 主标题（大字）
    ctx.font = `bold ${mainSize}px ${fontFamily}`
    ctx.fillStyle = pal.title
    for (const line of mainLines) {
      ctx.fillText(line, w / 2, y)
      y += mainLH
    }

    // 分隔装饰线
    y += sepH / 2
    ctx.strokeStyle = pal.accent
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2 - 24, y)
    ctx.lineTo(w / 2 + 24, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    y += sepH / 2 + subLH / 2

    // 副标题（小字）
    ctx.font = `${subSize}px ${fontFamily}`
    ctx.fillStyle = pal.subtitle
    for (const line of subLines) {
      ctx.fillText(line, w / 2, y)
      y += subLH
    }
  } else {
    // ── 等字模式：统一字号 ──
    // 从大到小找能完整显示的最大字号（最多 5 行）
    const maxLines = 5
    let bestSize = 16
    let bestLines: string[] = []

    for (let fs = 44; fs >= 14; fs -= 1) {
      const lines = wrapText(ctx, title, titleMaxW, maxLines, fs, fontFamily)
      const lh = fs * 1.35
      const totalH = lines.length * lh
      if (totalH <= titleAreaH) {
        bestSize = fs
        bestLines = lines
        break
      }
    }

    if (bestLines.length === 0) {
      bestLines = wrapText(ctx, title, titleMaxW, maxLines, 14, fontFamily)
      bestSize = 14
    }

    ctx.font = `bold ${bestSize}px ${fontFamily}`
    ctx.fillStyle = pal.title

    const lh = bestSize * 1.35
    const totalH = bestLines.length * lh
    const startY = titleAreaTop + (titleAreaH - totalH) / 2 + lh / 2

    for (let i = 0; i < bestLines.length; i++) {
      ctx.fillText(bestLines[i], w / 2, startY + i * lh)
    }
  }

  // 重置阴影
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  // ── 作者 ──
  if (author && author.trim()) {
    const authorText = author.trim()
    const authorFontSize = 13
    ctx.font = `${authorFontSize}px ${fontFamily}`
    ctx.fillStyle = pal.subtitle

    // 截断过长的作者名
    let displayAuthor = authorText
    const authorMaxW = w - 60
    while (ctx.measureText(displayAuthor).width > authorMaxW && displayAuthor.length > 1) {
      displayAuthor = displayAuthor.slice(0, -1)
    }
    if (displayAuthor !== authorText) {
      displayAuthor = displayAuthor.slice(0, -1) + '…'
    }

    // 作者上方小装饰线
    ctx.strokeStyle = pal.accent
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2 - 20, h - 42)
    ctx.lineTo(w / 2 + 20, h - 42)
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.fillText(displayAuthor, w / 2, h - 24)
  }

  // ── 顶部小标签：首字母 ──
  const firstChar = title.charAt(0)
  ctx.font = `bold 11px ${fontFamily}`
  ctx.fillStyle = pal.accent
  ctx.globalAlpha = 0.8
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(firstChar.toUpperCase(), 28, 18)
  ctx.globalAlpha = 1

  return canvas.toDataURL('image/png')
}
