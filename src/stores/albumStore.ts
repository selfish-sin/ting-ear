import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { AlbumItem, CustomAlbum } from '../global'
import {
  ALBUM_TITLE_MAX_LENGTH,
  FAVORITES_ALBUM_ID,
  FAVORITES_ALBUM_TITLE,
  clearLegacyFavoritesStorage,
  ensureSystemAlbums,
  isFavoritesAlbum,
  mergeLegacyFavorites,
  normalizeAlbumTitle,
  readLegacyFavoriteIds,
  sortAlbumsForDisplay,
  validateAlbums
} from '../utils/albumUtils'

interface AlbumState {
  albums: CustomAlbum[]
  activeAlbumId: string | null
  /** 是否已完成至少一次 load；未 hydrate 前禁止写盘，避免空数组盖真数据 */
  hydrated: boolean
  setActiveAlbumId: (id: string | null) => void
  loadAlbums: () => Promise<void>
  createAlbum: (title: string, parentId?: string | null) => Promise<CustomAlbum | null>
  renameAlbum: (id: string, title: string) => Promise<boolean>
  deleteAlbum: (id: string) => Promise<boolean>
  addItem: (albumId: string, item: AlbumItem) => Promise<boolean>
  removeItem: (albumId: string, item: AlbumItem) => Promise<boolean>
  moveItem: (albumId: string, item: AlbumItem, direction: -1 | 1) => Promise<boolean>
  /** 收藏星标：加入/移出常驻「收藏」专辑（与 UI 星标唯一数据源） */
  toggleFavorite: (bookId: string) => Promise<boolean>
  isFavorite: (bookId: string) => boolean
  persistAlbums: () => Promise<boolean>
}

const itemKey = (item: AlbumItem) => `${item.resourceType}:${item.resourceId}`

/**
 * 专辑写操作串行队列：避免并发 addItem/removeItem 互相覆盖写盘结果。
 * load 也走同一队列，避免「正在改 → load 回来把改动冲掉」。
 */
let _opChain: Promise<unknown> = Promise.resolve()
function runAlbumOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = _opChain.then(fn, fn)
  _opChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function writeAlbums(albums: CustomAlbum[]): Promise<boolean> {
  try {
    const result = await window.api?.saveAlbums(albums)
    return result?.success === true
  } catch {
    return false
  }
}

