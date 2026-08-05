import type { AlbumItem, CustomAlbum } from '../global'

export const ALBUM_TITLE_MAX_LENGTH = 40

/** 常驻系统专辑：收藏（固定 id，不可删除） */
export const FAVORITES_ALBUM_ID = 'system:favorites'
export const FAVORITES_ALBUM_TITLE = '收藏'

/** 旧版星标 localStorage key（加载时迁入收藏专辑后清除） */
export const LEGACY_FAVORITES_STORAGE_KEY = 'ting-ear-favorites'

export function normalizeAlbumTitle(title: string): string {
  return title.trim()
}

export function isFavoritesAlbum(albumOrId: CustomAlbum | string | null | undefined): boolean {
  if (!albumOrId) return false
  const id = typeof albumOrId === 'string' ? albumOrId : albumOrId.id
  return id === FAVORITES_ALBUM_ID
}

export function createFavoritesAlbum(now = new Date().toISOString()): CustomAlbum {
  return {
    id: FAVORITES_ALBUM_ID,
    title: FAVORITES_ALBUM_TITLE,
    parentId: null,
    items: [],
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 保证收藏专辑存在、标题/父级正确，并排到最前。
 * 返回 { albums, changed } 供调用方决定是否写盘。
 */
export function ensureSystemAlbums(albums: CustomAlbum[]): { albums: CustomAlbum[]; changed: boolean } {
  const now = new Date().toISOString()
  let changed = false
  let list = [...albums]

  const idx = list.findIndex((a) => a.id === FAVORITES_ALBUM_ID)
  if (idx < 0) {
    list = [createFavoritesAlbum(now), ...list]
    changed = true
  } else {
    const fav = list[idx]
    if (fav.title !== FAVORITES_ALBUM_TITLE || fav.parentId !== null) {
      list[idx] = {
        ...fav,
        title: FAVORITES_ALBUM_TITLE,
        parentId: null,
        updatedAt: now
      }
      changed = true
    }
  }

  const sorted = sortAlbumsForDisplay(list)
  // 顺序变化也算展示层需要；若仅顺序不同也标记，便于持久化稳定顺序
  if (sorted.some((a, i) => a.id !== list[i]?.id)) {
    changed = true
  }
  return { albums: sorted, changed }
}

/** 收藏固定第一，其余按创建时间升序（稳定、不「消失」乱序） */
export function sortAlbumsForDisplay(albums: CustomAlbum[]): CustomAlbum[] {
  return [...albums].sort((a, b) => {
    if (a.id === FAVORITES_ALBUM_ID) return -1
    if (b.id === FAVORITES_ALBUM_ID) return 1
    const ta = a.createdAt || ''
    const tb = b.createdAt || ''
    if (ta !== tb) return ta.localeCompare(tb)
    return a.id.localeCompare(b.id)
  })
}

/**
 * 把旧 localStorage 星标合并进收藏专辑。
 * 返回 changed；调用方负责 removeItem 旧 key。
 */
export function mergeLegacyFavorites(
  albums: CustomAlbum[],
  legacyIds: string[]
): { albums: CustomAlbum[]; changed: boolean } {
  if (!legacyIds.length) return { albums, changed: false }
  const { albums: withSystem } = ensureSystemAlbums(albums)
  const fav = withSystem.find((a) => a.id === FAVORITES_ALBUM_ID)
  if (!fav) return { albums: withSystem, changed: false }

  const existing = new Set(
    fav.items.filter((i) => i.resourceType === 'book').map((i) => i.resourceId)
  )
  const toAdd: AlbumItem[] = []
  for (const id of legacyIds) {
    if (typeof id !== 'string' || !id || existing.has(id)) continue
    existing.add(id)
    toAdd.push({ resourceType: 'book', resourceId: id })
  }
  if (toAdd.length === 0) return { albums: withSystem, changed: false }

  const now = new Date().toISOString()
  const next = withSystem.map((a) =>
    a.id === FAVORITES_ALBUM_ID
      ? { ...a, items: [...a.items, ...toAdd], updatedAt: now }
      : a
  )
  return { albums: sortAlbumsForDisplay(next), changed: true }
}

export function readLegacyFavoriteIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && !!x)
  } catch {
    return []
  }
}

export function clearLegacyFavoritesStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function validateAlbums(value: unknown): CustomAlbum[] {
  if (!Array.isArray(value)) throw new Error('专辑数据格式无效')

  const ids = new Set<string>()
  const albums = value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('专辑数据格式无效')
    const source = raw as Partial<CustomAlbum>
    const id = typeof source.id === 'string' ? source.id : ''
    let title = typeof source.title === 'string' ? normalizeAlbumTitle(source.title) : ''
    if (!id || ids.has(id)) throw new Error('专辑 ID 无效')
    // 系统收藏：强制标题
    if (id === FAVORITES_ALBUM_ID) {
      title = FAVORITES_ALBUM_TITLE
    }
    if (!title || title.length > ALBUM_TITLE_MAX_LENGTH) throw new Error('专辑标题长度无效')
    ids.add(id)

    const items: AlbumItem[] = Array.isArray(source.items)
      ? source.items.reduce<AlbumItem[]>((result, item) => {
          if (!item || typeof item !== 'object') return result
          const candidate = item as Partial<AlbumItem>
          if (
            (candidate.resourceType !== 'book' && candidate.resourceType !== 'audio') ||
            typeof candidate.resourceId !== 'string' ||
            !candidate.resourceId
          ) {
            return result
          }
          if (
            !result.some(
              (entry) =>
                entry.resourceType === candidate.resourceType &&
                entry.resourceId === candidate.resourceId
            )
          ) {
            result.push({ resourceType: candidate.resourceType, resourceId: candidate.resourceId })
          }
          return result
        }, [])
      : []

    return {
      id,
      title,
      parentId:
        id === FAVORITES_ALBUM_ID
          ? null
          : typeof source.parentId === 'string'
            ? source.parentId
            : null,
      items,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()
    }
  })

  const byId = new Map(albums.map((album) => [album.id, album]))
  for (const album of albums) {
    if (album.parentId && (!byId.has(album.parentId) || album.parentId === album.id)) {
      throw new Error('专辑父级无效')
    }
    const visited = new Set<string>([album.id])
    let parentId = album.parentId
    while (parentId) {
      if (visited.has(parentId)) throw new Error('专辑层级存在循环引用')
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId || null
    }
  }
  return albums
}
