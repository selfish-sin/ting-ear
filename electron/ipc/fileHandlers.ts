import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync, unlinkSync, readdirSync, statSync, copyFileSync } from 'fs'
import { writeFile, rename, copyFile, stat as fsStat } from 'fs/promises'
import { join, resolve } from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { parseEpub } from '../services/parsers/epubParser'
import { parseTxt } from '../services/parsers/txtParser'
import { parsePdf } from '../services/parsers/pdfParser'
import { parseDocx } from '../services/parsers/docxParser'
import { parseMarkdown } from '../services/parsers/mdParser'
import { parseHtml } from '../services/parsers/htmlParser'
import { parseMobi } from '../services/parsers/mobiParser'
import {
  preprocessText,
  splitSentences,
  setActiveCleanRules
} from '../services/parsers/textPreprocessor'
import type { LogService } from '../services/log-service'
import type { SettingsService } from '../services/settings-service'
import type { EngineManager } from '../services/tts-engines/engine-manager'
import type { BookData, CustomAlbum } from '../../src/global'
import { validateAlbums } from '../../src/utils/albumUtils'
import { PRESET_BACKGROUNDS } from '../../src/backgroundPresets'
import {
  buildSkeletonStructure,
  healBookLayoutForReading,
  isUnhealthyBookLayout,
  MAX_STRUCTURE_BLOCKS_IN_MEMORY,
  normalizeBookData,
  normalizeChapters,
  normalizeSentences,
  resolveSourceBoundaries
} from '../../src/utils/bookData'
import {
  generatePseudoStructure,
  regroupStructuredChapters,
  validateStructure
} from '../services/parsers/structureBuilder'
import {
  buildChaptersByMode,
  chaptersToBoundaries,
  type Boundary,
  type ChapterMode
} from '../services/parsers/chapterBuilder'
import { hashSentences } from '../../src/utils/contentHash'
import { mergeAiSettings } from '../services/ai/ai-config'
import { NmemBridge } from '../services/ai/nmem-bridge'
import { IngestService } from '../services/ai/ingest-service'
import { IngestScheduler } from '../services/ai/ingest-scheduler'
import { LibraryStorage } from '../services/library-storage'
import { atomicWriteFile } from '../utils/atomicWrite'
import { isBookId, isSettingsPartial } from '../utils/ipcValidate'

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }
  const items = readdirSync(src)
  for (const item of items) {
    const srcPath = join(src, item)
    const destPath = join(dest, item)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/** 自定义数据目录路径（由 settings.dataDir 设置，为空时回退到默认路径） */
let customDataDir: string | null = null

/** 共享的知识库导入调度器实例（registerFileHandlers 时创建，供其它 handler 复用，统一去重入口） */
let ingestSchedulerInstance: IngestScheduler | null = null

/** 共享的书架存储实例（退出前 flush 进度用） */
let libraryStorageInstance: LibraryStorage | null = null

/** 获取共享的 IngestScheduler（aiHandlers 等模块复用，避免再开一条无去重的裸上传线） */
export function getIngestScheduler(): IngestScheduler | null {
  return ingestSchedulerInstance
}

/** 进程退出前同步落盘未写回的阅读进度（防抖窗口内的最后数据） */
export function flushLibraryProgressOnQuit(): void {
  libraryStorageInstance?.flushProgressSync()
}

/** 数据目录下的 backgrounds/ 绝对路径（已确保存在）。导出供测试。 */
export function getBackgroundsDirPath(): string {
  // 测试钩子：允许临时指定数据目录（与 resolveBackgroundDataUrl 一致）
  const base = process.env.TINGEAR_BG_TEST_DATADIR || getDataDir()
  const dir = join(base, 'backgrounds')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 把背景图源解析为 data URL；文件缺失返回 null。纯函数，供 IPC 与测试复用。 */
export async function resolveBackgroundDataUrl(
  source: 'preset' | 'custom',
  key: string | null
): Promise<string | null> {
  try {
    let absPath: string | null = null
    if (source === 'preset') {
      const preset = PRESET_BACKGROUNDS.find((p) => p.id === key)
      if (!preset) return null
      let packaged = false
      try {
        packaged = app?.isPackaged === true
      } catch {
        packaged = false
      }
      absPath = packaged
        ? join(process.resourcesPath, 'backgrounds', preset.file)
        : join(__dirname, '../../resources/backgrounds', preset.file)
    } else {
      if (!key) return null
      // 测试钩子：允许临时指定数据目录
      const base = process.env.TINGEAR_BG_TEST_DATADIR || getDataDir()
      absPath = join(base, key)
    }
    if (!existsSync(absPath)) return null
    const buf = readFileSync(absPath)
    const ext = absPath.toLowerCase().endsWith('.png')
      ? 'png'
      : absPath.toLowerCase().endsWith('.webp')
        ? 'webp'
        : 'jpeg'
    return `data:image/${ext};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 设置自定义数据目录（供 SettingsService 在加载配置后调用） */
export function setCustomDataDir(dir: string | null): void {
  customDataDir = dir || null
}

/** 获取默认数据目录（不可变的基础路径） */
export function getDefaultDataDir(): string {
  return join(app.getPath('userData'), '听伴')
}

export function getDataDir(): string {
  const dir = customDataDir || getDefaultDataDir()
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

async function saveJsonFile(filename: string, data: unknown, pretty = true): Promise<void> {
  const filePath = join(getDataDir(), filename)
  // 原子写入：先写同目录临时文件，再 rename 覆盖目标。
  // 写一半崩溃时目标文件保持完整，避免 books.json 被截断后书架变空。
  const tmpPath = `${filePath}.tmp`
  // books.json 可达数十 MB：紧凑序列化显著降低 stringify/写盘耗时与体积
  const payload =
    filename === 'books.json' || filename.endsWith('.book.json') || filename === 'library-index.json' || filename === 'progress.json'
      ? JSON.stringify(data)
      : pretty
        ? JSON.stringify(data, null, 2)
        : JSON.stringify(data)

  // 覆盖 books.json 前保留滚动备份（最多 3 份），防止再次空写/损坏丢书
  if (filename === 'books.json' && existsSync(filePath)) {
    try {
      const fileStat = await fsStat(filePath)
      if (fileStat.size > 10) {
        const bak1 = `${filePath}.bak`
        const bak2 = `${filePath}.bak.1`
        const bak3 = `${filePath}.bak.2`
        if (existsSync(bak2)) {
          try { await copyFile(bak2, bak3) } catch { /* ignore */ }
        }
        if (existsSync(bak1)) {
          try { await copyFile(bak1, bak2) } catch { /* ignore */ }
        }
        await copyFile(filePath, bak1)
      }
    } catch {
      /* 备份失败不阻断主写入 */
    }
  }

  await writeFile(tmpPath, payload, 'utf-8')
  await rename(tmpPath, filePath)
}

const SUPPORTED_EXTENSIONS = ['epub', 'txt', 'pdf', 'docx', 'md', 'html', 'htm', 'mobi', 'azw', 'azw3', 'prc']

interface ParsedBookFile {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
  sourceBoundaries?: Boundary[]
  epubCoverDataUrl?: string
  structure?: import('../../src/global').StructuredChapter[]
  structureMeta?: import('../../src/global').StructureMeta
}

/** 解析结果统一补全 sourceBoundaries + original 默认章节 */
function finalizeParsedChapters(parsed: ParsedBookFile): ParsedBookFile {
  const sentences = parsed.sentences || []
  const sourceBoundaries: Boundary[] =
    parsed.sourceBoundaries && parsed.sourceBoundaries.length > 0
      ? parsed.sourceBoundaries
      : chaptersToBoundaries(parsed.chapters || [])
  const chapters = normalizeChapters(
    buildChaptersByMode(sentences.length, sourceBoundaries, 'original'),
    sentences.length
  )
  return { ...parsed, sentences, chapters, sourceBoundaries }
}

/** 按扩展名分发到对应 parser（file:import 与 book:reparse 共用） */
async function parseBookFile(filePath: string, ext: string): Promise<ParsedBookFile> {
  let parsed: ParsedBookFile
  if (ext === 'epub') {
    const r = await parseEpub(filePath, getCacheDir())
    parsed = {
      title: r.title,
      author: r.author,
      sentences: r.sentences,
      chapters: r.chapters,
      sourceBoundaries: r.sourceBoundaries,
      epubCoverDataUrl: r.coverDataUrl,
      structure: r.structure,
      structureMeta: r.structureMeta
    }
  } else if (ext === 'txt') {
    parsed = { ...parseTxt(filePath) }
  } else if (ext === 'pdf') {
    parsed = { ...(await parsePdf(filePath)) }
  } else if (ext === 'docx') {
    parsed = { ...(await parseDocx(filePath)) }
  } else if (ext === 'md') {
    const r = parseMarkdown(filePath)
    parsed = {
      title: r.title,
      author: r.author,
      sentences: r.sentences,
      chapters: r.chapters,
      sourceBoundaries: r.sourceBoundaries,
      structure: r.structure,
      structureMeta: r.structureMeta
    }
  } else if (ext === 'html' || ext === 'htm') {
    parsed = { ...parseHtml(filePath) }
  } else if (ext === 'mobi' || ext === 'azw' || ext === 'azw3' || ext === 'prc') {
    parsed = { ...(await parseMobi(filePath, getCacheDir())) }
  } else {
    throw new Error(`不支持的格式: ${ext}`)
  }
  return finalizeParsedChapters(parsed)
}

export function registerFileHandlers(
  logService: LogService,
  settingsService: SettingsService,
  engineManager: EngineManager
): void {
  const libraryStorage = new LibraryStorage(getDataDir)
  libraryStorageInstance = libraryStorage
  const nmem = new NmemBridge(() => mergeAiSettings(settingsService.get().ai).nmem)
  const ingestService = new IngestService(nmem)

  // 从分片书架加载全部书（供 ingest 探针使用）
  ingestSchedulerInstance = new IngestScheduler(
    getDataDir,
    nmem,
    ingestService,
    () => libraryStorage.loadAll(),
    (level, msg) => level === 'info' ? logService.info('AI', msg) : logService.error('AI', msg),
    // 轻量索引：探针先用指纹预筛，稳态下不再每 30s 全量加载全文
    () => libraryStorage.loadBookIndex()
  )
  const ingestScheduler = ingestSchedulerInstance

  // 启动探针（autoIngest 开启时生效）
  if (mergeAiSettings(settingsService.get().ai).nmem.autoIngest) {
    ingestScheduler.start()
  }

  const autoIngestBook = (book: BookData): void => {
    if (!mergeAiSettings(settingsService.get().ai).nmem.autoIngest) return
    void ingestScheduler.tryIngest(book).then((ok) => {
      if (!ok) {
        const win = BrowserWindow.getFocusedWindow()
        win?.webContents.send('ai:ingest:error', `知识库未连接，《${book.title}》将在连接后自动导入`)
      }
    })
  }

  ipcMain.handle('ai:nmem:sync-all', async (_event, force = false) => {
    try {
      // 默认只同步需要更新的书；force=true 才整本强制重传（避免 MDM 重复堆源）
      const result = await ingestScheduler.syncAll({ force: Boolean(force) })
      logService.info(
        'AI',
        `知识库同步完成: 成功 ${result.synced} 本，失败 ${result.failed} 本，跳过已同步 ${result.skipped} 本`
      )
      return { success: true, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `知识库全量同步失败: ${message}`)
      return { success: false, error: message }
    }
  })

  // === 知识库去重：删除同一本书的多余 source，确保每本只有一份 ===
  ipcMain.handle('ai:nmem:dedupe', async () => {
    try {
      const result = await ingestScheduler.dedupeSources()
      logService.info('AI', `知识库去重: 删除 ${result.removed} 个重复源，保留 ${result.kept} 本`)
      return { success: true, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logService.error('AI', `知识库去重失败: ${message}`)
      return { success: false, error: message }
    }
  })

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
  ipcMain.handle('file:import', async (event, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase()
    if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) {
      return {
        success: false,
        error: '不支持该格式，请使用 EPUB / TXT / PDF / DOCX / MD / HTML / MOBI 文件'
      }
    }

    const emitProgress = (phase: string, detail?: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('file:import-progress', { filePath, phase, detail, format: ext })
      }
    }

    // 导入时应用用户在「设置 → 清洗」中的规则（与手动清洗同一套）
    setActiveCleanRules(settingsService.getCleanRules())
    try {
      emitProgress('parsing', `正在解析 ${ext.toUpperCase()}…`)
      const parsed = await parseBookFile(filePath, ext)
      const title = parsed.title
      const author = parsed.author || '未知作者'
      const epubCoverDataUrl = parsed.epubCoverDataUrl
      const parsedStructure = parsed.structure
      const parsedStructureMeta = parsed.structureMeta

      emitProgress('normalizing', '正在分句与结构化…')
      const sentences = normalizeSentences(parsed.sentences)
      const chapters = normalizeChapters(parsed.chapters, sentences.length)
      const sourceBoundaries = parsed.sourceBoundaries || chaptersToBoundaries(chapters)
      if (sentences.length === 0) {
        const emptyHint =
          ext === 'pdf'
            ? '无法提取文本内容。扫描版 PDF 仅有图片层，请先 OCR 或改用文字版 PDF/EPUB/TXT'
            : '无法提取文本内容，请确认文件未损坏'
        return { success: false, error: emptyHint }
      }

      // === 结构化处理 ===
      // 有解析产出的 structure（MD/EPUB）先按 original 切开超长章；其他格式生成 pseudo
      let finalStructure = parsedStructure
      let finalStructureMeta = parsedStructureMeta
      if (finalStructure?.length) {
        const refined = regroupStructuredChapters(finalStructure, { mode: 'original' })
        finalStructure = refined.structure
        // 章表以 finalize 的 chapters 为准；若 structure 仍巨量 block 则改骨架入库
        let blockCount = 0
        for (const ch of finalStructure) blockCount += ch.blocks?.length || 0
        if (blockCount > MAX_STRUCTURE_BLOCKS_IN_MEMORY) {
          finalStructure = buildSkeletonStructure(chapters)
          finalStructureMeta = finalStructureMeta
            ? {
                ...finalStructureMeta,
                sourceFormat: `${finalStructureMeta.sourceFormat || 'import'}-skeleton`
              }
            : undefined
        }
      } else {
        const pseudo = generatePseudoStructure(sentences, chapters)
        finalStructure = pseudo.structure
        finalStructureMeta = pseudo.structureMeta
      }

      // Check for existing book with same path（轻量查 index，不读全部书文件）
      emitProgress('saving', '正在写入书架…')
      const existingEntry = libraryStorage.findByFilePath(filePath)
      // 仅在同路径已存在时才读旧书；新书跳过磁盘读
      const existingBook = existingEntry ? libraryStorage.loadSingleBook(existingEntry.id) : null

      // 哈希只算一次；旧书优先用 structureMeta.contentHash，避免再扫一遍全文
      const incomingContentHash = hashSentences(sentences)
      const existingStructureValid = existingBook ? validateStructure(existingBook) : false
      const existingHash =
        existingBook?.structureMeta?.contentHash ||
        (existingBook ? hashSentences(existingBook.sentences) : null)

      // 正文是否实质变化：比较全文稳定哈希，避免后文变化却错误沿用旧结构。
      const contentChanged = !existingBook || existingHash !== incomingContentHash

      const structureMetaForSave =
        !contentChanged && existingStructureValid
          ? existingBook?.structureMeta
          : finalStructureMeta
            ? { ...finalStructureMeta, contentHash: incomingContentHash, schemaVersion: 1 as const }
            : {
                schemaVersion: 1 as const,
                contentHash: incomingContentHash,
                sourceFormat: ext
              }

      // 传入已算 contentHash，避免 normalize 内再扫一遍全文
      const book = normalizeBookData(
        {
          ...existingBook,
          id: existingBook?.id || uuidv4(),
          title: existingBook?.title || title,
          originalTitle: title,
          author,
          filePath,
          format: ext,
          sentences,
          chapters,
          sourceBoundaries,
          // 导入默认「原始」切法；用户在预选页可改合并并写库
          chapterMode: 'original' as const,
          currentChapterIndex: existingBook?.currentChapterIndex ?? 0,
          currentSentenceIndex: existingBook?.currentSentenceIndex ?? 0,
          progressPercent: existingBook?.progressPercent ?? 0,
          isCompleted: existingBook?.isCompleted ?? false,
          addedAt: existingBook?.addedAt || new Date().toISOString(),
          lastReadAt: new Date().toISOString(),
          bookmarks: existingBook?.bookmarks || [],
          // 重导入且正文变了：用新正文作为原文，并丢弃失效的清洗版本
          originalSentences: contentChanged ? sentences : (existingBook?.originalSentences ?? sentences),
          editHistory: contentChanged ? undefined : existingBook?.editHistory,
          timeMap: contentChanged ? undefined : existingBook?.timeMap,
          // 结构化：内容未变且旧 structure 健康才沿用；病态旧数据绝不「修完又盖回去」
          structure:
            !contentChanged &&
            existingStructureValid &&
            existingBook &&
            !isUnhealthyBookLayout(existingBook)
              ? existingBook.structure
              : finalStructure,
          structureMeta: structureMetaForSave
        },
        { contentHash: incomingContentHash }
      )

      if (!book) {
        return { success: false, error: '解析结果不包含可朗读的有效文本' }
      }

      // 入库关口：统一治愈超长章 / 巨 structure（与打开路径同一把尺子）
      let bookToSave = healBookLayoutForReading(book).book

      // 封面先写好再一次性落盘，避免 saveSingleBook 两次
      if (epubCoverDataUrl && bookToSave.coverSource !== 'custom') {
        try {
          const coversDir = join(getDataDir(), 'covers')
          if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true })
          const base64 = epubCoverDataUrl.replace(/^data:[^;]+;base64,/, '')
          const coverPath = join(coversDir, `${bookToSave.id}.png`)
          writeFileSync(coverPath, Buffer.from(base64, 'base64'))
          bookToSave = { ...bookToSave, coverPath, coverSource: 'auto' }
        } catch {
          // 封面保存失败不影响导入
        }
      }

      libraryStorage.saveSingleBook(bookToSave)
      logService.info(
        'Parser',
        `成功导入书籍：《${title}》(${ext}, ${sentences.length}句, ${bookToSave.chapters.length}章)`
      )

      // 后台 ingest，不阻塞导入返回
      autoIngestBook(bookToSave)
      emitProgress('done', `导入完成：${sentences.length} 句`)
      // PDF 仅文字层：句数极少时提示可能是扫描件
      const warning =
        ext === 'pdf' && sentences.length < 20
          ? 'PDF 仅支持文字层。若内容很少或乱码，可能是扫描版，请先 OCR 或改用 EPUB/TXT'
          : ext === 'pdf'
            ? '提示：PDF 仅提取文字层，扫描版图片页不会识别'
            : undefined
      return { success: true, book: bookToSave, warning }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logService.error('Parser', `导入失败: ${errMsg}`, errMsg)
      return { success: false, error: `解析失败：${errMsg}` }
    } finally {
      setActiveCleanRules(null)
    }
  })

  // === Save all books（分片：进度小文件 + 按需写单书） ===
  ipcMain.handle('file:saveProgress', async (_event, data: unknown) => {
    try {
      if (!Array.isArray(data)) {
        return { success: false, error: '书架数据无效' }
      }
      // 致命保护：禁止用空数组覆盖已有非空书架
      if (data.length === 0 && libraryStorage.hasNonEmptyLibrary()) {
        logService.error('Storage', '拒绝用空数组覆盖非空书架（分片库保护）')
        return { success: false, error: '拒绝清空书架：空数组覆盖保护' }
      }
      // 轻量结构校验：确保每本书至少有 id 和 sentences（渲染层已规范化过）
      const validBooks = data.filter(
        (b: unknown): b is BookData =>
          typeof b === 'object' && b !== null && typeof (b as BookData).id === 'string' && Array.isArray((b as BookData).sentences)
      )
      if (validBooks.length !== data.length) {
        logService.warn('Storage', `书架数据包含 ${data.length - validBooks.length} 本无效文章，已过滤`)
      }
      // 跳过 normalizeBookCollection：渲染层 persistBooks 传入的数据已规范化
      const result = libraryStorage.saveLibrary(validBooks, true)
      logService.info(
        'Storage',
        `书架已保存：${validBooks.length} 本（重写 ${result.writtenBooks}，跳过 ${result.skippedBooks}）`
      )
      return { success: true }
    } catch (error) {
      logService.error('Storage', `保存进度失败: ${String(error)}`)
      return { success: false, error: '保存书架数据失败' }
    }
  })

  // === 仅保存进度（轻量：只收 progress 字段，合并写入 progress.json，不碰单书全文） ===
  ipcMain.handle('file:saveProgressOnly', async (_event, data: unknown) => {
    try {
      if (!Array.isArray(data)) {
        return { success: false, error: '进度数据无效' }
      }
      const records = data
        .filter(
          (item): item is {
            id: string
            currentSentenceIndex?: number
            currentChapterIndex?: number
            progressPercent?: number
            lastReadAt?: string
            isCompleted?: boolean
            timeMap?: number[]
          } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { id?: unknown }).id === 'string' &&
            (item as { id: string }).id.trim().length > 0
        )
        .map((item) => ({
          id: item.id.trim(),
          currentSentenceIndex: item.currentSentenceIndex,
          currentChapterIndex: item.currentChapterIndex,
          progressPercent: item.progressPercent,
          lastReadAt: item.lastReadAt,
          isCompleted: item.isCompleted,
          timeMap: Array.isArray(item.timeMap) ? item.timeMap : undefined
        }))
      if (records.length === 0) {
        return { success: false, error: '进度数据无效' }
      }
      libraryStorage.mergeBooksProgress(records)
      return { success: true }
    } catch (error) {
      logService.error('Storage', `保存进度失败: ${String(error)}`)
      return { success: false, error: '保存进度失败' }
    }
  })

  // === Load all books（自动从 books.json 迁移到 library/） ===
  ipcMain.handle('file:loadProgress', async () => {
    try {
      const books = libraryStorage.loadAll()
      logService.info('Storage', `已加载书架 ${books.length} 本（layout=${libraryStorage.hasLibraryLayout() ? 'library' : 'legacy'}）`)
      return books
    } catch (error) {
      logService.error('Storage', `加载书架失败: ${String(error)}`)
      return []
    }
  })

  // === 轻量书架：只读 index+progress，不碰单书文件（启动加速） ===
  ipcMain.handle('file:loadShelf', async () => {
    try {
      const shelf = libraryStorage.loadShelf()
      logService.info('Storage', `已加载书架元数据 ${shelf.length} 本（轻量模式）`)
      return shelf
    } catch (error) {
      logService.error('Storage', `加载书架元数据失败: ${String(error)}`)
      return []
    }
  })

  // === 按需加载单本书完整数据 ===
  ipcMain.handle('file:loadBookData', async (_event, bookId: string) => {
    if (!isBookId(bookId)) return null
    try {
      const book = libraryStorage.loadSingleBook(bookId)
      if (!book) {
        logService.error('Storage', `加载书籍失败: ${bookId}`)
        return null
      }
      logService.info('Storage', `已加载书籍: ${book.title}`)
      return book
    } catch (error) {
      logService.error('Storage', `加载书籍失败 ${bookId}: ${String(error)}`)
      return null
    }
  })

  // === Save and load custom albums ===
  ipcMain.handle('album:save', async (_event, data: unknown) => {
    try {
      const albums = validateAlbums(data)
      await saveJsonFile('albums.json', albums)
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
      if (!isSettingsPartial(settings)) {
        return { success: false, error: '设置数据格式无效' }
      }
      const partial = settings
      await settingsService.save(partial)
      // 数据目录变更时立即生效（无需等重启再读 books 路径）
      if (typeof partial.dataDir === 'string') {
        setCustomDataDir(partial.dataDir || null)
        logService.reloadFromDisk()
      }
      return { success: true }
    } catch (error) {
      logService.error('Storage', `保存设置失败: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  })

  // === Load settings ===
  ipcMain.handle('file:loadSettings', async () => {
    return settingsService.get()
  })

  // === 设置导出/导入（换机迁移；不含数据目录切换） ===
  ipcMain.handle('settings:export', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: '无活动窗口' }
      const bundle = settingsService.exportBundle()
      const result = await dialog.showSaveDialog(win, {
        title: '导出设置',
        defaultPath: `ting-ear-settings-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: '已取消' }
      atomicWriteFile(result.filePath, JSON.stringify(bundle, null, 2))
      logService.info('Storage', `设置已导出: ${result.filePath}`)
      return { success: true, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('settings:import', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: '无活动窗口' }
      const open = await dialog.showOpenDialog(win, {
        title: '导入设置',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (open.canceled || !open.filePaths[0]) return { success: false, error: '已取消' }
      const raw = JSON.parse(readFileSync(open.filePaths[0], 'utf-8'))
      const result = await settingsService.importBundle(raw)
      if (result.success) {
        logService.info('Storage', `设置已导入: ${open.filePaths[0]}`)
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // === Delete a book ===
  ipcMain.handle('file:deleteBook', async (_event, bookId: string) => {
    if (!isBookId(bookId)) {
      return { success: false, error: '书籍 ID 无效' }
    }
    try {
      libraryStorage.deleteBook(bookId)
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
          await saveJsonFile(
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
        await saveJsonFile('bookmarks.json', filteredBookmarks)
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
    setActiveCleanRules(settingsService.getCleanRules())
    try {
      const book = libraryStorage.loadSingleBook(bookId)
      if (!book) return { success: false, error: '书籍不存在' }

      const oldSentenceCount = book.sentences.length
      // Join all sentences, preprocess, re-split
      const joined = book.sentences.join('\n')
      const { text, stats } = preprocessText(joined, settingsService.getCleanRules())
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
      libraryStorage.saveSingleBook(updatedBook)

      logService.info(
        'Parser',
        `重新预处理：《${book.title}》(${oldSentenceCount}句 → ${newSentences.length}句，${stats.spacesRemoved}空格已消除)`
      )
      return { success: true, book: updatedBook, stats }
    } catch (error) {
      return { success: false, error: String(error) }
    } finally {
      setActiveCleanRules(null)
    }
  })

  // === Reparse / 迁移分章（默认 original）===
  // 优先从原文件重解析拿书签边界；否则用存库 sourceBoundaries / 旧章节反推。
  const reparseOneBook = async (
    bookId: string,
    mode: ChapterMode = 'original'
  ): Promise<{ success: boolean; book?: BookData; error?: string }> => {
    setActiveCleanRules(settingsService.getCleanRules())
    try {
      const book = libraryStorage.loadSingleBook(bookId)
      if (!book) return { success: false, error: '书籍不存在' }

      let sentences: string[]
      let sourceBoundaries: Boundary[]
      let chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
      let finalStructure = book.structure
      let finalStructureMeta = book.structureMeta
      let parsedTitle: string | undefined
      let parsedAuthor: string | undefined

      const ext = book.filePath?.split('.').pop()?.toLowerCase()
      const canReparseFromFile =
        !!book.filePath && !!ext && SUPPORTED_EXTENSIONS.includes(ext) && existsSync(book.filePath)

      if (canReparseFromFile) {
        const parsed = await parseBookFile(book.filePath!, ext!)
        sentences = normalizeSentences(parsed.sentences)
        sourceBoundaries = parsed.sourceBoundaries || chaptersToBoundaries(parsed.chapters)
        chapters = normalizeChapters(
          buildChaptersByMode(sentences.length, sourceBoundaries, mode),
          sentences.length
        )
        parsedTitle = parsed.title
        parsedAuthor = parsed.author
        if (parsed.structure && mode === 'original') {
          finalStructure = parsed.structure
          finalStructureMeta = parsed.structureMeta
        } else {
          const pseudo = generatePseudoStructure(sentences, chapters)
          finalStructure = pseudo.structure
          finalStructureMeta = pseudo.structureMeta
        }
      } else {
        sentences = book.sentences
        sourceBoundaries = resolveSourceBoundaries(book)
        chapters = normalizeChapters(
          buildChaptersByMode(sentences.length, sourceBoundaries, mode),
          sentences.length
        )
        parsedTitle = book.originalTitle || book.title
        parsedAuthor = book.author
        const pseudo = generatePseudoStructure(sentences, chapters)
        finalStructure = pseudo.structure
        finalStructureMeta = pseudo.structureMeta
      }

      if (sentences.length === 0) {
        return { success: false, error: '无法提取文本内容，已保留原书数据' }
      }

      const contentChanged = hashSentences(book.sentences) !== hashSentences(sentences)
      const newSentenceIndex = Math.min(book.currentSentenceIndex ?? 0, Math.max(0, sentences.length - 1))
      let newChapterIndex = 0
      for (let i = 0; i < chapters.length; i++) {
        if (chapters[i].startIndex <= newSentenceIndex) newChapterIndex = i
        else break
      }

      const updatedBook = normalizeBookData({
        ...book,
        originalTitle: parsedTitle,
        author: parsedAuthor || book.author,
        sentences,
        chapters,
        sourceBoundaries,
        chapterMode: mode,
        structure: finalStructure,
        structureMeta: finalStructureMeta,
        currentSentenceIndex: newSentenceIndex,
        currentChapterIndex: newChapterIndex,
        originalSentences: contentChanged ? sentences : (book.originalSentences ?? sentences),
        editHistory: contentChanged ? undefined : book.editHistory,
        timeMap: contentChanged ? undefined : book.timeMap
      })
      if (!updatedBook) {
        return { success: false, error: '解析结果无效，已保留原书数据' }
      }

      // reparse 关口：与导入/打开同一把治愈尺子（切开超长 + 巨 structure 骨架化）
      const bookToSave = healBookLayoutForReading(updatedBook).book

      const sourceLabel = canReparseFromFile ? '原文件' : '存库边界'
      libraryStorage.saveSingleBook(bookToSave)
      logService.info(
        'Parser',
        `迁移分章：《${book.title}》(${book.chapters.length}章 → ${bookToSave.chapters.length}章, ${mode}, ${sourceLabel})`
      )
      return { success: true, book: bookToSave }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : ''
      console.error(`[book:reparse] ${msg}`, stack)
      logService.error('Parser', `迁移分章失败: ${msg}`)
      return { success: false, error: msg }
    } finally {
      setActiveCleanRules(null)
    }
  }

  ipcMain.handle(
    'book:reparse',
    async (_event, bookId: string, options?: { mode?: ChapterMode; splitOversized?: boolean }) => {
      // 兼容旧参数 splitOversized：忽略，统一走 mode（默认 original）
      const mode: ChapterMode = options?.mode === 'merged' ? 'merged' : 'original'
      return reparseOneBook(bookId, mode)
    }
  )

  // 一键迁移全部旧书 → original 重切入库
  ipcMain.handle('book:migrate-all-chapters', async () => {
    try {
      const books = libraryStorage.loadAll()
      let done = 0
      let failed = 0
      for (const b of books) {
        const result = await reparseOneBook(b.id, 'original')
        if (result.success) done++
        else failed++
      }
      logService.info('Parser', `全书分章迁移完成：成功 ${done}，失败 ${failed}，共 ${books.length}`)
      return { success: true, done, failed, total: books.length }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logService.error('Parser', `全书分章迁移失败: ${msg}`)
      return { success: false, error: msg }
    }
  })

  function getCoversDir(): string {
    const coversDir = join(getDataDir(), 'covers')
    if (!existsSync(coversDir)) {
      mkdirSync(coversDir, { recursive: true })
    }
    return coversDir
  }

  function getBackgroundsDir(): string {
    const dir = join(getDataDir(), 'backgrounds')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  // Save a cover image (base64 data URL or file path) for a book
  ipcMain.handle('cover:save', async (_event, bookId: string, dataUrl: string) => {
    try {
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buf = Buffer.from(base64Data, 'base64')
      const coverPath = join(getCoversDir(), `${bookId}.png`)
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
      const coverPath = join(getCoversDir(), `${bookId}.png`)
      const imgBuf = readFileSync(srcPath)
      writeFileSync(coverPath, imgBuf)
      return { success: true, coverPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Get cover path for a book
  ipcMain.handle('cover:get', async (_event, bookId: string) => {
    const coverPath = join(getCoversDir(), `${bookId}.png`)
    if (existsSync(coverPath)) {
      return coverPath
    }
    return null
  })

  // Get cover as data URL (for renderer display, bypasses file:// restriction)
  ipcMain.handle('cover:getDataUrl', async (_event, bookId: string) => {
    try {
      const coverPath = join(getCoversDir(), `${bookId}.png`)
      if (!existsSync(coverPath)) return null
      const buf = readFileSync(coverPath)
      const base64 = buf.toString('base64')
      return `data:image/png;base64,${base64}`
    } catch {
      return null
    }
  })

  // === 背景图 ===
  ipcMain.handle('background:list', async () => {
    return PRESET_BACKGROUNDS.map((p) => ({ id: p.id, name: p.name }))
  })

  ipcMain.handle('background:add', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: '无活动窗口' }
      const result = await dialog.showOpenDialog(win, {
        title: '选择背景图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '取消选择' }
      }
      const srcPath = result.filePaths[0]
      const ext = srcPath.toLowerCase().split('.').pop() || 'jpg'
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const dest = join(getBackgroundsDir(), name)
      copyFileSync(srcPath, dest)
      return { success: true, customPath: `backgrounds/${name}` }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('background:resolve', async (_event, source: 'preset' | 'custom', key: string | null) => {
    return resolveBackgroundDataUrl(source, key)
  })

  ipcMain.handle('background:remove', async (_event, customPath: string) => {
    try {
      const abs = join(getDataDir(), customPath)
      if (existsSync(abs)) unlinkSync(abs)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // === 导出音频：用当前活动引擎（或传入 engineId）逐句合成并拼接 ===
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
        engineId?: string
      }
    ) => {
      const { sentences, voiceId, speed, startIndex, endIndex, defaultName } = params
      // 与播放一致：优先显式 engineId，否则用活动引擎
      const engineId = params.engineId || engineManager.getActiveEngineId() || 'edge'
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

      logService.info('Export', `开始导出音频: ${defaultName} (${total} 句, 引擎=${engineId})`)

      try {
        for (let i = startIndex; i < endIndex; i++) {
          const text = sentences[i]
          if (!text || !text.trim()) {
            completed++
            event.sender.send('export:progress', { current: completed, total })
            continue
          }

          const result = await engineManager.synthesize(text, voiceId, speed, 1.0, engineId)
          if (result.success && result.audio) {
            chunks.push(Buffer.from(result.audio, 'base64'))
          } else {
            logService.warn('Export', `第 ${i} 句合成失败: ${result.error || '未知'}`)
          }

          completed++
          event.sender.send('export:progress', { current: completed, total })
        }

        if (chunks.length === 0) {
          return { success: false, error: `所有句子合成均失败，请检查引擎「${engineId}」是否可用` }
        }

        // Buffer.concat — 同格式音频可直接拼接（Edge/多数 HTTP 为 CBR MP3）
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

  // === 数据目录管理 ===

  // 获取当前数据目录的真实路径
  ipcMain.handle('dataDir:get', async () => {
    return getDataDir()
  })

  // 获取默认数据目录路径
  ipcMain.handle('dataDir:getDefault', async () => {
    return getDefaultDataDir()
  })

  // 在系统文件管理器中打开文件夹
  ipcMain.handle('dataDir:open', async (_event, dirPath?: string) => {
    const target = dirPath || getDataDir()
    if (!existsSync(target)) {
      return { success: false, error: '文件夹不存在' }
    }
    try {
      await shell.openPath(target)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 选择文件夹对话框
  ipcMain.handle('dataDir:select', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { success: false, error: '无活动窗口' }
    const result = await dialog.showOpenDialog(win, {
      title: '选择数据存储位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '取消选择' }
    }
    return { success: true, path: result.filePaths[0] }
  })

  // 验证路径有效性
  ipcMain.handle('dataDir:validate', async (_event, dirPath: string) => {
    try {
      const resolved = resolve(dirPath)
      // 检查路径是否存在
      if (!existsSync(resolved)) {
        return { valid: false, error: '路径不存在', path: resolved }
      }
      const stat = statSync(resolved)
      // 检查是否是目录
      if (!stat.isDirectory()) {
        return { valid: false, error: '路径不是文件夹', path: resolved }
      }
      // 检查读写权限：尝试创建临时文件并删除
      const testFile = join(resolved, `.tingear_write_test_${Date.now()}.tmp`)
      try {
        writeFileSync(testFile, 'test', 'utf-8')
        unlinkSync(testFile)
      } catch {
        return { valid: false, error: '文件夹不可读写', path: resolved }
      }
      return { valid: true, path: resolved }
    } catch (error) {
      return { valid: false, error: String(error), path: dirPath }
    }
  })

  // 迁移数据到新目录
  ipcMain.handle('dataDir:migrate', async (_event, newDir: string) => {
    try {
      const resolved = resolve(newDir)
      if (!existsSync(resolved)) {
        mkdirSync(resolved, { recursive: true })
      }
      const oldDir = getDataDir()
      if (oldDir === resolved) {
        return { success: true, migrated: false, message: '新旧路径相同，无需迁移' }
      }
      // 递归复制所有文件
      const items = readdirSync(oldDir)
      for (const item of items) {
        const srcPath = join(oldDir, item)
        const destPath = join(resolved, item)
        const stat = statSync(srcPath)
        if (stat.isDirectory()) {
          // 递归复制目录
          copyDirRecursive(srcPath, destPath)
        } else {
          copyFileSync(srcPath, destPath)
        }
      }
      logService.info('Storage', `数据迁移完成: ${oldDir} → ${resolved}`)
      return { success: true, migrated: true, oldPath: oldDir, newPath: resolved }
    } catch (error) {
      logService.error('Storage', `数据迁移失败: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  })

  // === 清除缓存 ===
  ipcMain.handle('data:clearCache', async (_event, type: string) => {
    try {
      const dir = getDataDir()
      /** 清空 JSON 文件（写空内容，避免 Windows 文件锁导致 unlink 失败） */
      const emptyJson = (filename: string, content = '[]'): void => {
        const p = join(dir, filename)
        if (existsSync(p)) writeFileSync(p, content, 'utf-8')
      }
      /** 删除目录下匹配前缀的缓存文件夹（含 cache_<engineId>） */
      const removeAudioCaches = (): void => {
        for (const name of ['edge_cache', 'qwen_cache']) {
          const p = join(dir, name)
          if (existsSync(p)) rmSync(p, { recursive: true, force: true })
        }
        try {
          for (const item of readdirSync(dir)) {
            if (item.startsWith('cache_')) {
              const p = join(dir, item)
              if (statSync(p).isDirectory()) rmSync(p, { recursive: true, force: true })
            }
          }
        } catch {
          /* ignore */
        }
      }

      const clearLibrary = () => {
        emptyJson('books.json')
        emptyJson('progress.json')
        if (existsSync(join(dir, 'library'))) {
          rmSync(join(dir, 'library'), { recursive: true, force: true })
        }
        if (existsSync(join(dir, 'covers'))) {
          rmSync(join(dir, 'covers'), { recursive: true, force: true })
        }
      }

      switch (type) {
        case 'books':
          clearLibrary()
          break
        case 'history':
          emptyJson('history.json')
          break
        case 'audio':
          removeAudioCaches()
          break
        case 'logs':
          emptyJson('logs.json')
          break
        case 'bookmarks':
          emptyJson('bookmarks.json')
          break
        case 'all':
          for (const f of [
            'books.json',
            'progress.json',
            'history.json',
            'logs.json',
            'bookmarks.json',
            'albums.json',
            'ai-history.json'
          ]) {
            emptyJson(f)
          }
          for (const d of ['covers', 'cache', 'outlines', 'library']) {
            if (existsSync(join(dir, d))) rmSync(join(dir, d), { recursive: true, force: true })
          }
          removeAudioCaches()
          break
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
