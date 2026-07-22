import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bookmark as BookmarkIcon,
  Play,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Search
} from 'lucide-react'
import { useBookmarkStore } from '../stores/bookmarkStore'
import { useBookStore } from '../stores/bookStore'
import type { BookData, Bookmark } from '../global'

interface BookmarksViewProps {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  onOpenBookAt: (book: BookData, sentenceIndex: number) => void
}

export default function BookmarksView({ showToast, onOpenBookAt }: BookmarksViewProps) {
  const { bookmarks, loadBookmarks, deleteBookmark, updateBookmark } = useBookmarkStore()
  const { books } = useBookStore()
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<'time' | 'position'>('time')
  const [filterBookId, setFilterBookId] = useState<string>('all')
  const [collapsedBooks, setCollapsedBooks] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    loadBookmarks()
  }, [loadBookmarks])

  // Filtered bookmarks
  const filteredBookmarks = useMemo(() => {
    let filtered = bookmarks
    if (filterBookId !== 'all') {
      filtered = filtered.filter((b) => b.bookId === filterBookId)
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      filtered = filtered.filter(
        (b) =>
          b.content.toLowerCase().includes(kw) ||
          b.note.toLowerCase().includes(kw) ||
          (b.bookTitle || '').toLowerCase().includes(kw)
      )
    }
    // Sort
    const sorted = [...filtered]
    if (sortBy === 'time') {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else {
      sorted.sort((a, b) => a.sentenceIndex - b.sentenceIndex)
    }
    return sorted
  }, [bookmarks, filterBookId, searchKeyword, sortBy])

  // Group by book
  const groupedBookmarks = useMemo(() => {
    const groups = new Map<string, { bookTitle: string; bookmarks: Bookmark[] }>()
    for (const bm of filteredBookmarks) {
      if (!groups.has(bm.bookId)) {
        groups.set(bm.bookId, { bookTitle: bm.bookTitle || '未知书籍', bookmarks: [] })
      }
      groups.get(bm.bookId)!.bookmarks.push(bm)
    }
    return Array.from(groups.entries())
  }, [filteredBookmarks])

  const toggleCollapse = useCallback((bookId: string) => {
    setCollapsedBooks((prev) => {
      const next = new Set(prev)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      return next
    })
  }, [])

  const handleJumpToBookmark = useCallback(
    (bookmark: Bookmark) => {
      const book = books.find((b) => b.id === bookmark.bookId)
      if (!book) {
        showToast('error', '找不到对应书籍')
        return
      }
      onOpenBookAt(book, bookmark.sentenceIndex)
      showToast('info', `跳转到第 ${bookmark.sentenceIndex + 1} 句`)
    },
    [books, onOpenBookAt, showToast]
  )

  const handleDelete = useCallback(
    async (bookmark: Bookmark) => {
      if (confirm('确定要删除这个书签吗？')) {
        await deleteBookmark(bookmark.id)
        showToast('success', '书签已删除')
      }
    },
    [deleteBookmark, showToast]
  )

  const startEdit = useCallback((bookmark: Bookmark) => {
    setEditingId(bookmark.id)
    setEditValue(bookmark.note)
  }, [])

  const submitEdit = useCallback(async () => {
    if (editingId) {
      await updateBookmark(editingId, { note: editValue.trim() })
      showToast('success', '书签已更新')
      setEditingId(null)
      setEditValue('')
    }
  }, [editingId, editValue, updateBookmark, showToast])

  // Format relative time
  const formatRelativeTime = (iso: string): string => {
    const date = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    if (days < 30) return `${Math.floor(days / 7)}周前`
    return `${Math.floor(days / 30)}月前`
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-dark-bg overflow-hidden">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        {/* Book filter */}
        <select
          value={filterBookId}
          onChange={(e) => setFilterBookId(e.target.value)}
          className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-300"
        >
          <option value="all">全部书籍</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索书签备注或内容"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'time' | 'position')}
          className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-300"
        >
          <option value="time">按时间</option>
          <option value="position">按位置</option>
        </select>
      </div>

      {/* Bookmark list */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredBookmarks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <BookmarkIcon className="w-16 h-16 mb-4 opacity-40" />
            <p className="text-lg">还没有书签</p>
            <p className="text-sm mt-2">在播放器中点击句子旁的书签图标添加</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groupedBookmarks.map(([bookId, group]) => {
              const isCollapsed = collapsedBooks.has(bookId)
              return (
                <div
                  key={bookId}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                >
                  {/* Book header */}
                  <button
                    onClick={() => toggleCollapse(bookId)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {group.bookTitle}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                      {group.bookmarks.length}
                    </span>
                  </button>

                  {/* Bookmarks */}
                  {!isCollapsed && (
                    <div className="flex flex-col">
                      {group.bookmarks.map((bm) => (
                        <div
                          key={bm.id}
                          className="flex items-start gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-1">
                              <span>第 {bm.sentenceIndex + 1} 句</span>
                              <span>·</span>
                              <span>{formatRelativeTime(bm.createdAt)}</span>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2">
                              {bm.content}
                            </p>
                            {editingId === bm.id ? (
                              <div className="mt-2 flex items-center gap-1">
                                <input
                                  type="text"
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') submitEdit()
                                    if (e.key === 'Escape') {
                                      setEditingId(null)
                                      setEditValue('')
                                    }
                                  }}
                                  className="flex-1 text-xs px-2 py-1 border rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                                  placeholder="书签备注"
                                />
                                <button
                                  onClick={submitEdit}
                                  className="text-xs text-primary hover:underline"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingId(null)
                                    setEditValue('')
                                  }}
                                  className="text-xs text-gray-400 hover:underline"
                                >
                                  取消
                                </button>
                              </div>
                            ) : bm.note ? (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">
                                📝 {bm.note}
                              </p>
                            ) : null}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleJumpToBookmark(bm)}
                              className="p-1.5 text-primary hover:bg-primary/10 rounded"
                              title="跳转到此处"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => startEdit(bm)}
                              className="p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                              title="编辑备注"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(bm)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
