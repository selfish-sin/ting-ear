import { useCallback } from 'react'
import {
  Home,
  BookOpen,
  Bookmark as BookmarkIcon,
  History as HistoryIcon,
  ScrollText,
  Settings,
  FileText,
  Sparkles
} from 'lucide-react'
import { useBookStore } from '../stores/bookStore'

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
  const { currentBook } = useBookStore()

  const handleNavClick = useCallback(
    (view: 'shelf' | 'player' | 'bookmarks' | 'history' | 'logs' | 'quicktext' | 'textclean') => {
      // Player view requires a book to be loaded
      if (view === 'player' && !currentBook) {
        onViewChange('shelf')
      } else {
        onViewChange(view)
      }
    },
    [currentBook, onViewChange]
  )

  return (
    <div className="w-48 h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col select-none">
      {/* App logo */}
      <div className="p-4 flex items-center gap-2 border-b border-gray-100 dark:border-gray-800">
        <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
          <span className="text-white text-sm font-bold">听</span>
        </div>
        <span className="font-semibold text-gray-700 dark:text-gray-200">听伴</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-2 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentView === item.id
          const disabled = item.id === 'player' && !currentBook
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              disabled={disabled}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : disabled
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Settings button */}
      <div className="p-2 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Settings className="w-4 h-4" />
          <span>设置</span>
        </button>
      </div>
    </div>
  )
}
