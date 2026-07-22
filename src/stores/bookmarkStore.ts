import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Bookmark } from '../global'

interface BookmarkState {
  bookmarks: Bookmark[]
  loadBookmarks: () => Promise<void>
  addBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => Promise<Bookmark | null>
  updateBookmark: (id: string, updates: Partial<Bookmark>) => Promise<void>
  deleteBookmark: (id: string) => Promise<void>
  /** 切换书签：该句已有书签则删除，否则新增；返回 'removed' | 'added' | 'failed' */
  toggleBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => Promise<'removed' | 'added' | 'failed'>
  getBookmarksByBook: (bookId: string) => Bookmark[]
  clearAll: () => Promise<void>
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: [],

  loadBookmarks: async () => {
    try {
      const bookmarks = (await window.api?.loadBookmarks()) as Bookmark[]
      set({ bookmarks: bookmarks || [] })
    } catch {
      // ignore
    }
  },

  addBookmark: async (bookmark) => {
    // Check if already bookmarked
    const exists = get().bookmarks.find(
      (b) => b.bookId === bookmark.bookId && b.sentenceIndex === bookmark.sentenceIndex
    )
    if (exists) return null

    const newBookmark: Bookmark = {
      ...bookmark,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    }
    const updated = [...get().bookmarks, newBookmark]
    set({ bookmarks: updated })
    try {
      await window.api?.saveBookmarks(updated)
    } catch {
      // ignore
    }
    return newBookmark
  },

  updateBookmark: async (id, updates) => {
    const updated = get().bookmarks.map((b) => (b.id === id ? { ...b, ...updates } : b))
    set({ bookmarks: updated })
    try {
      await window.api?.saveBookmarks(updated)
    } catch {
      // ignore
    }
  },

  deleteBookmark: async (id) => {
    const updated = get().bookmarks.filter((b) => b.id !== id)
    set({ bookmarks: updated })
    try {
      await window.api?.saveBookmarks(updated)
    } catch {
      // ignore
    }
  },

  getBookmarksByBook: (bookId) => {
    return get().bookmarks.filter((b) => b.bookId === bookId)
  },

  toggleBookmark: async (bookmark) => {
    const exists = get().bookmarks.find(
      (b) => b.bookId === bookmark.bookId && b.sentenceIndex === bookmark.sentenceIndex
    )
    if (exists) {
      await get().deleteBookmark(exists.id)
      return 'removed'
    }
    const added = await get().addBookmark(bookmark)
    return added ? 'added' : 'failed'
  },

  clearAll: async () => {
    set({ bookmarks: [] })
    try {
      await window.api?.saveBookmarks([])
    } catch {
      // ignore
    }
  }
}))
