import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  Upload,
  BookOpen,
  Trash2,
  Sparkles,
  Scissors,
  RefreshCw,
  Image,
  Search,
  LayoutGrid,
  List,
  FileText,
  Star,
  X,
  Download,
  Plus,
  Folder,
  Pencil,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Minus,
  ListChecks
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBookStore } from '../stores/bookStore'
import { useAlbumStore } from '../stores/albumStore'
import { useBookmarkStore } from '../stores/bookmarkStore'
import {
  generateCoverDataUrl,
  computeCoverHash,
  getStoredCoverHash,
  setStoredCoverHash,
  coverProtocolUrl
} from '../utils/coverGenerator'
import { ALBUM_TITLE_MAX_LENGTH } from '../utils/albumUtils'
import { BOOK_TITLE_MAX_LENGTH, normalizeBookTitle } from '../utils/bookData'
import type { AlbumItem, BookData, CustomAlbum } from '../global'
import ContextMenu, { type ContextMenuGroup } from './ui/ContextMenu'

// 与 electron/ipc/fileHandlers.ts 中的 SUPPORTED_EXTENSIONS 保持一致
const SUPPORTED_EXTENSIONS = new Set(['epub', 'txt', 'pdf', 'docx', 'md', 'html', 'htm', 'mobi', 'azw', 'azw3', 'prc'])

