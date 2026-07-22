import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { parseEpub } from '../services/parsers/epubParser'
import { parseTxt } from '../services/parsers/txtParser'
import { parsePdf } from '../services/parsers/pdfParser'
import { parseDocx } from '../services/parsers/docxParser'
import { parseMarkdown } from '../services/parsers/mdParser'
import { parseHtml } from '../services/parsers/htmlParser'
import { parseMobi } from '../services/parsers/mobiParser'
import { preprocessText, splitSentences } from '../services/parsers/textPreprocessor'
import type { LogService } from '../services/log-service'
import type { SettingsService } from '../services/settings-service'
import type { EngineManager } from '../services/tts-engines/engine-manager'
import type { BookData, CustomAlbum } from '../../src/global'
import { validateAlbums } from '../../src/utils/albumUtils'
import {
  normalizeBookCollection,
  normalizeBookData,
  normalizeChapters,
  normalizeSentences
} from '../../src/utils/bookData'

export function getDataDir(): string {
  const dir = join(app.getPath('userData'), '听伴')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getCacheDir(): string {
  const dir = join(getDataDir(), 'cache')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function loadJsonFile<T>(filename: string, fallback: T): T {
  const filePath = join(getDataDir(), filename)
  try {
    if (existsSync(filePath)) {
      const data = readFileSync(filePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch {
    // corrupted file
  }
  return fallback
}

function saveJsonFile(filename: string, data: unknown): void {
  const filePath = join(getDataDir(), filename)
  // 原子写入：先写同目录临时文件，再 rename 覆盖目标。
  // 写一半崩溃时目标文件保持完整，避免 books.json 被截断后书架变空。
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

const SUPPORTED_EXTENSIONS = ['epub', 'txt', 'pdf', 'docx', 'md', 'html', 'htm', 'mobi', 'azw', 'azw3', 'prc']

export function registerFileHandlers(
  logService: LogService,
  settingsService: SettingsService,
  engineManager: EngineManager
): void {
  // === Open file dialog ===
  ipcMain.handle('file:select', async (): Promise<string[] | null> => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: '选择书籍文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '电子书', extensions: SUPPORTED_EXTENSIONS },
        { name: 'EPUB', extensions: ['epub'] },
        { name: 'TXT', extensions: ['txt'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'DOCX', extensions: ['docx'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'HTML', extensions: ['html', 'htm'] },
        { name: 'MOBI/Kindle', extensions: ['mobi', 'azw', 'azw3', 'prc'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled) return null
    return result.filePaths
  })

  // === Import a book file ===
  ipcMain.handle('file:import', async (_event, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase()
    if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) {
      return {
        success: false,
        error: '不支持该格式，请使用 EPUB / TXT / PDF / DOCX / MD / HTML / MOBI 文件'
      }
    }

    try {
      let title = ''
      let author = '未知作者'
      let sentences: string[] = []
      let chapters: Array<{ title: string; startIndex: number; sentenceCount: number }> = []
      let epubCoverDataUrl: string | undefined

      if (ext === 'epub') {
        const result = await parseEpub(filePath, getCacheDir())
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
        // 提取内嵌封面（后续保存）
        epubCoverDataUrl = result.coverDataUrl
      } else if (ext === 'txt') {
        const result = parseTxt(filePath)
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      } else if (ext === 'pdf') {
        const result = await parsePdf(filePath)
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      } else if (ext === 'docx') {
        const result = await parseDocx(filePath)
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      } else if (ext === 'md') {
        const result = parseMarkdown(filePath)
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      } else if (ext === 'html' || ext === 'htm') {
        const result = parseHtml(filePath)
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      } else if (ext === 'mobi' || ext === 'azw' || ext === 'azw3' || ext === 'prc') {
        const result = await parseMobi(filePath, getCacheDir())
        title = result.title
        author = result.author
        sentences = result.sentences
        chapters = result.chapters
      }

      sentences = normalizeSentences(sentences)
      chapters = normalizeChapters(chapters, sentences.length)
      if (sentences.length === 0) {
        return { success: false, error: '无法提取文本内容，请确认文件未损坏' }
      }

      // Check for existing book with same path
      const existingBooks = normalizeBookCollection(loadJsonFile<unknown>('books.json', []))
      const existingIdx = existingBooks.findIndex((b) => b.filePath === filePath)

      // Preserve progress if updating an existing book
      const existingBook = existingIdx >= 0 ? existingBooks[existingIdx] : null

      const book = normalizeBookData({
        ...existingBook,
        id: existingBook?.id || uuidv4(),
        title: existingBook?.title || title,
        originalTitle: title,
        author,
        filePath,
        format: ext,
        sentences,
        chapters,
        currentChapterIndex: existingBook?.currentChapterIndex ?? 0,
        currentSentenceIndex: existingBook?.currentSentenceIndex ?? 0,
        progressPercent: existingBook?.progressPercent ?? 0,
        isCompleted: existingBook?.isCompleted ?? false,
        addedAt: existingBook?.addedAt || new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
        bookmarks: existingBook?.bookmarks || [],
        originalSentences: existingBook?.originalSentences ?? sentences,
        editHistory: existingBook?.editHistory
      })

      if (!book) {
        return { success: false, error: '解析结果不包含可朗读的有效文本' }
      }

      if (existingIdx >= 0) {
        existingBooks[existingIdx] = book
      } else {
        existingBooks.push(book)
      }

      saveJsonFile('books.json', existingBooks)
      logService.info('Parser', `成功导入书籍：《${title}》(${ext}, ${sentences.length}句)`)

      // 保存 EPUB 内嵌封面（仅新书或无自定义封面时覆盖）
      if (epubCoverDataUrl && book.coverSource !== 'custom') {
        try {
          const coversDir = join(app.getPath('userData'), '听伴', 'covers')
          if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true })
          const base64 = epubCoverDataUrl.replace(/^data:[^;]+;base64,/, '')
          const coverPath = join(coversDir, `${book.id}.png`)
          writeFileSync(coverPath, Buffer.from(base64, 'base64'))
          book.coverPath = coverPath
          book.coverSource = 'auto'
          // 同步更新 books.json 中的封面路径
          if (existingIdx >= 0) existingBooks[existingIdx] = book
          else existingBooks[existingBooks.length - 1] = book
          saveJsonFile('books.json', existingBooks)
        } catch {
          // 封面保存失败不影响导入
        }
      }

      return { success: true, book }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logService.error('Parser', `导入失败: ${errMsg}`, errMsg)
      return { success: false, error: `解析失败：${errMsg}` }
    }
  })

  // === Save all books (multi-book array) ===
  ipcMain.handle('file:saveProgress', async (_event, data: unknown) => {
    try {
      const books = normalizeBookCollection(data)
      if (!Array.isArray(data) || books.length !== data.length) {
        return { success: false, error: '书架数据包含无效文章，未执行保存' }
      }
      saveJsonFile('books.json', books)
      return { success: true }
    } catch (error) {
      logService.error('Storage', `保存进度失败: ${String(error)}`)
      return { success: false, error: '保存书架数据失败' }
    }
  })

  // === Load all books ===
  ipcMain.handle('file:loadProgress', async () => {
    const raw = loadJsonFile<unknown>('books.json', [])
    const books = normalizeBookCollection(raw)
    if (Array.isArray(raw) && books.length !== raw.length) {
      logService.warn('Storage', `已跳过 ${raw.length - books.length} 条无效书籍数据`)
    }
    try {
      if (JSON.stringify(raw) !== JSON.stringify(books)) saveJsonFile('books.json', books)
    } catch (error) {
      logService.warn('Storage', `修复后的书架数据暂未写回: ${String(error)}`)
    }
    return books
  })

  // === Save and load custom albums ===
  ipcMain.handle('album:save', async (_event, data: unknown) => {
    try {
      const albums = validateAlbums(data)
      saveJsonFile('albums.json', albums)
      return { success: true }
    } catch (error) {
      logService.error('Storage', `保存专辑失败: ${String(error)}`)
      return { success: false, error: '专辑数据无效，保存失败' }
    }
  })

  ipcMain.handle('album:load', async (): Promise<CustomAlbum[]> => {
    try {
      return validateAlbums(loadJsonFile<unknown>('albums.json', []))
    } catch (error) {
      logService.warn('Storage', `读取专辑失败，已使用空列表: ${String(error)}`)
      return []
    }
  })

  // === Save settings ===
  ipcMain.handle('file:saveSettings', async (_event, settings: unknown) => {
    try {
      await settingsService.save(settings as Record<string, unknown>)
    } catch (error) {
      logService.error('Storage', `保存设置失败: ${String(error)}`)
    }
  })

  // === Load settings ===
  ipcMain.handle('file:loadSettings', async () => {
    return settingsService.get()
  })

  // === Delete a book ===
  ipcMain.handle('file:deleteBook', async (_event, bookId: string) => {
    try {
      const books = loadJsonFile<BookData[]>('books.json', [])
      const filtered = books.filter((b) => b.id !== bookId)
      saveJsonFile('books.json', filtered)
      try {
        const albums = validateAlbums(loadJsonFile<unknown>('albums.json', []))
        const cleanedAlbums = albums.map((album) => ({
          ...album,
          items: album.items.filter(
            (item) => item.resourceType !== 'book' || item.resourceId !== bookId
          )
        }))
        if (
          cleanedAlbums.some((album, index) => album.items.length !== albums[index].items.length)
        ) {
          saveJsonFile(
            'albums.json',
            cleanedAlbums.map((album, index) =>
              album.items.length !== albums[index].items.length
                ? { ...album, updatedAt: new Date().toISOString() }
                : album
            )
          )
        }
      } catch {
        // A malformed album file should not prevent deleting the book.
      }
      // Also delete bookmarks for this book
      const bookmarkFile = join(getDataDir(), 'bookmarks.json')
      if (existsSync(bookmarkFile)) {
        const bookmarks = JSON.parse(readFileSync(bookmarkFile, 'utf-8'))
        const filteredBookmarks = bookmarks.filter((b: { bookId: string }) => b.bookId !== bookId)
        saveJsonFile('bookmarks.json', filteredBookmarks)
      }
      logService.info('Storage', `删除书籍: ${bookId}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // === Export bookmarks for a book ===
  ipcMain.handle('file:exportBookmarks', async (_event, bookId: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: '无活动窗口' }

      const bookmarkFile = join(getDataDir(), 'bookmarks.json')
      if (!existsSync(bookmarkFile)) {
        return { success: false, error: '无书签数据' }
      }
      const allBookmarks = JSON.parse(readFileSync(bookmarkFile, 'utf-8'))
      const bookBookmarks = allBookmarks.filter((b: { bookId: string }) => b.bookId === bookId)

      const result = await dialog.showSaveDialog(win, {
        title: '导出书签',
        defaultPath: `bookmarks-${bookId}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (!result.canceled && result.filePath) {
        writeFileSync(result.filePath, JSON.stringify(bookBookmarks, null, 2), 'utf-8')
        logService.info('Bookmark', `导出书签到: ${result.filePath}`)
        return { success: true }
      }
      return { success: false, error: '取消导出' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // === Reprocess book text (re-run preprocessor on already-imported books) ===
  ipcMain.handle('book:reprocess', async (_event, bookId: string) => {
    try {
      const books = normalizeBookCollection(loadJsonFile<unknown>('books.json', []))
      const idx = books.findIndex((b) => b.id === bookId)
      if (idx < 0) return { success: false, error: '书籍不存在' }

      const book = books[idx]
      const oldSentenceCount = book.sentences.length
      // Join all sentences, preprocess, re-split
      const joined = book.sentences.join('\n')
      const { text, stats } = preprocessText(joined)
      const newSentences = splitSentences(text)
      if (newSentences.length === 0) {
        return { success: false, error: '处理后没有可朗读文本，已保留原书内容' }
      }

      // Rebuild chapters: search for first sentence of each old chapter in new sentences.
      // Fallback to proportional mapping if text not found.
      const chapterList: Array<{ title: string; startIndex: number; sentenceCount: number }> = []
      for (let ci = 0; ci < book.chapters.length; ci++) {
        const ch = book.chapters[ci]
        const oldFirstSentence = book.sentences[ch.startIndex] || ''
        // Search for this sentence in the new array (full match or prefix of 20+ chars)
        let foundIdx = -1
        const needle =
          oldFirstSentence.length >= 20 ? oldFirstSentence.substring(0, 20) : oldFirstSentence
        if (needle) {
          for (let si = 0; si < newSentences.length; si++) {
            if (newSentences[si].startsWith(needle)) {
              foundIdx = si
              break
            }
          }
        }
        if (foundIdx >= 0) {
          // Determine sentenceCount: up to next chapter start or end
          const nextStart =
            ci + 1 < book.chapters.length
              ? (() => {
                  const nextFirst = book.sentences[book.chapters[ci + 1].startIndex] || ''
                  const nNeedle = nextFirst.length >= 20 ? nextFirst.substring(0, 20) : nextFirst
                  if (nNeedle) {
                    for (let si = foundIdx + 1; si < newSentences.length; si++) {
                      if (newSentences[si].startsWith(nNeedle)) return si
                    }
                  }
                  return newSentences.length
                })()
              : newSentences.length
          chapterList.push({
            title: ch.title,
            startIndex: foundIdx,
            sentenceCount: Math.max(1, nextStart - foundIdx)
          })
        } else {
          // Fallback: proportional mapping
          const oldTotal = book.sentences.length || 1
          const newTotal = newSentences.length || 1
          const newStart = Math.round((ch.startIndex / oldTotal) * newTotal)
          const oldEnd = ch.startIndex + ch.sentenceCount
          const newEnd = Math.round((oldEnd / oldTotal) * newTotal)
          chapterList.push({
            title: ch.title,
            startIndex: Math.min(newStart, newSentences.length - 1),
            sentenceCount: Math.max(1, Math.min(newEnd - newStart, newSentences.length - newStart))
          })
        }
      }

      const updatedBook = normalizeBookData({
        ...book,
        sentences: newSentences,
        chapters: normalizeChapters(chapterList, newSentences.length)
      })
      if (!updatedBook) {
        return { success: false, error: '处理结果无效，已保留原书内容' }
      }
      books[idx] = updatedBook
      saveJsonFile('books.json', books)

      logService.info(
        'Parser',
        `重新预处理：《${book.title}》(${oldSentenceCount}句 → ${newSentences.length}句，${stats.spacesRemoved}空格已消除)`
      )
      return { success: true, book: updatedBook, stats }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
  const coversDir = join(app.getPath('userData'), '听伴', 'covers')
  if (!existsSync(coversDir)) {
    mkdirSync(coversDir, { recursive: true })
  }

  // Save a cover image (base64 data URL or file path) for a book
  ipcMain.handle('cover:save', async (_event, bookId: string, dataUrl: string) => {
    try {
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buf = Buffer.from(base64Data, 'base64')
      const coverPath = join(coversDir, `${bookId}.png`)
      writeFileSync(coverPath, buf)
      return { success: true, coverPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Copy an image file as book cover
  ipcMain.handle('cover:upload', async (_event, bookId: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) {
        return { success: false, error: '无活动窗口' }
      }
      const result = await dialog.showOpenDialog(win, {
        title: '选择封面图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '取消选择' }
      }
      const srcPath = result.filePaths[0]
      const coverPath = join(coversDir, `${bookId}.png`)
      const imgBuf = readFileSync(srcPath)
      writeFileSync(coverPath, imgBuf)
      return { success: true, coverPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Get cover path for a book
  ipcMain.handle('cover:get', async (_event, bookId: string) => {
    const coverPath = join(coversDir, `${bookId}.png`)
    if (existsSync(coverPath)) {
      return coverPath
    }
    return null
  })

  // Get cover as data URL (for renderer display, bypasses file:// restriction)
  ipcMain.handle('cover:getDataUrl', async (_event, bookId: string) => {
    try {
      const coverPath = join(coversDir, `${bookId}.png`)
      if (!existsSync(coverPath)) return null
      const buf = readFileSync(coverPath)
      const base64 = buf.toString('base64')
      return `data:image/png;base64,${base64}`
    } catch {
      return null
    }
  })

  // === 导出音频：逐句合成 Edge TTS，拼接为一个 MP3 文件 ===
  ipcMain.handle(
    'export:audio',
    async (
      event,
      params: {
        sentences: string[]
        voiceId: string
        speed: number
        startIndex: number
        endIndex: number
        defaultName: string
      }
    ) => {
      const { sentences, voiceId, speed, startIndex, endIndex, defaultName } = params
      const total = endIndex - startIndex
      if (total <= 0) return { success: false, error: '导出范围为空' }

      // Show save dialog first
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: '窗口已关闭' }

      const saveResult = await dialog.showSaveDialog(win, {
        title: '导出音频',
        defaultPath: `${defaultName}.mp3`,
        filters: [{ name: 'MP3 音频', extensions: ['mp3'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: '取消导出' }
      }

      const outputPath = saveResult.filePath
      const chunks: Buffer[] = []
      let completed = 0

      logService.info('Export', `开始导出音频: ${defaultName} (${total} 句)`)

      try {
        for (let i = startIndex; i < endIndex; i++) {
          const text = sentences[i]
          if (!text || !text.trim()) {
            completed++
            event.sender.send('export:progress', { current: completed, total })
            continue
          }

          const result = await engineManager.synthesize(text, voiceId, speed, 1.0, 'edge')
          if (result.success && result.audio) {
            chunks.push(Buffer.from(result.audio, 'base64'))
          } else {
            logService.warn('Export', `第 ${i} 句合成失败: ${result.error || '未知'}`)
          }

          completed++
          event.sender.send('export:progress', { current: completed, total })
        }

        if (chunks.length === 0) {
          return { success: false, error: '所有句子合成均失败，请检查 Edge TTS 是否可用' }
        }

        // Buffer.concat — Edge CBR MP3 可以直接拼接
        writeFileSync(outputPath, Buffer.concat(chunks))
        logService.info(
          'Export',
          `导出完成: ${outputPath} (${chunks.length} 片段, ${(Buffer.concat(chunks).length / 1024).toFixed(0)} KB)`
        )
        event.sender.send('export:complete', {
          filePath: outputPath,
          size: Buffer.concat(chunks).length
        })
        return { success: true, filePath: outputPath }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logService.error('Export', `导出失败: ${msg}`)
        event.sender.send('export:error', { message: msg })
        return { success: false, error: msg }
      }
    }
  )

  // === 清除缓存 ===
  ipcMain.handle('data:clearCache', async (_event, type: string) => {
    try {
      const dir = join(app.getPath('userData'), '听伴')
      switch (type) {
        case 'books':
          if (existsSync(join(dir, 'books.json'))) unlinkSync(join(dir, 'books.json'))
          if (existsSync(join(dir, 'covers')))
            rmSync(join(dir, 'covers'), { recursive: true, force: true })
          break
        case 'history':
          if (existsSync(join(dir, 'history.json'))) unlinkSync(join(dir, 'history.json'))
          break
        case 'audio':
          if (existsSync(join(dir, 'edge_cache')))
            rmSync(join(dir, 'edge_cache'), { recursive: true, force: true })
          if (existsSync(join(dir, 'qwen_cache')))
            rmSync(join(dir, 'qwen_cache'), { recursive: true, force: true })
          break
        case 'logs':
          if (existsSync(join(dir, 'logs.json'))) unlinkSync(join(dir, 'logs.json'))
          if (existsSync(join(dir, 'bookmarks.json'))) unlinkSync(join(dir, 'bookmarks.json'))
          break
        case 'all':
          for (const f of ['books.json', 'history.json', 'logs.json', 'bookmarks.json']) {
            if (existsSync(join(dir, f))) unlinkSync(join(dir, f))
          }
          for (const d of ['covers', 'edge_cache', 'qwen_cache']) {
            if (existsSync(join(dir, d))) rmSync(join(dir, d), { recursive: true, force: true })
          }
          break
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