export const useAlbumStore = create<AlbumState>((set, get) => ({
  albums: [],
  activeAlbumId: null,
  hydrated: false,

  setActiveAlbumId: (activeAlbumId) => set({ activeAlbumId }),

  loadAlbums: () =>
    runAlbumOp(async () => {
      try {
        const raw = await window.api?.loadAlbums()
        let albums = validateAlbums(raw ?? [])
        let { albums: ensured, changed } = ensureSystemAlbums(albums)

        const legacy = readLegacyFavoriteIds()
        if (legacy.length > 0) {
          const merged = mergeLegacyFavorites(ensured, legacy)
          ensured = merged.albums
          if (merged.changed) changed = true
          clearLegacyFavoritesStorage()
        }

        set({ albums: ensured, hydrated: true })

        // 注入系统专辑或迁移旧星标后落盘；失败不回滚内存（至少 UI 可用）
        if (changed) {
          await writeAlbums(ensured)
        }
      } catch {
        // 坏数据：仍提供空壳收藏，避免整栏消失
        const { albums: fallback } = ensureSystemAlbums([])
        set({ albums: fallback, hydrated: true })
        await writeAlbums(fallback)
      }
    }),

  createAlbum: (rawTitle, parentId = null) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return null
      const title = normalizeAlbumTitle(rawTitle)
      if (!title || title.length > ALBUM_TITLE_MAX_LENGTH) return null
      // 禁止与常驻「收藏」重名，避免双入口拮抗
      if (title === FAVORITES_ALBUM_TITLE) return null
      // 扁平专辑：忽略嵌套 parentId，全部挂在顶层
      void parentId

      const now = new Date().toISOString()
      const album: CustomAlbum = {
        id: uuidv4(),
        title,
        parentId: null,
        items: [],
        createdAt: now,
        updatedAt: now
      }

      const prevAlbums = get().albums
      const prevActive = get().activeAlbumId
      const nextAlbums = sortAlbumsForDisplay([...prevAlbums, album])
      set({ albums: nextAlbums, activeAlbumId: album.id })

      if (!(await writeAlbums(nextAlbums))) {
        // 写盘失败：回滚，避免「界面有、磁盘无」后被 load 冲掉造成「消失」
        set({ albums: prevAlbums, activeAlbumId: prevActive })
        return null
      }
      return album
    }),

  renameAlbum: (id, rawTitle) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      if (isFavoritesAlbum(id)) return false // 收藏不可改名
      const title = normalizeAlbumTitle(rawTitle)
      if (!title || title.length > ALBUM_TITLE_MAX_LENGTH) return false
      if (title === FAVORITES_ALBUM_TITLE) return false

      const prevAlbums = get().albums
      if (!prevAlbums.some((a) => a.id === id)) return false

      const nextAlbums = prevAlbums.map((album) =>
        album.id === id ? { ...album, title, updatedAt: new Date().toISOString() } : album
      )
      set({ albums: nextAlbums })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums })
        return false
      }
      return true
    }),

  deleteAlbum: (id) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      if (isFavoritesAlbum(id)) return false // 常驻，禁止删除
      if (!get().albums.some((album) => album.id === id)) return false

      const prevAlbums = get().albums
      const prevActive = get().activeAlbumId

      const removed = new Set([id])
      // 仍清理历史上挂在其下的子专辑（数据层兼容），UI 已扁平
      let changed = true
      while (changed) {
        changed = false
        for (const album of prevAlbums) {
          if (album.parentId && removed.has(album.parentId) && !removed.has(album.id)) {
            if (isFavoritesAlbum(album.id)) continue
            removed.add(album.id)
            changed = true
          }
        }
      }

      const nextAlbums = sortAlbumsForDisplay(prevAlbums.filter((album) => !removed.has(album.id)))
      const nextActive =
        prevActive && removed.has(prevActive) ? null : prevActive

      set({ albums: nextAlbums, activeAlbumId: nextActive })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums, activeAlbumId: prevActive })
        return false
      }
      return true
    }),

  addItem: (albumId, item) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      const prevAlbums = get().albums
      let didChange = false
      const nextAlbums = prevAlbums.map((album) => {
        if (album.id !== albumId || album.items.some((entry) => itemKey(entry) === itemKey(item))) {
          return album
        }
        didChange = true
        return {
          ...album,
          items: [...album.items, item],
          updatedAt: new Date().toISOString()
        }
      })
      if (!didChange) return false
      set({ albums: nextAlbums })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums })
        return false
      }
      return true
    }),

  removeItem: (albumId, item) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      const prevAlbums = get().albums
      let didChange = false
      const nextAlbums = prevAlbums.map((album) => {
        if (album.id !== albumId) return album
        const items = album.items.filter((entry) => itemKey(entry) !== itemKey(item))
        if (items.length === album.items.length) return album
        didChange = true
        return { ...album, items, updatedAt: new Date().toISOString() }
      })
      if (!didChange) return false
      set({ albums: nextAlbums })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums })
        return false
      }
      return true
    }),

  moveItem: (albumId, item, direction) =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      const prevAlbums = get().albums
      const album = prevAlbums.find((entry) => entry.id === albumId)
      if (!album) return false
      const index = album.items.findIndex((entry) => itemKey(entry) === itemKey(item))
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= album.items.length) return false
      const items = [...album.items]
      ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
      const nextAlbums = prevAlbums.map((entry) =>
        entry.id === albumId
          ? { ...entry, items, updatedAt: new Date().toISOString() }
          : entry
      )
      set({ albums: nextAlbums })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums })
        return false
      }
      return true
    }),

  toggleFavorite: (bookId) =>
    runAlbumOp(async () => {
      if (!get().hydrated || !bookId) return false
      // 确保收藏专辑存在（防御未 load 全的状态）
      let prevAlbums = get().albums
      if (!prevAlbums.some((a) => a.id === FAVORITES_ALBUM_ID)) {
        const { albums: ensured } = ensureSystemAlbums(prevAlbums)
        prevAlbums = ensured
        set({ albums: ensured })
      }

      const fav = prevAlbums.find((a) => a.id === FAVORITES_ALBUM_ID)
      if (!fav) return false
      const item: AlbumItem = { resourceType: 'book', resourceId: bookId }
      const has = fav.items.some((e) => itemKey(e) === itemKey(item))
      const now = new Date().toISOString()
      const nextAlbums = prevAlbums.map((album) => {
        if (album.id !== FAVORITES_ALBUM_ID) return album
        if (has) {
          return {
            ...album,
            items: album.items.filter((e) => itemKey(e) !== itemKey(item)),
            updatedAt: now
          }
        }
        return { ...album, items: [...album.items, item], updatedAt: now }
      })
      set({ albums: nextAlbums })
      if (!(await writeAlbums(nextAlbums))) {
        set({ albums: prevAlbums })
        return false
      }
      return true
    }),

  isFavorite: (bookId) => {
    const fav = get().albums.find((a) => a.id === FAVORITES_ALBUM_ID)
    if (!fav) return false
    return fav.items.some((e) => e.resourceType === 'book' && e.resourceId === bookId)
  },

  persistAlbums: () =>
    runAlbumOp(async () => {
      if (!get().hydrated) return false
      return writeAlbums(get().albums)
    })
}))

// 导出常量便于测试/UI 引用
export { FAVORITES_ALBUM_ID, FAVORITES_ALBUM_TITLE }