interface BookShelfProps {
  onImportFile: (filePath: string) => void
  onOpenBook: (book: BookData) => void
  /** 直接打开章节选择页（跳过缓存，进入预选页章节页） */
  onSelectChapters?: (book: BookData) => void
  onCleanText?: (book: BookData) => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

type SortBy = 'recent' | 'added' | 'title'
type ViewMode = 'grid' | 'list'

import ContinueReadingCard from './bookshelf/ContinueReadingCard'
import BatchActionBar from './bookshelf/BatchActionBar'
import BookGridCard from './bookshelf/BookGridCard'
import BookListRow from './bookshelf/BookListRow'
import {
  SHELF_SCALE_MIN,
  SHELF_SCALE_MAX,
  SHELF_SCALE_DEFAULT,
  SHELF_SCALE_KEY,
  shelfGridClassName
} from './bookshelf/shelfScale'
import {
  VIRTUALIZE_THRESHOLD,
  VirtualBookGrid,
  VirtualBookList
} from './bookshelf/VirtualBookShelf'

type AlbumEditor =
  { mode: 'create'; parentId: string | null } | { mode: 'rename'; album: CustomAlbum }

export default function BookShelf({
  onImportFile,
  onOpenBook,
  onSelectChapters,
  onCleanText,
  showToast
}: BookShelfProps) {
  const { books, isLoading, loadingMessage } = useBookStore(
    useShallow((s) => ({ books: s.books, isLoading: s.isLoading, loadingMessage: s.loadingMessage }))
  )
  // Actions are stable refs — read via getState(), no subscription needed
  const removeBook = useBookStore.getState().removeBook
  const renameBook = useBookStore.getState().renameBook
  const loadBooks = useBookStore.getState().loadBooks
  const {
    albums,
    activeAlbumId,
    setActiveAlbumId,
    loadAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addItem,
    removeItem,
    moveItem
  } = useAlbumStore()
  const { loadBookmarks } = useBookmarkStore()
  const [isDragOver, setIsDragOver] = useState(false)
  const [isFileDrag, setIsFileDrag] = useState(false)
  const dragCounter = useRef(0)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<SortBy | 'custom'>('recent')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [shelfScale, setShelfScale] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SHELF_SCALE_KEY)
      const n = raw ? parseInt(raw, 10) : SHELF_SCALE_DEFAULT
      return Number.isNaN(n) ? SHELF_SCALE_DEFAULT : Math.max(SHELF_SCALE_MIN, Math.min(SHELF_SCALE_MAX, n))
    } catch { return SHELF_SCALE_DEFAULT }
  })

  useEffect(() => {
    localStorage.setItem(SHELF_SCALE_KEY, String(shelfScale))
  }, [shelfScale])
  const [contextMenu, setContextMenu] = useState<{
    book: BookData
    x: number
    y: number
    triggerElement: HTMLElement | null
  } | null>(null)
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const [isAddContentOpen, setIsAddContentOpen] = useState(false)
  const [albumEditor, setAlbumEditor] = useState<AlbumEditor | null>(null)
  const [albumTitleDraft, setAlbumTitleDraft] = useState('')
  const [bookTitleEditor, setBookTitleEditor] = useState<BookData | null>(null)
  const [bookTitleDraft, setBookTitleDraft] = useState('')

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reparseProgress, setReparseProgress] = useState<{ done: number; total: number } | null>(null)
  const [reprocessProgress, setReprocessProgress] = useState<{ done: number; total: number } | null>(null)
  // Favorites (persisted in localStorage)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('ting-ear-favorites')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    localStorage.setItem('ting-ear-favorites', JSON.stringify([...favorites]))
  }, [favorites])

  /**
   * 封面加载（启动加速）：
   * 1) 默认用 ting-cover 协议直读磁盘 PNG（零 base64 IPC）
   * 2) 仅对「标题/作者变了」或「协议 404」的书才生成
   * 3) 依赖 coverKey 而非整个 books，进度刷新不会重跑
   */
  const coverKey = useMemo(
    () =>
      books
        .map((b) => `${b.id}\t${b.title}\t${b.author}\t${b.coverPath || ''}\t${b.coverSource || ''}`)
        .join('\n'),
    [books]
  )

  // 协议 URL 立即可用；生成结果覆盖到 coverUrls
  const resolveCoverSrc = useCallback(
    (book: BookData): string => {
      return coverUrls[book.id] || coverProtocolUrl(book.id)
    },
    [coverUrls]
  )

  // 缺失封面：懒生成（img onError 或空闲批处理）
  const missingCoverIdsRef = useRef<Set<string>>(new Set())
  const ensureCover = useCallback(async (book: BookData) => {
    if (missingCoverIdsRef.current.has(book.id)) return
    // custom 且已有 path：协议应能加载，失败再生成
    const currentHash = computeCoverHash(book.title, book.author)
    const storedHash = getStoredCoverHash(book.id)
    // 哈希一致且非强制缺失时不重生成（协议 404 仍会走这里）
    if (storedHash === currentHash && book.coverPath) {
      // 已有匹配哈希，但协议失败 → 仍尝试读一次 dataUrl 兜底
      try {
        const dataUrl = await window.api?.getCoverDataUrl(book.id)
        if (dataUrl) {
          setCoverUrls((prev) => (prev[book.id] === dataUrl ? prev : { ...prev, [book.id]: dataUrl }))
          return
        }
      } catch {
        /* fall through */
      }
    }
    missingCoverIdsRef.current.add(book.id)
    try {
      const dataUrl = generateCoverDataUrl(book.title, book.author)
      await window.api?.saveCover(book.id, dataUrl)
      setStoredCoverHash(book.id, currentHash)
      setCoverUrls((prev) => ({ ...prev, [book.id]: dataUrl }))
    } catch {
      missingCoverIdsRef.current.delete(book.id)
    }
  }, [])

  // 空闲时检查「标题变了」的 auto 封面，批量重生（不阻塞首屏）
  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      const needRegen = books.filter((book) => {
        if (book.coverSource === 'custom') return false
        const currentHash = computeCoverHash(book.title, book.author)
        const stored = getStoredCoverHash(book.id)
        // 无历史哈希：沿用磁盘协议图，只记哈希
        if (stored === null) {
          setStoredCoverHash(book.id, currentHash)
          return false
        }
        return stored !== currentHash
      })
      if (needRegen.length === 0) return
      // 串行少量并发，避免启动抢 CPU
      void (async () => {
        for (const book of needRegen) {
          if (cancelled) return
          await ensureCover(book)
          await new Promise((r) => setTimeout(r, 0))
        }
      })()
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback
    const id = ric ? ric(run, { timeout: 2500 }) : window.setTimeout(run, 400)
    return () => {
      cancelled = true
      if (ric && typeof id === 'number') {
        const cancel = (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback
        cancel?.(id)
      } else {
        clearTimeout(id as number)
      }
    }
  }, [coverKey, books, ensureCover])

  useEffect(() => {
    loadAlbums()
  }, [loadAlbums])

  useEffect(() => {
    loadBookmarks()
  }, [loadBookmarks])

  const activeAlbum = albums.find((album) => album.id === activeAlbumId) || null
  const childAlbums = albums.filter((album) => album.parentId === activeAlbumId)
  const topLevelAlbums = albums.filter((album) => album.parentId === null)
  const albumPath = useMemo(() => {
    const path: CustomAlbum[] = []
    let current = activeAlbum
    while (current) {
      path.unshift(current)
      current = current.parentId
        ? albums.find((album) => album.id === current?.parentId) || null
        : null
    }
    return path
  }, [activeAlbum, albums])

  const albumBookIds = activeAlbum
    ? new Set(
        activeAlbum.items
          .filter((item) => item.resourceType === 'book')
          .map((item) => item.resourceId)
      )
    : null
  const albumBookItems = activeAlbum
    ? activeAlbum.items.filter((item) => item.resourceType === 'book')
    : []

  // Filtered and sorted books
  const displayBooks = useMemo(() => {
    let filtered = albumBookIds ? books.filter((book) => albumBookIds.has(book.id)) : books
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      filtered = filtered.filter(
        (b) => b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw)
      )
    }
    const sorted = [...filtered]
    if (sortBy === 'custom' && activeAlbum) {
      const order = new Map(albumBookItems.map((item, index) => [item.resourceId, index]))
      sorted.sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      )
    } else if (sortBy === 'recent') {
      sorted.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime())
    } else if (sortBy === 'added') {
      sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    }
    return sorted
  }, [books, searchKeyword, sortBy, albumBookIds, activeAlbum, albumBookItems])

  // 继续阅读：最近阅读的未完成书籍
  const lastReadBook = useMemo(() => {
    return books
      .filter((b) => !b.isCompleted && b.progressPercent > 0 && b.lastReadAt)
      .sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime())[0] ?? null
  }, [books])

  // ---- Selection helpers ----
  const selectedCount = selectedIds.size
  const allSelected = displayBooks.length > 0 && displayBooks.every((b) => selectedIds.has(b.id))

  const toggleSelect = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayBooks.map((b) => b.id)))
  }, [displayBooks])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const toggleFavorite = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ---- Batch operations ----
  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!confirm(`确定要删除选中的 ${ids.length} 本书吗？进度和书签将一并清除。`)) return

    let deleted = 0
    for (const id of ids) {
      try {
        await window.api?.deleteBook(id)
        removeBook(id)
        deleted++
      } catch {
        // skip failures
      }
    }
    setSelectedIds(new Set())
    if (deleted > 0) showToast('success', `已删除 ${deleted} 本书`)
  }, [selectedIds, removeBook, showToast])

  const handleBatchReprocess = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setReprocessProgress({ done: 0, total: ids.length })
    let done = 0
    for (const id of ids) {
      try {
        const result = await window.api?.reprocessBook(id)
        if (result?.success) done++
      } catch {
        // skip
      }
      setReprocessProgress({ done: done + 1, total: ids.length })
      await new Promise(r => setTimeout(r, 0))
    }
    setReprocessProgress(null)
    setSelectedIds(new Set())
    await loadBooks()
    showToast('success', `已清理 ${done}/${ids.length} 本书`)
  }, [selectedIds, loadBooks, showToast])

  /** 批量迁移：选中书按 original 重切（旧书一键升级） */
  const handleBatchReparse = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setReparseProgress({ done: 0, total: ids.length })
    let done = 0
    let failed = 0
    for (const id of ids) {
      try {
        const result = await window.api?.reparseBook(id, { mode: 'original' })
        if (result?.success) done++
        else failed++
      } catch {
        failed++
      }
      setReparseProgress({ done: done + failed, total: ids.length })
      await new Promise((r) => setTimeout(r, 0))
    }
    setReparseProgress(null)
    setSelectedIds(new Set())
    await loadBooks()
    if (failed > 0) showToast('warning', `已迁移分章 ${done}/${ids.length} 本，${failed} 本失败`)
    else showToast('success', `已按「原始」规则迁移 ${done} 本书的章节`)
  }, [selectedIds, loadBooks, showToast])

  /** 一键迁移书架全部旧书 */
  const handleMigrateAllChapters = useCallback(async () => {
    try {
      showToast('info', '正在按新规则迁移全部分章…')
      setReparseProgress({ done: 0, total: 1 })
      const result = await window.api?.migrateAllChapters()
      setReparseProgress(null)
      await loadBooks()
      if (result?.success) {
        showToast(
          'success',
          `分章迁移完成：成功 ${result.done ?? 0}/${result.total ?? 0}` +
            (result.failed ? `，失败 ${result.failed}` : '')
        )
      } else {
        showToast('error', result?.error || '迁移失败')
      }
    } catch (error) {
      setReparseProgress(null)
      showToast('error', `迁移失败: ${String(error)}`)
    }
  }, [loadBooks, showToast])

  const handleBatchExportBookmarks = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    let done = 0
    for (const id of ids) {
      try {
        const result = await window.api?.exportBookmarks(id)
        if (result?.success) done++
      } catch {
        // skip
      }
    }
    setSelectedIds(new Set())
    if (done > 0) showToast('success', `已导出 ${done} 本书的书签`)
    else showToast('warning', '所选书籍无书签可导出')
  }, [selectedIds, showToast])

  // ---- Single-book audio export ----
  const handleExportAudio = useCallback(
    async (book: BookData) => {
      setContextMenu(null)
      // stub（轻量书架）：按需加载完整数据
      let fullBook: BookData | null = book.sentences.length > 0 || (book.sentenceCount ?? 0) === 0 ? book : null
      if (!fullBook) {
        fullBook = await useBookStore.getState().loadFullBook(book.id)
      }
      if (!fullBook || !fullBook.sentences || fullBook.sentences.length === 0) {
        showToast('warning', '该书无文本内容')
        return
      }
      showToast('info', `开始导出《${book.title}》音频...`)

      const settings = (await window.api?.loadSettings()) as { voiceId?: string; ttsEngine?: string } | null
      const result = await window.api?.exportAudio({
        sentences: fullBook.sentences,
        voiceId: settings?.voiceId || 'zh-CN-XiaoxiaoNeural',
        speed: 1.0,
        startIndex: 0,
        endIndex: fullBook.sentences.length,
        defaultName: fullBook.title,
        engineId: settings?.ttsEngine && settings.ttsEngine !== 'system' ? settings.ttsEngine : 'edge'
      })

      if (result?.success) {
        showToast('success', `《${fullBook.title}》音频导出完成`)
      } else if (result?.error !== '取消导出') {
        showToast('error', result?.error || '导出失败')
      }
    },
    [showToast]
  )

  // ---- Batch audio export ----
  const handleBatchExportAudio = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    // 用 sentenceCount 判断（兼容 stub），先选候选
    const candidates = books.filter(
      (b) => ids.includes(b.id) && (b.sentenceCount || b.sentences.length) > 0
    )
    if (candidates.length === 0) {
      showToast('warning', '所选书籍无文本内容')
      return
    }
    let done = 0
    for (const book of candidates) {
      // stub: 按需加载完整数据
      let fullBook = book.sentences.length > 0 ? book : null
      if (!fullBook) {
        fullBook = await useBookStore.getState().loadFullBook(book.id)
      }
      if (!fullBook || !fullBook.sentences || fullBook.sentences.length === 0) continue
      showToast('info', `正在导出《${fullBook.title}》(${done + 1}/${candidates.length})...`)
      const settings = (await window.api?.loadSettings()) as { voiceId?: string; ttsEngine?: string } | null
      const result = await window.api?.exportAudio({
        sentences: fullBook.sentences,
        voiceId: settings?.voiceId || 'zh-CN-XiaoxiaoNeural',
        speed: 1.0,
        startIndex: 0,
        endIndex: fullBook.sentences.length,
        defaultName: fullBook.title,
        engineId: settings?.ttsEngine && settings.ttsEngine !== 'system' ? settings.ttsEngine : 'edge'
      })
      if (result?.success) done++
    }
    setSelectedIds(new Set())
    if (done > 0) showToast('success', `已导出 ${done}/${candidates.length} 本书的音频`)
    else showToast('warning', '所有导出均被取消或失败')
  }, [selectedIds, books, showToast])

  // ---- Single-book operations ----
  const handleSelectFile = useCallback(async () => {
    const filePaths = await window.api?.selectFile()
    if (filePaths && filePaths.length > 0) {
      for (const fp of filePaths) {
        onImportFile(fp)
      }
    }
  }, [onImportFile])

  const handleCreateAlbum = useCallback(() => {
    setAlbumTitleDraft('')
    setAlbumEditor({ mode: 'create', parentId: activeAlbumId })
  }, [activeAlbumId])

  const handleRenameAlbum = useCallback((album: CustomAlbum) => {
    setAlbumTitleDraft(album.title)
    setAlbumEditor({ mode: 'rename', album })
  }, [])

  const handleSubmitAlbum = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!albumEditor) return

      if (albumEditor.mode === 'create') {
        const album = await createAlbum(albumTitleDraft, albumEditor.parentId)
        if (!album) {
          showToast('warning', `标题不能为空且不能超过 ${ALBUM_TITLE_MAX_LENGTH} 个字符`)
          return
        }
        showToast('success', `已创建专辑“${album.title}”`)
      } else {
        if (!(await renameAlbum(albumEditor.album.id, albumTitleDraft))) {
          showToast('warning', `标题不能为空且不能超过 ${ALBUM_TITLE_MAX_LENGTH} 个字符`)
          return
        }
        showToast('success', '专辑标题已更新')
      }
      setAlbumEditor(null)
    },
    [albumEditor, albumTitleDraft, createAlbum, renameAlbum, showToast]
  )

  const handleDeleteAlbum = useCallback(
    async (album: CustomAlbum) => {
      if (!confirm(`确定删除专辑“${album.title}”吗？其中的子专辑也会被删除，书籍不会受影响。`))
        return
      if (await deleteAlbum(album.id)) {
        showToast('success', '专辑已删除')
      } else {
        showToast('error', '删除专辑失败')
      }
    },
    [deleteAlbum, showToast]
  )

  const handleToggleAlbumBook = useCallback(
    async (bookId: string) => {
      if (!activeAlbum) return
      const item: AlbumItem = { resourceType: 'book', resourceId: bookId }
      const exists = activeAlbum.items.some(
        (entry) => entry.resourceType === 'book' && entry.resourceId === bookId
      )
      await (exists ? removeItem(activeAlbum.id, item) : addItem(activeAlbum.id, item))
    },
    [activeAlbum, addItem, removeItem]
  )

  const handleRemoveFromAlbum = useCallback(
    async (book: BookData) => {
      if (!activeAlbum) return
      await removeItem(activeAlbum.id, { resourceType: 'book', resourceId: book.id })
      showToast('success', `已将《${book.title}》移出当前专辑`)
    },
    [activeAlbum, removeItem, showToast]
  )

  const openAlbum = useCallback(
    (id: string | null) => {
      setActiveAlbumId(id)
      setSelectedIds(new Set())
      if (id) setSortBy('custom')
      else setSortBy('recent')
    },
    [setActiveAlbumId]
  )

  const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types || []).includes('Files')

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!hasFiles(e.dataTransfer)) return
    dragCounter.current += 1
    setIsFileDrag(true)
    setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (hasFiles(e.dataTransfer)) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) {
      setIsDragOver(false)
      setIsFileDrag(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragOver(false)
      setIsFileDrag(false)

      const dt = e.dataTransfer
      if (!dt) return
      const items = Array.from(dt.files)
      if (items.length === 0) return

      const supported: string[] = []
      const unsupported: string[] = []
      for (const f of items) {
        const path = (f as unknown as { path?: string }).path
        if (!path) continue
        const ext = path.split('.').pop()?.toLowerCase()
        if (ext && SUPPORTED_EXTENSIONS.has(ext)) supported.push(path)
        else unsupported.push(path.split(/[\\/]/).pop() || path)
      }

      // 逐个导入（importFile 内部会弹加载层并处理失败）
      for (const p of supported) {
        await onImportFile(p)
      }

      if (unsupported.length > 0) {
        showToast(
          'warning',
          `已跳过 ${unsupported.length} 个不支持的文件（仅支持 EPUB / TXT / PDF / DOCX / MD / HTML / MOBI）`
        )
      } else if (supported.length > 1) {
        showToast('info', `正在导入 ${supported.length} 个文件…`)
      }
    },
    [onImportFile, showToast]
  )

  const handleContextMenu = (e: React.MouseEvent<HTMLElement>, book: BookData) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      book,
      x: e.clientX,
      y: e.clientY,
      triggerElement: e.currentTarget
    })
  }

  const handleMenuButtonClick = (e: React.MouseEvent<HTMLButtonElement>, book: BookData) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({
      book,
      x: rect.right,
      y: rect.bottom + 4,
      triggerElement: e.currentTarget
    })
  }

  const handleBookCardKeyDown = (e: React.KeyboardEvent<HTMLElement>, book: BookData) => {
    if (!(e.shiftKey && e.key === 'F10')) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({
      book,
      x: rect.left + Math.min(rect.width, 48),
      y: rect.top + Math.min(rect.height, 48),
      triggerElement: e.currentTarget
    })
  }

  const handleUploadCover = async (book: BookData) => {
    try {
      const res = await window.api?.uploadCover(book.id)
      if (res?.success && res.coverPath) {
        const dataUrl = await window.api?.getCoverDataUrl(book.id)
        if (dataUrl) {
          setCoverUrls((prev) => ({ ...prev, [book.id]: dataUrl }))
        }
        // custom 封面也更新哈希，以备切换回 auto 时保持一致
        setStoredCoverHash(book.id, computeCoverHash(book.title, book.author))
        useBookStore.getState().updateBook({ ...book, coverPath: res.coverPath, coverSource: 'custom' })
        showToast('success', '封面已更换')
      }
    } catch (error) {
      showToast('error', `更换封面失败: ${String(error)}`)
    }
  }

  const handleRegenerateCover = async (book: BookData) => {
    setContextMenu(null)
    const dataUrl = generateCoverDataUrl(book.title, book.author)
    const res = await window.api?.saveCover(book.id, dataUrl)
    setCoverUrls((prev) => ({ ...prev, [book.id]: dataUrl }))
    // 同步更新哈希缓存
    setStoredCoverHash(book.id, computeCoverHash(book.title, book.author))
    if (res?.success && res.coverPath) {
      useBookStore.getState().updateBook({ ...book, coverPath: res.coverPath, coverSource: 'auto' })
    }
    showToast('success', '封面已按最新样式重新生成')
  }

  const handleEditBookTitle = (book: BookData) => {
    setContextMenu(null)
    setBookTitleEditor(book)
    setBookTitleDraft(book.title)
  }

  const handleSubmitBookTitle = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!bookTitleEditor) return
    const title = normalizeBookTitle(bookTitleDraft)
    if (!title) {
      showToast('warning', `标题不能为空且不能超过 ${BOOK_TITLE_MAX_LENGTH} 个字符`)
      return
    }
    if (!(await renameBook(bookTitleEditor.id, title))) {
      showToast('error', '标题保存失败，已恢复原标题')
      return
    }
    setBookTitleEditor(null)
    showToast('success', '文章标题已更新')
  }

  const handleDeleteBook = async (book: BookData) => {
    if (confirm(`确定要删除《${book.title}》吗？进度和书签将一并清除。`)) {
      try {
        await window.api?.deleteBook(book.id)
        removeBook(book.id)
        showToast('success', `已删除《${book.title}》`)
      } catch (error) {
        showToast('error', `删除失败: ${String(error)}`)
      }
    }
  }

  const handleExportBookmarks = async (book: BookData) => {
    try {
      const result = await window.api?.exportBookmarks(book.id)
      if (result?.success) {
        showToast('success', '书签已导出')
      } else {
        showToast('warning', result?.error || '无书签可导出')
      }
    } catch (error) {
      showToast('error', `导出失败: ${String(error)}`)
    }
  }

  const handleReprocessBook = async (book: BookData) => {
    try {
      const result = await window.api?.reprocessBook(book.id)
      if (result?.success) {
        showToast(
          'success',
          `已切除多余空格${result.stats?.spacesRemoved ? `（消除 ${result.stats.spacesRemoved} 个）` : ''}`
        )
        await loadBooks()
      } else {
        showToast('error', result?.error || '处理失败')
      }
    } catch (error) {
      showToast('error', `处理失败: ${String(error)}`)
    }
  }

  const bookMenuGroups: ContextMenuGroup[] = contextMenu
    ? [
        {
          id: 'reading',
          items: [
            {
              id: 'open',
              label: '打开阅读',
              icon: <BookOpen className="h-4 w-4" />,
              onSelect: () => onOpenBook(contextMenu.book)
            },
            ...(onSelectChapters
              ? [{
                  id: 'chapters',
                  label: '选择章节',
                  icon: <ListChecks className="h-4 w-4" />,
                  onSelect: () => onSelectChapters(contextMenu.book)
                }]
              : []),
            {
              id: 'favorite',
              label: favorites.has(contextMenu.book.id) ? '取消收藏' : '收藏',
              icon: <Star className={`h-4 w-4 ${favorites.has(contextMenu.book.id) ? 'fill-current text-amber-400' : ''}`} />,
              onSelect: () => toggleFavorite(contextMenu.book.id)
            }
          ]
        },
        {
          id: 'metadata',
          items: [
            {
              id: 'cover-upload',
              label: '更换封面',
              icon: <Image className="h-4 w-4" />,
              onSelect: () => handleUploadCover(contextMenu.book)
            },
            {
              id: 'cover-regenerate',
              label: '重新生成封面',
              icon: <RefreshCw className="h-4 w-4" />,
              onSelect: () => handleRegenerateCover(contextMenu.book)
            },
            {
              id: 'rename',
              label: '编辑文章标题',
              icon: <Pencil className="h-4 w-4" />,
              onSelect: () => handleEditBookTitle(contextMenu.book)
            }
          ]
        },
        {
          id: 'export',
          items: [
            {
              id: 'export-bookmarks',
              label: '导出书签',
              icon: <Upload className="h-4 w-4" />,
              onSelect: () => handleExportBookmarks(contextMenu.book)
            },
            {
              id: 'export-audio',
              label: '导出音频',
              icon: <Download className="h-4 w-4" />,
              onSelect: () => handleExportAudio(contextMenu.book)
            }
          ]
        },
        {
          id: 'album',
          items: activeAlbum
            ? [
                {
                  id: 'album-up',
                  label: '在专辑中上移',
                  icon: <ChevronUp className="h-4 w-4" />,
                  onSelect: async () => {
                    await moveItem(
                      activeAlbum.id,
                      { resourceType: 'book', resourceId: contextMenu.book.id },
                      -1
                    )
                    setSortBy('custom')
                  }
                },
                {
                  id: 'album-down',
                  label: '在专辑中下移',
                  icon: <ChevronDown className="h-4 w-4" />,
                  onSelect: async () => {
                    await moveItem(
                      activeAlbum.id,
                      { resourceType: 'book', resourceId: contextMenu.book.id },
                      1
                    )
                    setSortBy('custom')
                  }
                },
                {
                  id: 'album-remove',
                  label: '移出当前专辑',
                  icon: <X className="h-4 w-4" />,
                  onSelect: () => handleRemoveFromAlbum(contextMenu.book)
                }
              ]
            : []
        },
        {
          id: 'tools',
          items: [
            {
              id: 'reprocess',
              label: '切除空格',
              icon: <Scissors className="h-4 w-4" />,
              onSelect: () => handleReprocessBook(contextMenu.book)
            },
            ...(onCleanText
              ? [{
                  id: 'clean',
                  label: '清洗格式',
                  icon: <Sparkles className="h-4 w-4" />,
                  onSelect: () => onCleanText(contextMenu.book)
                }]
              : [])
          ]
        },
        {
          id: 'danger',
          items: [
            {
              id: 'delete',
              label: '删除书籍',
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onSelect: () => handleDeleteBook(contextMenu.book)
            }
          ]
        }
      ]
    : []

  return (
    <div
      className={`relative flex-1 flex flex-col transition-colors duration-200 overflow-hidden ${
        isDragOver ? 'bg-primary/5 dark:bg-primary/10' : 'bg-surface dark:bg-dark-bg'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop upload overlay */}
      {isDragOver && isFileDrag && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 dark:bg-primary/15 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 px-10 py-12 rounded-3xl border-2 border-dashed border-primary/60 bg-white/80 dark:bg-dark-raised/80 shadow-card">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold text-primary">释放以导入书籍</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              EPUB · TXT · PDF · DOCX · MD · HTML · MOBI
            </p>
          </div>
        </div>
      )}

      {/* Album tabs */}
      <div className="flex items-center gap-1.5 px-4 pt-3.5 overflow-x-auto flex-shrink-0">
        <button
          onClick={() => openAlbum(null)}
          className={`chip whitespace-nowrap ${!activeAlbumId ? 'chip-active' : 'chip-idle'}`}
        >
          全部书籍
        </button>
        {topLevelAlbums.map((album) => {
          const isActive = albumPath.some((entry) => entry.id === album.id)
          return (
            <button
              key={album.id}
              onClick={() => openAlbum(album.id)}
              className={`chip whitespace-nowrap ${isActive ? 'chip-active' : 'chip-idle'}`}
              title={album.title}
            >
              <Folder className="w-3.5 h-3.5 opacity-80" />
              <span className="max-w-32 truncate">{album.title}</span>
            </button>
          )
        })}
        <button
          onClick={handleCreateAlbum}
          className="icon-btn-sm"
          title={activeAlbum ? '新建子专辑' : '新建专辑'}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {activeAlbum && (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
          <button onClick={() => openAlbum(null)} className="hover:text-primary">
            全部书籍
          </button>
          {albumPath.map((album, index) => (
            <span key={album.id} className="inline-flex items-center gap-2">
              <ChevronRight className="w-3 h-3" />
              <button
                onClick={() => openAlbum(album.id)}
                className="hover:text-primary max-w-40 truncate"
                title={album.title}
              >
                {album.title}
              </button>
              {index === albumPath.length - 1 && (
                <>
                  <button
                    onClick={() => handleRenameAlbum(album)}
                    className="p-1 hover:text-primary"
                    title="编辑专辑标题"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteAlbum(album)}
                    className="p-1 hover:text-red-600"
                    title="删除专辑"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Top toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-dark-border flex-shrink-0">
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="搜索书名或作者"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="field-input pl-9 pr-3 py-1.5"
          />
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="text-sm field-input py-1.5 w-auto min-w-[7rem]"
        >
          <option value="recent">最近阅读</option>
          <option value="added">添加时间</option>
          <option value="title">书名</option>
          {activeAlbum && <option value="custom">专辑顺序</option>}
        </select>

        <div className="flex bg-gray-100/90 dark:bg-white/[0.05] rounded-xl p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-dark-raised shadow-soft text-primary'
                : 'text-gray-500'
            }`}
            title="网格视图"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'list'
                ? 'bg-white dark:bg-dark-raised shadow-soft text-primary'
                : 'text-gray-500'
            }`}
            title="列表视图"
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        {/* 书架缩放滑块 — 仅网格视图下显示 */}
        {viewMode === 'grid' && (
          <div className="flex items-center gap-1 bg-gray-100/90 dark:bg-white/[0.05] rounded-xl px-1.5 py-1">
            <button
              onClick={() => setShelfScale((s) => Math.max(SHELF_SCALE_MIN, s - 1))}
              disabled={shelfScale <= SHELF_SCALE_MIN}
              className="icon-btn-sm disabled:opacity-30"
              title="缩小"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={SHELF_SCALE_MIN}
              max={SHELF_SCALE_MAX}
              step={1}
              value={shelfScale}
              onChange={(e) => setShelfScale(Number(e.target.value))}
              className="w-20 h-1 accent-primary cursor-pointer"
              title={`缩放：${shelfScale}/${SHELF_SCALE_MAX}`}
            />
            <button
              onClick={() => setShelfScale((s) => Math.min(SHELF_SCALE_MAX, s + 1))}
              disabled={shelfScale >= SHELF_SCALE_MAX}
              className="icon-btn-sm disabled:opacity-30"
              title="放大"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button onClick={handleSelectFile} className="btn-primary py-1.5 text-[13px]">
          <Upload className="w-4 h-4" />
          <span>导入书籍</span>
        </button>
        {activeAlbum && (
          <button
            onClick={() => setIsAddContentOpen(true)}
            className="btn-secondary py-1.5 text-[13px] border border-primary/25 text-primary hover:bg-primary/5"
          >
            <Plus className="w-4 h-4" />
            <span>添加内容</span>
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
          共 {displayBooks.length} 本
        </span>
      </div>

      <BatchActionBar
        selectedCount={selectedCount}
        allSelected={allSelected}
        reprocessProgress={reprocessProgress}
        reparseProgress={reparseProgress}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBatchReprocess={handleBatchReprocess}
        onBatchReparse={handleBatchReparse}
        onMigrateAllChapters={handleMigrateAllChapters}
        onBatchExportBookmarks={handleBatchExportBookmarks}
        onBatchExportAudio={handleBatchExportAudio}
        onBatchDelete={handleBatchDelete}
      />

      {/* Book list / Empty state — 书多时虚拟滚动，避免一次挂载上百张卡片 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-4 pt-4">
          {!activeAlbumId && lastReadBook && (
            <ContinueReadingCard
              book={lastReadBook}
              coverUrl={resolveCoverSrc(lastReadBook)}
              onOpen={onOpenBook}
              onCoverError={ensureCover}
            />
          )}

          {childAlbums.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">子专辑</h3>
                <span className="text-xs text-gray-400">{childAlbums.length} 个</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {childAlbums.map((album) => (
                  <div
                    key={album.id}
                    className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
                  >
                    <button
                      onClick={() => openAlbum(album.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Folder className="w-5 h-5 flex-shrink-0 text-primary" />
                      <span
                        className="truncate text-sm text-gray-700 dark:text-gray-200"
                        title={album.title}
                      >
                        {album.title}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {album.items.filter((item) => item.resourceType === 'book').length}
                      </span>
                    </button>
                    <button
                      onClick={() => handleRenameAlbum(album)}
                      className="p-1 text-gray-400 hover:text-primary"
                      title="编辑专辑标题"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteAlbum(album)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="删除专辑"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 px-4 pb-4">
          {displayBooks.length === 0 ? (
            <div
              className={`h-full flex flex-col items-center justify-center border-2 border-dashed rounded-3xl transition-all mx-1 ${
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-dark-border bg-white/40 dark:bg-dark-surface/40'
              }`}
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-primary/50" />
              </div>
              <h3 className="text-base font-semibold text-gray-600 dark:text-gray-300">书架还是空的</h3>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 max-w-xs text-center leading-relaxed">
                拖拽电子书到这里，或点击下方按钮导入
              </p>
              <button onClick={handleSelectFile} className="btn-primary mt-6 px-6 py-2.5">
                <Upload className="w-4 h-4" />
                <span>导入书籍</span>
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            displayBooks.length >= VIRTUALIZE_THRESHOLD ? (
              <VirtualBookGrid
                books={displayBooks}
                shelfScale={shelfScale}
                gridClassName={shelfGridClassName(shelfScale)}
                renderItem={(book) => (
                  <BookGridCard
                    key={book.id}
                    book={book}
                    shelfScale={shelfScale}
                    coverUrl={resolveCoverSrc(book)}
                    selected={selectedIds.has(book.id)}
                    favorited={favorites.has(book.id)}
                    multiSelectMode={selectedCount > 0}
                    onToggleSelect={toggleSelect}
                    onToggleFavorite={toggleFavorite}
                    onOpen={onOpenBook}
                    onUploadCover={handleUploadCover}
                    onContextMenu={handleContextMenu}
                    onMenuButtonClick={handleMenuButtonClick}
                    onKeyDown={handleBookCardKeyDown}
                    onCoverError={ensureCover}
                  />
                )}
              />
            ) : (
              <div className={`h-full overflow-y-auto ${shelfGridClassName(shelfScale)} content-start`}>
                {displayBooks.map((book) => (
                  <BookGridCard
                    key={book.id}
                    book={book}
                    shelfScale={shelfScale}
                    coverUrl={resolveCoverSrc(book)}
                    selected={selectedIds.has(book.id)}
                    favorited={favorites.has(book.id)}
                    multiSelectMode={selectedCount > 0}
                    onToggleSelect={toggleSelect}
                    onToggleFavorite={toggleFavorite}
                    onOpen={onOpenBook}
                    onUploadCover={handleUploadCover}
                    onContextMenu={handleContextMenu}
                    onMenuButtonClick={handleMenuButtonClick}
                    onKeyDown={handleBookCardKeyDown}
                    onCoverError={ensureCover}
                  />
                ))}
              </div>
            )
          ) : displayBooks.length >= VIRTUALIZE_THRESHOLD ? (
            <VirtualBookList
              books={displayBooks}
              renderItem={(book) => (
                <BookListRow
                  key={book.id}
                  book={book}
                  coverUrl={resolveCoverSrc(book)}
                  selected={selectedIds.has(book.id)}
                  favorited={favorites.has(book.id)}
                  multiSelectMode={selectedCount > 0}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={toggleFavorite}
                  onOpen={onOpenBook}
                  onUploadCover={handleUploadCover}
                  onContextMenu={handleContextMenu}
                  onMenuButtonClick={handleMenuButtonClick}
                  onKeyDown={handleBookCardKeyDown}
                  onCoverError={ensureCover}
                />
              )}
            />
          ) : (
            <div className="h-full overflow-y-auto flex flex-col gap-2">
              {displayBooks.map((book) => (
                <BookListRow
                  key={book.id}
                  book={book}
                  coverUrl={resolveCoverSrc(book)}
                  selected={selectedIds.has(book.id)}
                  favorited={favorites.has(book.id)}
                  multiSelectMode={selectedCount > 0}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={toggleFavorite}
                  onOpen={onOpenBook}
                  onUploadCover={handleUploadCover}
                  onContextMenu={handleContextMenu}
                  onMenuButtonClick={handleMenuButtonClick}
                  onKeyDown={handleBookCardKeyDown}
                  onCoverError={ensureCover}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ContextMenu
        open={contextMenu !== null}
        point={{ x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }}
        groups={bookMenuGroups}
        ariaLabel="书籍操作"
        triggerElement={contextMenu?.triggerElement}
        onClose={() => setContextMenu(null)}
      />

      {bookTitleEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBookTitleEditor(null)}
        >
          <form
            onSubmit={handleSubmitBookTitle}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">编辑文章标题</h3>
              <button
                type="button"
                onClick={() => setBookTitleEditor(null)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                title="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label
              className="block text-sm text-gray-600 dark:text-gray-300 mb-2"
              htmlFor="book-title-input"
            >
              文章标题（1-{BOOK_TITLE_MAX_LENGTH} 个字符）
            </label>
            <input
              id="book-title-input"
              autoFocus
              value={bookTitleDraft}
              maxLength={BOOK_TITLE_MAX_LENGTH}
              onChange={(event) => setBookTitleDraft(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setBookTitleEditor(null)}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {albumEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAlbumEditor(null)}
        >
          <form
            onSubmit={handleSubmitAlbum}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                {albumEditor.mode === 'create' ? '新建专辑' : '编辑专辑标题'}
              </h3>
              <button
                type="button"
                onClick={() => setAlbumEditor(null)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label
              className="block text-sm text-gray-600 dark:text-gray-300 mb-2"
              htmlFor="album-title-input"
            >
              专辑标题（1-{ALBUM_TITLE_MAX_LENGTH} 个字符）
            </label>
            <input
              id="album-title-input"
              autoFocus
              value={albumTitleDraft}
              maxLength={ALBUM_TITLE_MAX_LENGTH}
              onChange={(event) => setAlbumTitleDraft(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="例如：通勤听书"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setAlbumEditor(null)}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {isAddContentOpen && activeAlbum && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsAddContentOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-gray-800 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                  添加内容到“{activeAlbum.title}”
                </h3>
                <p className="text-xs text-gray-400 mt-1">当前支持添加书籍；勾选后会立即保存。</p>
              </div>
              <button
                onClick={() => setIsAddContentOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {books.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-400">请先导入书籍。</p>
              ) : (
                books.map((book) => {
                  const checked = activeAlbum.items.some(
                    (item) => item.resourceType === 'book' && item.resourceId === book.id
                  )
                  return (
                    <label
                      key={book.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleAlbumBook(book.id)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200"
                        title={book.title}
                      >
                        {book.title}
                      </span>
                      <span className="text-xs text-gray-400 truncate max-w-28">{book.author}</span>
                    </label>
                  )
                })
              )}
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setIsAddContentOpen(false)}
                className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入等操作的局部提示；全局打开书由 App LoadingOverlay 覆盖 */}
      {isLoading && loadingMessage?.includes('解析') && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 dark:bg-black/50">
          <div className="flex items-center gap-4 rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
            <span className="text-gray-700 dark:text-gray-200">{loadingMessage || '正在解析书籍…'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
