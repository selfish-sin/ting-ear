import { useCallback, useState } from 'react'
import {
  Home,
  BookOpen,
  Bookmark as BookmarkIcon,
  History as HistoryIcon,
  ScrollText,
  Settings,
  FileText,
  Sparkles,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react'
import { useBookStore } from '../stores/bookStore'
import iconUrl from '../assets/icon.ico'

interface SideNavProps {
  currentView: string
  onViewChange: (view: 'shelf' | 'player' | 'bookmarks' | 'history' | 'logs' | 'quicktext' | 'textclean') => void
  onOpenSettings: () => void
  onClose?: () => void
}

const navItems = [
  { id: 'shelf', label: '书架', icon: Home },
  { id: 'player', label: '播放器', icon: BookOpen },
  { id: 'bookmarks', label: '书签', icon: BookmarkIcon },
  { id: 'history', label: '历史', icon: HistoryIcon },
  { id: 'quicktext', label: '快速文本', icon: FileText },
  { id: 'textclean', label: '清洗格式', icon: Sparkles },
  { id: 'logs', label: '日志', icon: ScrollText }
] as const

export default function SideNav({ currentView, onViewChange, onOpenSettings }: SideNavProps) {
  const currentBookId = useBookStore((s) => s.currentBook?.id)
  const [expanded, setExpanded] = useState(false)

  const handleNavClick = useCallback(
    (view: 'shelf' | 'player' | 'bookmarks' | 'history' | 'logs' | 'quicktext' | 'textclean') => {
      if (view === 'player' && !currentBookId) {
        onViewChange('shelf')
      } else {
        onViewChange(view)
      }
    },
    [currentBookId, onViewChange]
  )

  return (
    <aside
      className={`panel-nav h-full flex flex-col select-none bg-surface/80 dark:bg-dark-surface/80 border-r border-gray-200 dark:border-dark-border shrink-0 transition-[width] duration-200 ease-in-out ${expanded ? 'w-40' : 'w-12'}`}
    >
      {/* Logo */}
      <div className="px-2 pt-3 pb-2 flex items-center gap-2 justify-center" style={expanded ? { justifyContent: 'flex-start', paddingLeft: '0.625rem' } : undefined}>
        <img src={iconUrl} alt="听伴" className="w-8 h-8 rounded-xl shrink-0" />
        {expanded && (
          <span className="font-semibold text-sm text-gray-800 dark:text-gray-100 leading-tight truncate">听伴</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-1.5 pt-1 pb-2 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentView === item.id
          const disabled = item.id === 'player' && !currentBookId
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              disabled={disabled}
              title={item.label}
              className={`nav-item ${expanded ? 'justify-start' : 'justify-center'} ${
                isActive
                  ? 'nav-item-active'
                  : disabled
                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-50'
                    : 'nav-item-idle'
              }`}
            >
              <Icon
                className="w-[18px] h-[18px] shrink-0"
                strokeWidth={isActive ? 2.35 : 1.9}
                absoluteStrokeWidth={false}
              />
              {expanded && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Settings + expand toggle */}
      <div className="p-1.5 border-t border-primary/10 dark:border-primary/15 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onOpenSettings}
          title="设置"
          className={`nav-item w-full ${expanded ? 'justify-start' : 'justify-center'} nav-item-idle`}
        >
          <Settings className="w-[18px] h-[18px] shrink-0" strokeWidth={1.9} />
          {expanded && <span>设置</span>}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? '收起' : '展开'}
          className={`nav-item w-full ${expanded ? 'justify-start' : 'justify-center'} nav-item-idle`}
        >
          {expanded ? (
            <ChevronsLeft className="w-[18px] h-[18px] shrink-0" strokeWidth={1.9} />
          ) : (
            <ChevronsRight className="w-[18px] h-[18px] shrink-0" strokeWidth={1.9} />
          )}
          {expanded && <span>收起</span>}
        </button>
      </div>
    </aside>
  )
}
