import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { LogService } from '../services/log-service'
import type { Bookmark } from '../../src/global'

function getBookmarksFile(): string {
  const dir = join(app.getPath('userData'), '听伴')
  return join(dir, 'bookmarks.json')
}

function loadBookmarks(): Bookmark[] {
  try {
    if (existsSync(getBookmarksFile())) {
      return JSON.parse(readFileSync(getBookmarksFile(), 'utf-8'))
    }
  } catch {
    // corrupted
  }
  return []
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  writeFileSync(getBookmarksFile(), JSON.stringify(bookmarks, null, 2), 'utf-8')
}

export function registerBookmarkHandlers(logService: LogService): void {
  // Save all bookmarks (replace)
  ipcMain.handle('bookmark:save', async (_event, bookmarks: Bookmark[]) => {
    try {
      saveBookmarks(bookmarks)
    } catch (error) {
      logService.error('Bookmark', `保存书签失败: ${String(error)}`)
    }
  })

  // Load all bookmarks
  ipcMain.handle('bookmark:load', async () => {
    return loadBookmarks()
  })

  // Add a single bookmark
  ipcMain.handle('bookmark:add', async (_event, bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => {
    try {
      const bookmarks = loadBookmarks()
      const newBookmark: Bookmark = {
        ...bookmark,
        id: uuidv4(),
        createdAt: new Date().toISOString()
      }
      bookmarks.push(newBookmark)
      saveBookmarks(bookmarks)
      logService.info('Bookmark', `添加书签: 句${bookmark.sentenceIndex}`)
      return { success: true, bookmark: newBookmark }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Update a bookmark (note content)
  ipcMain.handle('bookmark:update', async (_event, id: string, updates: Partial<Bookmark>) => {
    try {
      const bookmarks = loadBookmarks()
      const idx = bookmarks.findIndex((b) => b.id === id)
      if (idx >= 0) {
        bookmarks[idx] = { ...bookmarks[idx], ...updates }
        saveBookmarks(bookmarks)
        return { success: true }
      }
      return { success: false, error: '书签不存在' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Delete a bookmark
  ipcMain.handle('bookmark:delete', async (_event, id: string) => {
    try {
      const bookmarks = loadBookmarks()
      const filtered = bookmarks.filter((b) => b.id !== id)
      saveBookmarks(filtered)
      logService.info('Bookmark', `删除书签: ${id}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
