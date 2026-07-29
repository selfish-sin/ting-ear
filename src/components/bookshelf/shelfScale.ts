/** 书架缩放：1(最小) ~ 5(最大)，默认 3 */
export const SHELF_SCALE_MIN = 1
export const SHELF_SCALE_MAX = 5
export const SHELF_SCALE_DEFAULT = 3
export const SHELF_SCALE_KEY = 'ting-ear-shelf-scale'

/** scale → 网格列数映射（越大列越少 = 封面越大） */
export const SCALE_TO_COLS: Record<number, string> = {
  1: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
  2: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
  3: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
  4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3',
  5: 'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2'
}

export const SCALE_TO_GAP: Record<number, string> = {
  1: 'gap-2',
  2: 'gap-3',
  3: 'gap-4',
  4: 'gap-5',
  5: 'gap-6'
}

export const SCALE_TO_PAD: Record<number, string> = {
  1: 'p-1.5',
  2: 'p-2',
  3: 'p-3',
  4: 'p-4',
  5: 'p-5'
}

export const SCALE_TO_TITLE: Record<number, string> = {
  1: 'text-[11px]',
  2: 'text-xs',
  3: 'text-sm',
  4: 'text-base',
  5: 'text-lg'
}

export const SCALE_TO_META: Record<number, string> = {
  1: 'text-[9px]',
  2: 'text-[10px]',
  3: 'text-xs',
  4: 'text-sm',
  5: 'text-sm'
}

export const FORMAT_BADGE_COLORS: Record<string, string> = {
  epub: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  txt: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  pdf: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  docx: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  md: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  html: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  htm: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
}

export function clampShelfScale(n: number): number {
  if (!Number.isFinite(n)) return SHELF_SCALE_DEFAULT
  return Math.min(SHELF_SCALE_MAX, Math.max(SHELF_SCALE_MIN, Math.round(n)))
}

/** 网格 className：列 + 间距（虚拟滚动与全量渲染共用） */
export function shelfGridClassName(scale: number): string {
  const s = clampShelfScale(scale)
  return `grid ${SCALE_TO_COLS[s]} ${SCALE_TO_GAP[s]}`
}
