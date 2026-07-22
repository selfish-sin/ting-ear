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
  CheckSquare,
  Square,
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
import { useBookStore } from '../stores/bookStore'
import { useAlbumStore } from '../stores/albumStore'
import { useBookmarkStore } from '../stores/bookmarkStore'
import {
  generateCoverDataUrl,
  computeCoverHash,
  getStoredCoverHash,
  setStoredCoverHash
} from '../utils/coverGenerator'
import { ALBUM_TITLE_MAX_LENGTH } from '../utils/albumUtils'
import { BOOK_TITLE_MAX_LENGTH, normalizeBookTitle } from '../utils/bookData'
import type { AlbumItem, BookData, CustomAlbum } from '../global'

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

// 书架缩放：1(最小) ~ 5(最大)，默认 3
const SHELF_SCALE_MIN = 1
const SHELF_SCALE_MAX = 5
const SHELF_SCALE_DEFAULT = 3
const SHELF_SCALE_KEY = 'ting-ear-shelf-scale'

// scale → 网格列数映射（越大列越少 = 封面越大）
const SCALE_TO_COLS: Record<number, string> = {
  1: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
  2: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
  3: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
  4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3',
  5: 'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2',
}
const SCALE_TO_GAP: Record<number, string> = {
  1: 'gap-2',
  2: 'gap-3',
  3: 'gap-4',
  4: 'gap-5',
  5: 'gap-6',
}
const SCALE_TO_PAD: Record<number, string> = {
  1: 'p-1.5',
  2: 'p-2',
  3: 'p-3',
  4: 'p-4',
  5: 'p-5',
}
// scale → 标题字体
const SCALE_TO_TITLE: Record<number, string> = {
  1: 'text-[11px]',
  2: 'text-xs',
  3: 'text-sm',
  4: 'text-base',
  5: 'text-lg',
}
// scale → 作者/进度字体
const SCALE_TO_META: Record<number, string> = {
  1: 'text-[9px]',
  2: 'text-[10px]',
  3: 'text-xs',
  4: 'text-sm',
  5: 'text-sm',
}

type AlbumEditor =
  { mode: 'create'; parentId: string | null } | { mode: 'rename'; album: CustomAlbum }

