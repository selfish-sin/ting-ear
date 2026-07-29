import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent
} from 'react'
import type { BookData } from '../../global'

/** 超过此数量才启用虚拟滚动（少量书直接全量渲染更简单） */
export const VIRTUALIZE_THRESHOLD = 36

const LIST_ROW_H = 72
const LIST_GAP = 8
const OVERSCAN_ROWS = 3

/** 与 Tailwind 断点大致对齐，用于推算网格列数 */
function gridColumnCount(scale: number, width: number): number {
  // scale → [base, sm, md, lg, xl] 最大列数（与 SCALE_TO_COLS 一致）
  const table: Record<number, [number, number, number, number, number]> = {
    1: [4, 5, 6, 7, 8],
    2: [3, 4, 5, 6, 6],
    3: [2, 3, 4, 5, 5],
    4: [1, 2, 3, 3, 3],
    5: [1, 1, 2, 2, 2]
  }
  const cols = table[scale] || table[3]
  if (width >= 1280) return cols[4]
  if (width >= 1024) return cols[3]
  if (width >= 768) return cols[2]
  if (width >= 640) return cols[1]
  return cols[0]
}

function gridGapPx(scale: number): number {
  return [8, 12, 16, 20, 24][Math.max(0, Math.min(4, scale - 1))] ?? 16
}

function estimateGridRowHeight(scale: number, containerWidth: number, cols: number): number {
  const gap = gridGapPx(scale)
  const cellW = Math.max(80, (containerWidth - gap * (cols - 1)) / cols)
  const coverH = cellW * (4 / 3)
  const textH = scale <= 2 ? 40 : scale <= 3 ? 48 : 56
  const pad = [6, 8, 12, 16, 20][Math.max(0, Math.min(4, scale - 1))] ?? 12
  return Math.ceil(coverH + textH + pad * 2 + gap)
}

interface CommonProps {
  books: BookData[]
  renderItem: (book: BookData, index: number) => ReactNode
  className?: string
}

/** 列表模式虚拟滚动 */
export function VirtualBookList({ books, renderItem, className = '' }: CommonProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 480)
    })
    ro.observe(el)
    setViewportH(el.clientHeight || 480)
    return () => ro.disconnect()
  }, [])

  const stride = LIST_ROW_H + LIST_GAP
  const totalH = books.length * stride
  const start = Math.max(0, Math.floor(scrollTop / stride) - OVERSCAN_ROWS)
  const visible = Math.ceil(viewportH / stride) + OVERSCAN_ROWS * 2
  const end = Math.min(books.length, start + visible)
  const topPad = start * stride
  const bottomPad = Math.max(0, totalH - end * stride)

  return (
    <div
      ref={scrollerRef}
      className={`overflow-y-auto ${className}`}
      style={{ height: '100%' }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: topPad }} />
      <div className="flex flex-col gap-2">
        {books.slice(start, end).map((book, i) => renderItem(book, start + i))}
      </div>
      <div style={{ height: bottomPad }} />
    </div>
  )
}

interface GridProps extends CommonProps {
  shelfScale: number
  gridClassName: string
}

/** 网格模式按「行」虚拟滚动 */
export function VirtualBookGrid({
  books,
  renderItem,
  shelfScale,
  gridClassName,
  className = ''
}: GridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 480)
      setWidth(el.clientWidth || 800)
    })
    ro.observe(el)
    setViewportH(el.clientHeight || 480)
    setWidth(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  const cols = useMemo(() => gridColumnCount(shelfScale, width), [shelfScale, width])
  const rowH = useMemo(
    () => estimateGridRowHeight(shelfScale, width, cols),
    [shelfScale, width, cols]
  )
  const rowCount = Math.ceil(books.length / cols)
  const startRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN_ROWS)
  const visibleRows = Math.ceil(viewportH / rowH) + OVERSCAN_ROWS * 2
  const endRow = Math.min(rowCount, startRow + visibleRows)
  const startIdx = startRow * cols
  const endIdx = Math.min(books.length, endRow * cols)
  const topPad = startRow * rowH
  const bottomPad = Math.max(0, (rowCount - endRow) * rowH)

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop)
  }, [])

  return (
    <div
      ref={scrollerRef}
      className={`overflow-y-auto ${className}`}
      style={{ height: '100%' }}
      onScroll={onScroll}
    >
      <div style={{ height: topPad }} />
      <div className={gridClassName}>
        {books.slice(startIdx, endIdx).map((book, i) => renderItem(book, startIdx + i))}
      </div>
      <div style={{ height: bottomPad }} />
    </div>
  )
}
