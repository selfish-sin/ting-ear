import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'

export interface ContextMenuPoint {
  x: number
  y: number
}

interface ContextMenuSize {
  width: number
  height: number
}

interface ViewportSize {
  width: number
  height: number
}

export interface ContextMenuPosition {
  left: number
  top: number
}

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  onSelect: () => void | Promise<void>
}

export interface ContextMenuGroup {
  id: string
  items: ContextMenuItem[]
}

interface ContextMenuSurfaceProps {
  ariaLabel: string
  groups: ContextMenuGroup[]
  position: ContextMenuPosition
  menuRef: RefObject<HTMLDivElement>
  onRequestClose: () => void
}

interface ContextMenuProps {
  open: boolean
  point: ContextMenuPoint
  groups: ContextMenuGroup[]
  ariaLabel: string
  onClose: () => void
  triggerElement?: HTMLElement | null
}

const VIEWPORT_MARGIN = 8
const DEFAULT_MENU_WIDTH = 208
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function clampContextMenuPosition(
  point: ContextMenuPoint,
  menu: ContextMenuSize,
  viewport: ViewportSize,
  margin = VIEWPORT_MARGIN
): ContextMenuPosition {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin)
  const maxTop = Math.max(margin, viewport.height - menu.height - margin)
  return {
    left: Math.round(Math.min(Math.max(margin, point.x), maxLeft)),
    top: Math.round(Math.min(Math.max(margin, point.y), maxTop))
  }
}

function enabledMenuItems(menu: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
}

export function ContextMenuSurface({
  ariaLabel,
  groups,
  position,
  menuRef,
  onRequestClose
}: ContextMenuSurfaceProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current
    if (!menu) return
    const items = enabledMenuItems(menu)
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    let targetIndex: number | null = null

    if (event.key === 'ArrowDown') targetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    if (event.key === 'ArrowUp') {
      targetIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
    }
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = items.length - 1
    if (event.key === 'Escape') {
      event.preventDefault()
      onRequestClose()
      return
    }
    if (targetIndex !== null) {
      event.preventDefault()
      items[targetIndex]?.focus()
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-dropdown min-w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-card dark:border-dark-border dark:bg-dark-raised"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`
      }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group, groupIndex) => {
        if (group.items.length === 0) return null
        return (
          <div key={group.id} role="group">
            {groupIndex > 0 && (
              <div role="separator" className="mx-2 my-1 border-t border-gray-100 dark:border-gray-700" />
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  onRequestClose()
                  void item.onSelect()
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5',
                  item.disabled && 'cursor-not-allowed opacity-40'
                )}
              >
                {item.icon && <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut && <span className="text-[11px] text-gray-400">{item.shortcut}</span>}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function ContextMenu({
  open,
  point,
  groups,
  ariaLabel,
  onClose,
  triggerElement
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const estimatedHeight = useMemo(
    () => groups.reduce((total, group) => total + group.items.length * 36 + 9, 0) + 8,
    [groups]
  )
  const viewport = () => ({
    width: typeof window === 'undefined' ? DEFAULT_MENU_WIDTH : window.innerWidth,
    height: typeof window === 'undefined' ? estimatedHeight : window.innerHeight
  })
  const [position, setPosition] = useState(() =>
    clampContextMenuPosition(
      point,
      { width: DEFAULT_MENU_WIDTH, height: estimatedHeight },
      viewport()
    )
  )

  useIsomorphicLayoutEffect(() => {
    if (!open) return
    const rect = menuRef.current?.getBoundingClientRect()
    setPosition(
      clampContextMenuPosition(
        point,
        {
          width: rect?.width || DEFAULT_MENU_WIDTH,
          height: rect?.height || estimatedHeight
        },
        viewport()
      )
    )
  }, [estimatedHeight, open, point.x, point.y])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = triggerElement || (document.activeElement as HTMLElement | null)
    const frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current
      if (menu) enabledMenuItems(menu)[0]?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      previousFocusRef.current?.focus()
    }
  }, [open, triggerElement])

  useEffect(() => {
    if (!open) return
    const dismissFromPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const dismissFromScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', dismissFromPointer)
    window.addEventListener('scroll', dismissFromScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', dismissFromPointer)
      window.removeEventListener('scroll', dismissFromScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <ContextMenuSurface
      ariaLabel={ariaLabel}
      groups={groups}
      position={position}
      menuRef={menuRef}
      onRequestClose={onClose}
    />,
    document.body
  )
}
