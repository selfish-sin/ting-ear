import type { AlbumItem, CustomAlbum } from '../global'

export const ALBUM_TITLE_MAX_LENGTH = 40

export function normalizeAlbumTitle(title: string): string {
  return title.trim()
}

export function validateAlbums(value: unknown): CustomAlbum[] {
  if (!Array.isArray(value)) throw new Error('专辑数据格式无效')

  const ids = new Set<string>()
  const albums = value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('专辑数据格式无效')
    const source = raw as Partial<CustomAlbum>
    const id = typeof source.id === 'string' ? source.id : ''
    const title = typeof source.title === 'string' ? normalizeAlbumTitle(source.title) : ''
    if (!id || ids.has(id)) throw new Error('专辑 ID 无效')
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
      parentId: typeof source.parentId === 'string' ? source.parentId : null,
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
