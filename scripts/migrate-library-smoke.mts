/** 一次性把已恢复的 books.json 迁到 library/ 分片布局 */
import { LibraryStorage } from '../electron/services/library-storage'
import fs from 'fs'
import path from 'path'
import os from 'os'

const root = path.join(os.homedir(), 'AppData', 'Roaming', 'ting-ear')
const dataDir = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(root, d.name))
  .find((d) => fs.existsSync(path.join(d, 'books.json')))!

console.log('dataDir', dataDir)
const storage = new LibraryStorage(() => dataDir)
const t0 = Date.now()
const books = storage.loadAll()
console.log('loaded', books.length, 'in', Date.now() - t0, 'ms')
console.log('hasLibrary', storage.hasLibraryLayout())
console.log('library/books files', fs.readdirSync(path.join(dataDir, 'library', 'books')).length)
console.log('progress.json size', fs.statSync(path.join(dataDir, 'progress.json')).size)
console.log('index size', fs.statSync(path.join(dataDir, 'library', 'index.json')).size)

// second load should be from library
const t1 = Date.now()
const books2 = storage.loadAll()
console.log('reload', books2.length, 'in', Date.now() - t1, 'ms')

// progress-only save
const t2 = Date.now()
storage.saveBooksProgress(books2)
console.log('progress save in', Date.now() - t2, 'ms')

// full save should skip all book files
const t3 = Date.now()
const r = storage.saveLibrary(books2)
console.log('full save', r, 'in', Date.now() - t3, 'ms')