export default function BookShelf({
  onImportFile,
  onOpenBook,
  onSelectChapters,
  onCleanText,
  showToast
}: BookShelfProps) {
  const { books, removeBook, renameBook, isLoading, loadBooks } = useBookStore()
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
  const [contextMenu, setContextMenu] = useState<{ book: BookData; x: number; y: number } | null>(
    null
  )
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const [isAddContentOpen, setIsAddContentOpen] = useState(false)
  const [albumEditor, setAlbumEditor] = useState<AlbumEditor | null>(null)
  const [albumTitleDraft, setAlbumTitleDraft] = useState('')
  const [bookTitleEditor, setBookTitleEditor] = useState<BookData | null>(null)
  const [bookTitleDraft, setBookTitleDraft] = useState('')

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
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

  // Load covers as data URLs.
  // 优先从磁盘缓存读取已有封面；仅在标题/作者变化或无缓存时才重新生成。
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // 第一轮：快速加载所有已缓存封面（并行）
      const cachedResults = await Promise.all(
        books.map(async (book) => {
          // custom 封面：直接从磁盘读取
          if (book.coverSource === 'custom' && book.coverPath) {
            const dataUrl = await window.api?.getCoverDataUrl(book.id)
            return { book, dataUrl: dataUrl || null, needRegen: !dataUrl }
          }
          // auto 封面：先尝试从磁盘读取已有封面
          const dataUrl = await window.api?.getCoverDataUrl(book.id)
          if (dataUrl) {
            // 检查哈希是否匹配当前标题/作者
            const currentHash = computeCoverHash(book.title, book.author)
            const storedHash = getStoredCoverHash(book.id)
            if (storedHash === null) {
              // 无历史哈希（如 EPUB 提取的封面），直接沿用并记录哈希
              setStoredCoverHash(book.id, currentHash)
              return { book, dataUrl, needRegen: false }
            }
            if (storedHash === currentHash) {
              // 哈希匹配，封面仍然有效，无需重新生成
              return { book, dataUrl, needRegen: false }
            }
            // 哈希不匹配，需要重新生成
            return { book, dataUrl, needRegen: true }
          }
          // 磁盘无封面，需要生成
          return { book, dataUrl: null, needRegen: true }
        })
      )

      if (cancelled) return

      // 先展示所有已获取的封面（快速首屏）
      const quickUrls: Record<string, string> = {}
      for (const { book, dataUrl } of cachedResults) {
        if (dataUrl) quickUrls[book.id] = dataUrl
      }
      setCoverUrls(quickUrls)

      // 第二轮：仅对需要重新生成的封面执行生成（并行）
      const regenBooks = cachedResults.filter((r) => r.needRegen)
      if (regenBooks.length === 0) return

      const regenResults = await Promise.all(
        regenBooks.map(async ({ book }) => {
          const dataUrl = generateCoverDataUrl(book.title, book.author)
          const res = await window.api?.saveCover(book.id, dataUrl)
          // 更新哈希缓存
          setStoredCoverHash(book.id, computeCoverHash(book.title, book.author))
          // 若 book 无 coverPath，补充路径信息
          if (!book.coverPath && res?.success && res.coverPath) {
            useBookStore.getState().updateBook({
              ...book,
              coverPath: res.coverPath,
              coverSource: 'auto'
            })
          }
          return { bookId: book.id, dataUrl }
        })
      )

      if (cancelled) return

      // 合并新生成的封面到已有 coverUrls
      setCoverUrls((prev) => {
        const next = { ...prev }
        for (const { bookId, dataUrl } of regenResults) {
          next[bookId] = dataUrl
        }
        return next
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [books])

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
    let done = 0
    for (const id of ids) {
      try {
        const result = await window.api?.reprocessBook(id)
        if (result?.success) done++
      } catch {
        // skip
      }
    }
    setSelectedIds(new Set())
    await loadBooks()
    showToast('success', `已清理 ${done}/${ids.length} 本书`)
  }, [selectedIds, loadBooks, showToast])

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
      if (!book.sentences || book.sentences.length === 0) {
        showToast('warning', '该书无文本内容')
        return
      }
      showToast('info', `开始导出《${book.title}》音频...`)

      const result = await window.api?.exportAudio({
        sentences: book.sentences,
        voiceId: 'zh-CN-XiaoxiaoNeural', // 导出统一用默认晓晓音色
        speed: 1.0,
        startIndex: 0,
        endIndex: book.sentences.length,
        defaultName: book.title
      })

      if (result?.success) {
        showToast('success', `《${book.title}》音频导出完成`)
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
    const targetBooks = books.filter(
      (b) => ids.includes(b.id) && b.sentences && b.sentences.length > 0
    )
    if (targetBooks.length === 0) {
      showToast('warning', '所选书籍无文本内容')
      return
    }
    let done = 0
    for (const book of targetBooks) {
      showToast('info', `正在导出《${book.title}》(${done + 1}/${targetBooks.length})...`)
      const result = await window.api?.exportAudio({
        sentences: book.sentences,
        voiceId: 'zh-CN-XiaoxiaoNeural',
        speed: 1.0,
        startIndex: 0,
        endIndex: book.sentences.length,
        defaultName: book.title
      })
      if (result?.success) done++
    }
    setSelectedIds(new Set())
    if (done > 0) showToast('success', `已导出 ${done}/${targetBooks.length} 本书的音频`)
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

  const handleContextMenu = (e: React.MouseEvent, book: BookData) => {
    e.preventDefault()
    setContextMenu({ book, x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    if (contextMenu) {
      window.addEventListener('click', closeMenu)
      return () => window.removeEventListener('click', closeMenu)
    }
  }, [contextMenu])

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

  const badgeColors: Record<string, string> = {
    epub: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    txt: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    pdf: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    docx: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    md: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    html: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    htm: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
  }

  // ---- Shared checkbox component ----
  const SelectCheckbox = ({ id }: { id: string }) => {
    const isSelected = selectedIds.has(id)
    return (
      <button
        onClick={(e) => toggleSelect(id, e)}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded flex items-center justify-center transition-all ${
          isSelected
            ? 'bg-primary text-white shadow-sm'
            : 'bg-white/80 dark:bg-gray-800/80 text-gray-300 hover:text-primary hover:bg-white dark:hover:bg-gray-700'
        }`}
        title={isSelected ? '取消选择' : '选择'}
      >
        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
    )
  }

  // ---- Shared star button ----
  const StarButton = ({ id }: { id: string }) => {
    const isFav = favorites.has(id)
    return (
      <button
        onClick={(e) => toggleFavorite(id, e)}
        className={`absolute bottom-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
          isFav
            ? 'text-amber-400'
            : 'text-gray-300 dark:text-gray-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
        }`}
        title={isFav ? '取消收藏' : '收藏'}
      >
        <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400' : ''}`} />
      </button>
    )
  }

  return (
    <div
      className={`relative flex-1 flex flex-col transition-colors duration-200 overflow-hidden ${
        isDragOver ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-dark-bg'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop upload overlay */}
      {isDragOver && isFileDrag && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-blue-50/90 dark:bg-blue-950/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 px-10 py-12 rounded-2xl border-2 border-dashed border-primary bg-white/60 dark:bg-gray-900/60 shadow-lg">
            <Upload className="w-16 h-16 text-primary animate-bounce" />
            <p className="text-xl font-semibold text-primary">释放鼠标以导入书籍</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              支持 EPUB · TXT · PDF · DOCX · MD · HTML · MOBI
            </p>
          </div>
        </div>
      )}

      {/* Album tabs: albums are first-class shelf views. */}
      <div className="flex items-center gap-1 px-4 pt-3 overflow-x-auto flex-shrink-0">
        <button
          onClick={() => openAlbum(null)}
          className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
            !activeAlbumId
              ? 'bg-primary text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          全部书籍
        </button>
        {topLevelAlbums.map((album) => {
          const isActive = albumPath.some((entry) => entry.id === album.id)
          return (
            <button
              key={album.id}
              onClick={() => openAlbum(album.id)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title={album.title}
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="max-w-32 truncate">{album.title}</span>
            </button>
          )
        })}
        <button
          onClick={handleCreateAlbum}
          className="p-1.5 rounded-md text-gray-500 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800"
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索书名或作者"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-300"
        >
          <option value="recent">最近阅读</option>
          <option value="added">添加时间</option>
          <option value="title">书名</option>
          {activeAlbum && <option value="custom">专辑顺序</option>}
        </select>

        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded ${
              viewMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow-sm' : ''
            }`}
            title="网格视图"
          >
            <LayoutGrid className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded ${
              viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm' : ''
            }`}
            title="列表视图"
          >
            <List className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* 书架缩放滑块 — 仅网格视图下显示 */}
        {viewMode === 'grid' && (
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-1.5 py-1">
            <button
              onClick={() => setShelfScale((s) => Math.max(SHELF_SCALE_MIN, s - 1))}
              disabled={shelfScale <= SHELF_SCALE_MIN}
              className="p-0.5 rounded text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-white dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 transition-colors"
              title="缩小"
            >
              <Minus className="w-4 h-4" />
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
              className="p-0.5 rounded text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-white dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 transition-colors"
              title="放大"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          onClick={handleSelectFile}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>导入书籍</span>
        </button>
        {activeAlbum && (
          <button
            onClick={() => setIsAddContentOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-primary text-primary text-sm rounded-lg hover:bg-primary/5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>添加内容</span>
          </button>
        )}
      </div>

      {/* Batch action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 dark:bg-primary/10 border-b border-primary/20 flex-shrink-0 text-sm">
          <span className="font-medium text-primary">
            已选 <span className="text-base">{selectedCount}</span> 本
          </span>
          <div className="flex-1" />
          <button
            onClick={allSelected ? clearSelection : selectAll}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button
            onClick={clearSelection}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" /> 清空
          </button>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
          <button
            onClick={handleBatchReprocess}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> 批量清理
          </button>
          <button
            onClick={handleBatchExportBookmarks}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> 导出书签
          </button>
          <button
            onClick={handleBatchExportAudio}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:text-primary rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> 导出音频
          </button>
          <button
            onClick={handleBatchDelete}
            className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> 删除
          </button>
        </div>
      )}

      {/* Book list / Empty state */}
      <div className="flex-1 overflow-y-auto p-4">
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

        {displayBooks.length === 0 ? (
          <div
            className={`h-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all ${
              isDragOver ? 'border-primary bg-primary/5' : 'border-gray-300 dark:border-gray-600'
            }`}
          >
            <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400">还没有书籍</h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
              拖拽 EPUB / TXT / PDF / DOCX / MD / HTML / MOBI 文件到此处
            </p>
            <button
              onClick={handleSelectFile}
              className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Upload className="w-4 h-4" />
              <span>导入书籍</span>
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className={`grid ${SCALE_TO_COLS[shelfScale]} ${SCALE_TO_GAP[shelfScale]}`}>
            {displayBooks.map((book) => (
              <div
                key={book.id}
                onClick={() => {
                  if (selectedCount > 0) {
                    toggleSelect(book.id)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, book)}
                className={`group relative cursor-pointer rounded-xl border transition-all ${SCALE_TO_PAD[shelfScale]} ${
                  selectedIds.has(book.id)
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-md'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface hover:shadow-lg hover:border-primary/30'
                }`}
              >
                {/* Selection checkbox — always visible */}
                <SelectCheckbox id={book.id} />
                {/* Cover — 点击换封面 */}
                <div
                  className="w-full aspect-[3/4] rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 dark:from-primary/30 dark:to-primary/10 flex items-center justify-center mb-2 overflow-hidden relative group/cover cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUploadCover(book)
                  }}
                >
                  {coverUrls[book.id] ? (
                    <img
                      src={coverUrls[book.id]}
                      alt={book.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl font-bold text-primary/40 dark:text-primary/30">
                      {book.title.charAt(0)}
                    </span>
                  )}
                  {/* Hover overlay — visual only */}
                  <div className="absolute inset-0 bg-black/0 group-hover/cover:bg-black/30 flex items-center justify-center opacity-0 group-hover/cover:opacity-100 transition-all pointer-events-none">
                    <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                      更换封面
                    </span>
                  </div>
                </div>
                {/* Info — 点击进入预选页 */}
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenBook(book)
                  }}
                  className="cursor-pointer"
                >
                  <h4
                    className={`${SCALE_TO_TITLE[shelfScale]} font-medium text-gray-800 dark:text-gray-100 truncate pr-6`}
                    title={book.title}
                  >
                    {book.title}
                  </h4>
                  <p className={`${SCALE_TO_META[shelfScale]} text-gray-400 dark:text-gray-500 truncate`}>{book.author}</p>

                  {/* Format badge */}
                  <span
                    className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded ${
                      badgeColors[book.format] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {book.format.toUpperCase()}
                  </span>

                  {/* Favorite star — hover visible, always if favorited */}
                  <StarButton id={book.id} />

                  {/* Progress */}
                  <div className="mt-2">
                    <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${book.progressPercent}%` }}
                      />
                    </div>
                    <p className={`${SCALE_TO_META[shelfScale]} text-gray-400 dark:text-gray-500 mt-0.5`}>
                      {book.progressPercent.toFixed(0)}% · {book.sentences.length}句
                    </p>
                  </div>
                </div>{' '}
                {/* close info wrapper grid */}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {displayBooks.map((book) => (
              <div
                key={book.id}
                onClick={() => {
                  if (selectedCount > 0) {
                    toggleSelect(book.id)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, book)}
                className={`group relative flex items-center gap-3 px-4 py-3 rounded-lg border transition-all cursor-pointer ${
                  selectedIds.has(book.id)
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface hover:shadow-md hover:border-primary/30'
                }`}
              >
                {/* Checkbox */}
                <SelectCheckbox id={book.id} />
                {/* Mini cover — 点击换封面 */}
                <div
                  className="w-10 h-12 rounded bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUploadCover(book)
                  }}
                >
                  {coverUrls[book.id] ? (
                    <img
                      src={coverUrls[book.id]}
                      alt={book.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-bold text-primary/50">
                      {book.title.charAt(0)}
                    </span>
                  )}
                </div>
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenBook(book)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                      {book.title}
                    </h4>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        badgeColors[book.format] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {book.format.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {book.author} · {book.sentences.length} 句
                  </p>
                </div>
                {/* Favorite star in list view */}
                <button
                  onClick={(e) => toggleFavorite(book.id, e)}
                  className={`flex-shrink-0 p-1 rounded ${
                    favorites.has(book.id)
                      ? 'text-amber-400'
                      : 'text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100'
                  }`}
                  title={favorites.has(book.id) ? '取消收藏' : '收藏'}
                >
                  <Star className={`w-4 h-4 ${favorites.has(book.id) ? 'fill-amber-400' : ''}`} />
                </button>
                <div className="w-32 flex-shrink-0">
                  <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${book.progressPercent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 text-right">
                    {book.progressPercent.toFixed(0)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 text-sm min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onOpenBook(contextMenu.book)
              setContextMenu(null)
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <BookOpen className="w-4 h-4" /> 打开阅读
          </button>
          {onSelectChapters && (
            <button
              onClick={() => {
                onSelectChapters(contextMenu.book)
                setContextMenu(null)
              }}
              className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <ListChecks className="w-4 h-4" /> 选择章节
            </button>
          )}
          <button
            onClick={() => {
              handleUploadCover(contextMenu.book)
              setContextMenu(null)
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Image className="w-4 h-4" /> 更换封面
          </button>
          <button
            onClick={() => handleRegenerateCover(contextMenu.book)}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> 重新生成封面
          </button>
          <button
            onClick={() => handleEditBookTitle(contextMenu.book)}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Pencil className="w-4 h-4" /> 编辑文章标题
          </button>
          <button
            onClick={() => {
              toggleFavorite(contextMenu.book.id)
              setContextMenu(null)
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Star
              className={`w-4 h-4 ${favorites.has(contextMenu.book.id) ? 'fill-amber-400 text-amber-400' : ''}`}
            />
            {favorites.has(contextMenu.book.id) ? '取消收藏' : '收藏'}
          </button>
          <button
            onClick={() => {
              handleExportBookmarks(contextMenu.book)
              setContextMenu(null)
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" /> 导出书签
          </button>
          <button
            onClick={() => handleExportAudio(contextMenu.book)}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> 导出音频
          </button>
          {activeAlbum && (
            <>
              <button
                onClick={async () => {
                  await moveItem(
                    activeAlbum.id,
                    { resourceType: 'book', resourceId: contextMenu.book.id },
                    -1
                  )
                  setSortBy('custom')
                  setContextMenu(null)
                }}
                className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <ChevronUp className="w-4 h-4" /> 在专辑中上移
              </button>
              <button
                onClick={async () => {
                  await moveItem(
                    activeAlbum.id,
                    { resourceType: 'book', resourceId: contextMenu.book.id },
                    1
                  )
                  setSortBy('custom')
                  setContextMenu(null)
                }}
                className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <ChevronDown className="w-4 h-4" /> 在专辑中下移
              </button>
              <button
                onClick={() => {
                  handleRemoveFromAlbum(contextMenu.book)
                  setContextMenu(null)
                }}
                className="w-full text-left px-4 py-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2"
              >
                <X className="w-4 h-4" /> 移出当前专辑
              </button>
            </>
          )}
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={async () => {
              if (!contextMenu.book) return
              setContextMenu(null)
              try {
                const result = await window.api?.reprocessBook(contextMenu.book.id)
                if (result?.success) {
                  showToast(
                    'success',
                    `已切除多余空格${result.stats?.spacesRemoved ? `（消除 ${result.stats.spacesRemoved} 个）` : ''}`
                  )
                  await loadBooks()
                } else {
                  showToast('error', result?.error || '处理失败')
                }
              } catch (e) {
                showToast('error', `处理失败: ${String(e)}`)
              }
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Scissors className="w-4 h-4" /> 切除空格
          </button>
          <button
            onClick={() => {
              if (!contextMenu.book || !onCleanText) return
              setContextMenu(null)
              onCleanText(contextMenu.book)
            }}
            className="w-full text-left px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> 清洗格式
          </button>
          <button
            onClick={() => {
              handleDeleteBook(contextMenu.book)
              setContextMenu(null)
            }}
            className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> 删除书籍
          </button>
        </div>
      )}

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

      {/* Loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 flex items-center justify-center z-40">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-2xl flex items-center gap-4">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-700 dark:text-gray-200">正在解析书籍…</span>
          </div>
        </div>
      )}
    </div>
  )
}
