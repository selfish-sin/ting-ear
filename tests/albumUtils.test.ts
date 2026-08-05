import {
  ALBUM_TITLE_MAX_LENGTH,
  FAVORITES_ALBUM_ID,
  FAVORITES_ALBUM_TITLE,
  ensureSystemAlbums,
  isFavoritesAlbum,
  mergeLegacyFavorites,
  sortAlbumsForDisplay,
  validateAlbums
} from '../src/utils/albumUtils'

let passed = 0
let failed = 0

function assert(label: string, fn: () => boolean): void {
  try {
    if (fn()) {
      passed++
      console.log(`  ok ${label}`)
    } else {
      failed++
      console.log(`  fail ${label}`)
    }
  } catch (error) {
    failed++
    console.log(`  fail ${label} - ${(error as Error).message}`)
  }
}

const timestamps = { createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }

assert('accepts nested albums and keeps parent relationship', () => {
  const albums = validateAlbums([
    { id: 'root', title: 'Root', parentId: null, items: [], ...timestamps },
    { id: 'child', title: 'Child', parentId: 'root', items: [], ...timestamps }
  ])
  return albums[1].parentId === 'root'
})

assert('deduplicates repeated resource references', () => {
  const [album] = validateAlbums([
    {
      id: 'root',
      title: 'Root',
      parentId: null,
      items: [
        { resourceType: 'book', resourceId: 'book-1' },
        { resourceType: 'book', resourceId: 'book-1' }
      ],
      ...timestamps
    }
  ])
  return album.items.length === 1
})

assert('rejects a title longer than the configured limit', () => {
  try {
    validateAlbums([
      {
        id: 'root',
        title: 'x'.repeat(ALBUM_TITLE_MAX_LENGTH + 1),
        parentId: null,
        items: [],
        ...timestamps
      }
    ])
    return false
  } catch {
    return true
  }
})

assert('rejects a missing parent album', () => {
  try {
    validateAlbums([{ id: 'child', title: 'Child', parentId: 'missing', items: [], ...timestamps }])
    return false
  } catch {
    return true
  }
})

assert('rejects cyclic album nesting', () => {
  try {
    validateAlbums([
      { id: 'a', title: 'A', parentId: 'b', items: [], ...timestamps },
      { id: 'b', title: 'B', parentId: 'a', items: [], ...timestamps }
    ])
    return false
  } catch {
    return true
  }
})

assert('ensureSystemAlbums injects favorites at front', () => {
  const { albums, changed } = ensureSystemAlbums([
    { id: 'a', title: 'A', parentId: null, items: [], ...timestamps }
  ])
  return (
    changed === true &&
    albums[0].id === FAVORITES_ALBUM_ID &&
    albums[0].title === FAVORITES_ALBUM_TITLE &&
    albums[1].id === 'a'
  )
})

assert('ensureSystemAlbums normalizes existing favorites title/parent', () => {
  const { albums, changed } = ensureSystemAlbums([
    {
      id: FAVORITES_ALBUM_ID,
      title: 'wrong',
      parentId: 'a',
      items: [],
      ...timestamps
    },
    { id: 'a', title: 'A', parentId: null, items: [], ...timestamps }
  ])
  const fav = albums.find((a) => a.id === FAVORITES_ALBUM_ID)!
  return changed && fav.title === FAVORITES_ALBUM_TITLE && fav.parentId === null && albums[0].id === FAVORITES_ALBUM_ID
})

assert('sortAlbumsForDisplay keeps favorites first', () => {
  const sorted = sortAlbumsForDisplay([
    { id: 'z', title: 'Z', parentId: null, items: [], createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    {
      id: FAVORITES_ALBUM_ID,
      title: FAVORITES_ALBUM_TITLE,
      parentId: null,
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    { id: 'a', title: 'A', parentId: null, items: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  ])
  return sorted[0].id === FAVORITES_ALBUM_ID && sorted[1].id === 'a' && sorted[2].id === 'z'
})

assert('mergeLegacyFavorites adds missing book ids once', () => {
  const base = [
    {
      id: FAVORITES_ALBUM_ID,
      title: FAVORITES_ALBUM_TITLE,
      parentId: null,
      items: [{ resourceType: 'book' as const, resourceId: 'b1' }],
      ...timestamps
    }
  ]
  const { albums, changed } = mergeLegacyFavorites(base, ['b1', 'b2', 'b2'])
  const fav = albums.find((a) => a.id === FAVORITES_ALBUM_ID)!
  const ids = fav.items.filter((i) => i.resourceType === 'book').map((i) => i.resourceId)
  return changed && ids.includes('b1') && ids.includes('b2') && ids.length === 2
})

assert('isFavoritesAlbum recognizes system id', () => {
  return isFavoritesAlbum(FAVORITES_ALBUM_ID) && !isFavoritesAlbum('other')
})

assert('validateAlbums forces favorites title', () => {
  const [fav] = validateAlbums([
    {
      id: FAVORITES_ALBUM_ID,
      title: 'anything',
      parentId: 'x',
      items: [],
      ...timestamps
    }
  ])
  return fav.title === FAVORITES_ALBUM_TITLE && fav.parentId === null
})

console.log(`\nAlbum utility tests: ${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
