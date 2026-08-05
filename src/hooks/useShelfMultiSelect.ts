import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookData } from '../global'

/** 长按多久进入多选（ms）——接近安卓相册手感 */
const LONG_PRESS_MS = 400
/** 按下后位移超过该距离（px）才取消长按（不用 movementX，避免 Windows 鼠标微抖误杀） */
const CANCEL_MOVE_PX = 12

type DragMode = 'add' | 'remove'

interface PendingPointer {
  bookId: string
  x: number
  y: number
  pointerId: number
  target: HTMLElement | null
}

/**
 * 安卓相册式多选：
 * 1. 长按卡片 → 进入多选并选中，继续按住拖动可刷选
 * 2. 多选模式下按下即刷选（按下时未选=加选，已选=减选）
 * 3. 左上角勾选框可直接进入多选
 * 4. suppress 吞掉长按/刷选后的 click，避免误开书/误换封面
 */
export function useShelfMultiSelect(displayBooks: BookData[]) {
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const multiSelectModeRef = useRef(false)
  const selectedIdsRef = useRef(selectedIds)
  multiSelectModeRef.current = multiSelectMode
  selectedIdsRef.current = selectedIds

  const dragRef = useRef<{ active: boolean; mode: DragMode } | null>(null)
  const pendingRef = useRef<PendingPointer | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClickRef = useRef(false)
  const suppressClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const armSuppress = useCallback(() => {
    suppressClickRef.current = true
    if (suppressClearTimerRef.current) clearTimeout(suppressClearTimerRef.current)
    suppressClearTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false
      suppressClearTimerRef.current = null
    }, 450)
  }, [])

  /** 若处于 suppress 窗口则消费并返回 true */
  const consumeSuppressClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    if (suppressClearTimerRef.current) {
      clearTimeout(suppressClearTimerRef.current)
      suppressClearTimerRef.current = null
    }
    return true
  }, [])

  const applyDragSelect = useCallback((id: string) => {
    const drag = dragRef.current
    if (!drag?.active || !id) return
    setSelectedIds((prev) => {
      if (drag.mode === 'add') {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      }
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const hitBookId = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return null
    const card = el.closest('[data-book-id]') as HTMLElement | null
    return card?.dataset?.bookId || null
  }, [])

  const tryCapture = useCallback((target: HTMLElement | null, pointerId: number) => {
    if (!target) return
    try {
      if (!target.hasPointerCapture?.(pointerId)) {
        target.setPointerCapture(pointerId)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const tryRelease = useCallback((target: HTMLElement | null, pointerId: number) => {
    if (!target) return
    try {
      if (target.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const endDrag = useCallback(() => {
    clearLongPressTimer()
    const pending = pendingRef.current
    if (pending) {
      tryRelease(pending.target, pending.pointerId)
    }
    pendingRef.current = null
    if (dragRef.current) {
      dragRef.current = { ...dragRef.current, active: false }
    }
  }, [clearLongPressTimer, tryRelease])

  const startPaint = useCallback(
    (id: string, mode: DragMode, capture?: { target: HTMLElement | null; pointerId: number }) => {
      const entering = !multiSelectModeRef.current
      // 同步 ref，避免同一次拖动里状态滞后
      multiSelectModeRef.current = true
      dragRef.current = { active: true, mode }
      armSuppress()
      setMultiSelectMode(true)

      if (entering && mode === 'add') {
        // 长按进入：从这一本起手（相册语义）
        const next = new Set([id])
        selectedIdsRef.current = next
        setSelectedIds(next)
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (mode === 'add') next.add(id)
          else next.delete(id)
          selectedIdsRef.current = next
          return next
        })
      }
      if (capture) tryCapture(capture.target, capture.pointerId)
    },
    [armSuppress, tryCapture]
  )

  const handleSelectPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (e.button !== 0) return
      // 勾选框/菜单/星标不走长按刷选
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-drag-select]')) return

      const target = e.currentTarget as HTMLElement
      pendingRef.current = {
        bookId: id,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        target
      }

      // 已在多选：立刻刷选并 capture（此时 capturen 不影响「进入前滚动」）
      if (multiSelectModeRef.current) {
        e.preventDefault()
        const willAdd = !selectedIdsRef.current.has(id)
        startPaint(id, willAdd ? 'add' : 'remove', { target, pointerId: e.pointerId })
        return
      }

      // 未多选：仅启动长按计时，不 capture，保证列表仍可滚动
      clearLongPressTimer()
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        const pending = pendingRef.current
        if (!pending || pending.bookId !== id) return
        startPaint(id, 'add', { target: pending.target, pointerId: pending.pointerId })
      }, LONG_PRESS_MS)
    },
    [clearLongPressTimer, startPaint]
  )

  const handleSelectPointerEnter = useCallback(
    (id: string) => {
      // capture 期间 enter 可能不触发，主要靠 window pointermove hit-test
      if (dragRef.current?.active) applyDragSelect(id)
    },
    [applyDragSelect]
  )

  const handleSelectPointerUp = useCallback(
    (_id: string, e: React.PointerEvent) => {
      tryRelease(e.currentTarget as HTMLElement, e.pointerId)
      endDrag()
    },
    [endDrag, tryRelease]
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current

      // 长按等待中：位移过大 → 取消（视为滚动/滑过）
      if (pending && longPressTimerRef.current && !dragRef.current?.active) {
        const dx = e.clientX - pending.x
        const dy = e.clientY - pending.y
        if (dx * dx + dy * dy > CANCEL_MOVE_PX * CANCEL_MOVE_PX) {
          clearLongPressTimer()
          // 不立刻清空 pending，等 up；但不再进入多选
          pendingRef.current = { ...pending, bookId: '' }
        }
      }

      if (!dragRef.current?.active) return
      e.preventDefault?.()
      const id = hitBookId(e.clientX, e.clientY)
      if (id) applyDragSelect(id)
    }

    const onUp = () => endDrag()

    // pointermove 非 passive，刷选时才能 preventDefault 减少选字
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      clearLongPressTimer()
      if (suppressClearTimerRef.current) clearTimeout(suppressClearTimerRef.current)
    }
  }, [applyDragSelect, clearLongPressTimer, endDrag, hitBookId])

  useEffect(() => {
    if (!multiSelectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMultiSelectMode(false)
        setSelectedIds(new Set())
        dragRef.current = null
        pendingRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [multiSelectMode])

  const toggleSelect = useCallback(
    (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (consumeSuppressClick()) return
      setMultiSelectMode(true)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [consumeSuppressClick]
  )

  const selectAll = useCallback(() => {
    setMultiSelectMode(true)
    setSelectedIds(new Set(displayBooks.map((b) => b.id)))
  }, [displayBooks])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelection = useCallback(() => {
    setMultiSelectMode(false)
    setSelectedIds(new Set())
    dragRef.current = null
    pendingRef.current = null
    clearLongPressTimer()
  }, [clearLongPressTimer])

  const openBookSafe = useCallback(
    (book: BookData, onOpen: (b: BookData) => void) => {
      if (consumeSuppressClick()) return
      if (multiSelectModeRef.current) {
        // 多选中点标题 = 切换勾选，不打开
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(book.id)) next.delete(book.id)
          else next.add(book.id)
          return next
        })
        return
      }
      onOpen(book)
    },
    [consumeSuppressClick]
  )

  const coverClickSafe = useCallback(
    (book: BookData, onUpload: (b: BookData) => void) => {
      if (consumeSuppressClick()) return
      if (multiSelectModeRef.current) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(book.id)) next.delete(book.id)
          else next.add(book.id)
          return next
        })
        return
      }
      onUpload(book)
    },
    [consumeSuppressClick]
  )

  const selectedCount = selectedIds.size
  const allSelected =
    displayBooks.length > 0 && displayBooks.every((b) => selectedIds.has(b.id))

  return {
    multiSelectMode,
    selectedIds,
    selectedCount,
    allSelected,
    toggleSelect,
    selectAll,
    clearSelection,
    exitSelection,
    consumeSuppressClick,
    handleSelectPointerDown,
    handleSelectPointerEnter,
    handleSelectPointerUp,
    openBookSafe,
    coverClickSafe
  }
}
