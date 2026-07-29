import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'

const root = path.join(os.homedir(), 'AppData', 'Roaming', 'ting-ear')
const dataDir = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(root, d.name))
  .find((d) => fs.existsSync(path.join(d, 'books.json')))

console.log('dataDir=', dataDir)
const booksPath = path.join(dataDir, 'books.json')
const booksRaw = fs.readFileSync(booksPath, 'utf8')
console.log('books.json bytes=', Buffer.byteLength(booksRaw), 'content=', booksRaw)

const history = JSON.parse(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8'))
const byId = new Map()
for (const h of history) {
  const cur = byId.get(h.bookId) || { title: h.bookTitle, maxSent: 0, last: h.endTime }
  cur.maxSent = Math.max(cur.maxSent, h.endSentenceIndex || 0, h.startSentenceIndex || 0)
  if (h.endTime > cur.last) cur.last = h.endTime
  if (h.bookTitle) cur.title = h.bookTitle
  byId.set(h.bookId, cur)
}
console.log('history books=', byId.size)
for (const [id, v] of byId) console.log(' ', id, v.title, 'maxSent', v.maxSent)

const ingest = JSON.parse(fs.readFileSync(path.join(dataDir, 'ingest-status.json'), 'utf8'))
console.log('ingest ids=', Object.keys(ingest).length)

const covers = fs.readdirSync(path.join(dataDir, 'covers')).filter((f) => f.endsWith('.png'))
console.log('covers=', covers.length)

const logs = JSON.parse(fs.readFileSync(path.join(dataDir, 'logs.json'), 'utf8'))
const pathHits = new Set()
const importMsgs = []
for (const l of logs) {
  const m = String(l.message || l.msg || '')
  if (/导入|解析|已添加|epub|pdf|docx|\.txt|filePath|打开文件|Import/i.test(m)) {
    importMsgs.push(`${l.timestamp || l.time || ''} ${m.slice(0, 240)}`)
  }
  for (const m2 of m.matchAll(/[A-Za-z]:\\[^\s"'`]+/g)) pathHits.add(m2[0])
}
console.log('path hits in logs=', pathHits.size)
;[...pathHits].slice(0, 30).forEach((p) => console.log(' ', p))
console.log('import-like msgs=', importMsgs.length)
importMsgs.slice(-40).forEach((m) => console.log(' ', m))

// probe nmem health
const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
const baseUrl = settings?.ai?.nmem?.baseUrl || 'http://127.0.0.1:14242'
console.log('nmem baseUrl=', baseUrl)
try {
  const url = new URL('/health', baseUrl)
  await new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        console.log('nmem health status', res.statusCode, body.slice(0, 300))
        resolve()
      })
    })
    req.on('error', (e) => {
      console.log('nmem unreachable', e.message)
      resolve()
    })
    req.on('timeout', () => {
      req.destroy()
      console.log('nmem timeout')
      resolve()
    })
  })
} catch (e) {
  console.log('nmem probe fail', e.message)
}
