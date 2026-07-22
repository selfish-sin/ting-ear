import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { AlbumItem, CustomAlbum } from '../global'
import { ALBUM_TITLE_MAX_LENGTH, normalizeAlbumTitle, validateAlbums } from '../utils/albumUtils'

interface AlbumState {
  albums: CustomAlbum[]
  activeAlbumId: string | null
  setActiveAlbumId: (id: string | null) => void
  loadAlbums: () => Promise<void>
  createAlbum: (title: string, parentId: string | null) => Promise<CustomAlbum | null>
  renameAlbum: (id: string, title: string) => Promise<boolean>
  deleteAlbum: (id: string) => Promise<boolean>
  addItem: (albumId: string, item: AlbumItem) => Promise<boolean>
  removeItem: (albumId: string, item: AlbumItem) => Promise<boolean>
  moveItem: (albumId: string, item: AlbumItem, direction: -1 | 1) => Promise<boolean>
  persistAlbums: () => Promise<boolean>
}

const itemKey = (item: AlbumItem) => `${item.resourceType}:${item.resourceId}`

export const useAlbumStore = create<AlbumState>((set, get) => ({
  albums: [],
  activeAlbumId: null,

  setActiveAlbumId: (activeAlbumId) => set({ activeAlbumId }),

  loadAlbums: async () => {
    try {
      const albums = validateAlbums(await window.api?.loadAlbums())
      set({ albums })
    } catch {
      set({ albums: [] })
    }
  },

  createAlbum: async (rawTitle, parentId) => {
    const title = normalizeAlbumTitle(rawTitle)
    if (!title || title.length > ALBUM_TITLE_MAX_LENGTH) return null
    if (parentId && !get().albums.some((album) => album.id === parentId)) return null

    const now = new Date().toISOString()
    const album: CustomAlbum = {
      id: uuidv4(),
      title,
      parentId,
      items: [],
      createdAt: now,
      updatedAt: now
    }
    set((state) => ({ albums: [...state.albums, album], activeAlbumId: album.id }))
    return (await get().persistAlbums()) ? album : null
  },

  renameAlbum: async (id, rawTitle) => {
    const title = normalizeAlbumTitle(rawTitle)
    if (!title || title.length > ALBUM_TITLE_MAX_LENGTH) return false
    const albums = get().albums.map((album) =>
      album.id === id ? { ...album, title, updatedAt: new Date().toISOString() } : album
    )
    if (!albums.some((album) => album.id === id)) return false
    set({ albums })
    return get().persistAlbums()
  },

  deleteAlbum: async (id) => {
    if (!get().albums.some((album) => album.id === id)) return false
    const removed = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const album of get().albums) {
        if (album.parentId && removed.has(album.parentId) && !removed.has(album.id)) {
          removed.add(album.id)
          changed = true
        }
      }
    }
    set((state) => ({
      albums: state.albums.filter((album) => !removed.has(album.id)),
      activeAlbumId:
        state.activeAlbumId && removed.has(state.activeAlbumId) ? null : state.activeAlbumId
    }))
    return get().persistAlbums()
  },

  addItem: async (albumId, item) => {
    let changed = false
    const albums = get().albums.map((album) => {
      if (album.id !== albumId || album.items.some((entry) => itemKey(entry) === itemKey(item)))
        return album
      changed = true
      return { ...album, items: [...album.items, item], updatedAt: new Date().toISOString() }
    })
    if (!changed) return false
    set({ albums })
    return get().persistAlbums()
  },

  removeItem: async (albumId, item) => {
    let changed = false
    const albums = get().albums.map((album) => {
      if (album.id !== albumId) return album
      const items = album.items.filter((entry) => itemKey(entry) !== itemKey(item))
      changed = items.length !== album.items.length
      return changed ? { ...album, items, updatedAt: new Date().toISOString() } : album
    })
    if (!changed) return false
    set({ albums })
    return get().persistAlbums()
  },

  moveItem: async (albumId, item, direction) => {
    const album = get().albums.find((entry) => entry.id === albumId)
    if (!album) return false
    const index = album.items.findIndex((entry) => itemKey(entry) === itemKey(item))
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= album.items.length) return false
    const items = [...album.items]
    ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
    set({
      albums: get().albums.map((entry) =>
        entry.id === albumId ? { ...entry, items, updatedAt: new Date().toISOString() } : entry
      )
    })
    return get().persistAlbums()
  },

  persistAlbums: async () => {
    try {
      const result = await window.api?.saveAlbums(get().albums)
      return result?.success === true
    } catch {
      return false
    }
  }
}))
