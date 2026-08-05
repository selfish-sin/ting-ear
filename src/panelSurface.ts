/**
 * 背景开启时组件叠层：只用「不透明度 + 可选毛玻璃」。
 * 颜色固定跟日夜（auto），不再提供白/黑/六套风格。
 */

export type PanelEffectId = 'plain' | 'frost'

export const DEFAULT_PANEL_OPACITY = 0.72
export const DEFAULT_PANEL_EFFECT: PanelEffectId = 'plain'

/** 把设置里的颜色解析成 CSS `r, g, b`（仅 auto：浅白 / 深灰） */
export function resolvePanelRgb(isDark: boolean): string {
  return isDark ? '38, 42, 53' : '255, 255, 255'
}

export function clampPanelOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : DEFAULT_PANEL_OPACITY
  if (Number.isNaN(n)) return DEFAULT_PANEL_OPACITY
  return Math.min(1, Math.max(0.15, n))
}

/** 阅读正文遮罩浓度，默认 0.9，范围 0.5–1 */
export const DEFAULT_CONTENT_OPACITY = 0.9

export function clampContentOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : DEFAULT_CONTENT_OPACITY
  if (Number.isNaN(n)) return DEFAULT_CONTENT_OPACITY
  return Math.min(1, Math.max(0.5, n))
}

/**
 * 解析当前效果：优先 glass 开关；兼容旧 panelEffect=frost。
 */
export function resolvePanelEffect(bg: {
  glass?: boolean
  panelEffect?: string
} | null | undefined): PanelEffectId {
  if (bg?.glass === true) return 'frost'
  if (bg?.glass === false) return 'plain'
  if (bg?.panelEffect === 'frost') return 'frost'
  return 'plain'
}

export function resolvePanelBlur(opacity: number, effect: PanelEffectId): string {
  if (effect === 'frost') return '20px'
  if (opacity >= 0.95) return '0px'
  return '12px'
}
