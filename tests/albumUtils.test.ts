import { ALBUM_TITLE_MAX_LENGTH, validateAlbums } from '../src/utils/albumUtils'

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

console.log(`\nAlbum utility tests: ${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
