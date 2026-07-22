// PDF parser — 使用 pdf-parse 内置的 pdf.js（v1.10.100，同一引擎，无需新增依赖）。
// 相比旧版（纯文本 + 每 100 句盲切）的改进：
//  1. 逐页提取文本，记录「页 → 句子下标」映射；
//  2. 读取 PDF 书签（outline，含多级嵌套），映射为分界点；
//  3. 交给统一归一化层 buildChapters 收拢粒度（防碎防巨，从不按页数切）；
//  4. 无书签时退回正文标题识别（第X章/Chapter X），再不行才按尺寸伪分章。

import { basename } from 'path'
import { statSync, readFileSync } from 'fs'
import { preprocessText, splitSentences } from './textPreprocessor'
import {
  buildChapters,
  detectHeadingBoundaries,
  type Boundary,
  type BuiltChapter
} from './chapterBuilder'

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
}

const MAX_PDF_FILE_SIZE = 200 * 1024 * 1024
const PARSE_TIMEOUT_MS = 120_000

// PDF 书签通常粒度较细（甚至一页一个），归一化时用较大的下限收拢
const PDF_MIN_SENTENCES = 200
const PDF_MAX_SENTENCES = 600

// pdf.js 文档句柄的最小结构（仅标注用到的成员）
interface PdfJsDoc {
  numPages: number
  getPage: (n: number) => Promise<PdfJsPage>
  getMetadata: () => Promise<{ info?: Record<string, unknown> }>
  getOutline: () => Promise<PdfJsOutlineItem[] | null>
  getDestination: (name: string) => Promise<unknown[] | null>
  getPageIndex: (ref: unknown) => Promise<number>
  destroy?: () => Promise<void>
}
interface PdfJsPage {
  getTextContent: (opts?: Record<string, unknown>) => Promise<{ items: Array<{ str: string; transform: number[] }> }>
  cleanup?: () => void
}
interface PdfJsOutlineItem {
  title?: string
  dest?: unknown
  items?: PdfJsOutlineItem[]
}

/** 运行时加载 pdf-parse 内置的 pdf.js（依赖被 externalize，不会进打包） */
function loadPdfJs(): {
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfJsDoc> }
} {
  let PDFJS: Record<string, unknown>
  try {
    PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')
  } catch (e) {
    throw new Error(
      `PDF 解析库加载失败。请确认 pdf-parse 已安装: npm install pdf-parse@1\n` +
        `错误: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e }
    )
  }
  // Node 环境关闭 worker；压低日志噪音
  if ('disableWorker' in PDFJS) PDFJS.disableWorker = true
  if ('verbosity' in PDFJS) PDFJS.verbosity = 0
  return PDFJS as unknown as {
    getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfJsDoc> }
  }
}

/** 逐页提取文本（与 pdf-parse 的 render_page 逻辑一致：按 Y 坐标换行） */
async function getPageText(page: PdfJsPage): Promise<string> {
  const textContent = await page.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  })
  let lastY: number | undefined
  let text = ''
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === undefined) text += item.str
    else text += '\n' + item.str
    lastY = item.transform[5]
  }
  return text
}

/** 递归展开书签树，把每个条目映射为分界点（页 → 句子下标） */
async function collectOutline(
  doc: PdfJsDoc,
  items: PdfJsOutlineItem[],
  depth: number,
  pageSentenceStart: number[],
  out: Boundary[]
): Promise<void> {
  for (const item of items) {
    let pageIndex = -1
    try {
      const dest =
        typeof item.dest === 'string' ? await doc.getDestination(item.dest) : (item.dest as unknown[])
      if (dest && dest.length > 0) pageIndex = await doc.getPageIndex(dest[0])
    } catch {
      pageIndex = -1
    }
    if (pageIndex >= 0 && pageIndex < pageSentenceStart.length) {
      out.push({
        title: (item.title || '').trim(),
        sentenceIndex: pageSentenceStart[pageIndex],
        depth
      })
    }
    if (item.items && item.items.length > 0) {
      await collectOutline(doc, item.items, depth + 1, pageSentenceStart, out)
    }
  }
}

export async function parsePdf(filePath: string): Promise<ParseResult> {
  const fileName = basename(filePath, '.pdf')

  // === 文件大小预检 ===
  let fileSize: number
  try {
    fileSize = statSync(filePath).size
  } catch {
    throw new Error('无法读取 PDF 文件，请确认文件路径有效')
  }
  if (fileSize > MAX_PDF_FILE_SIZE) {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1)
    throw new Error(
      `PDF 文件过大（${sizeMB} MB），超出 ${(MAX_PDF_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB 限制。\n建议使用 PDF 拆分工具减小文件后再导入。`
    )
  }

  const PDFJS = loadPdfJs()
  const pdfBuffer = readFileSync(filePath)

  // === 超时熔断 ===
  let timeout: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`PDF 解析超时（${PARSE_TIMEOUT_MS / 1000} 秒）。`))
    }, PARSE_TIMEOUT_MS)
  })

  const parsePromise = (async (): Promise<ParseResult> => {
    let doc: PdfJsDoc
    try {
      doc = await PDFJS.getDocument({ data: new Uint8Array(pdfBuffer) }).promise
    } catch (parseErr) {
      const err = parseErr as { name?: string; message?: string }
      const msg = err?.message || String(parseErr)
      const name = err?.name || ''
      if (name === 'PasswordException' || /password|encrypt/i.test(msg)) {
        throw new Error(`该 PDF 已加密，请先用工具解密后再导入。`, { cause: parseErr })
      }
      if (name === 'InvalidPDFException' || /invalid pdf|header|xref/i.test(msg)) {
        throw new Error(`PDF 文件格式无效或已损坏，请确认文件未被截断。`, { cause: parseErr })
      }
      throw new Error(`PDF 解析失败: ${msg}`, { cause: parseErr })
    }

    try {
      const numPages = doc.numPages || 1

      // 元数据
      let title = fileName
      let author = '未知作者'
      try {
        const md = await doc.getMetadata()
        const info = md?.info || {}
        if (info.Title) title = String(info.Title)
        if (info.Author) author = String(info.Author)
      } catch {
        // 元数据缺失不影响正文
      }

      // 逐页提取文本，同时记录「页 → 句子下标」映射（按页累加，天然精确无漂移）
      const allSentences: string[] = []
      const pageSentenceStart: number[] = []
      let totalChars = 0
      for (let p = 1; p <= numPages; p++) {
        pageSentenceStart[p - 1] = allSentences.length
        const page = await doc.getPage(p)
        const pageText = await getPageText(page)
        totalChars += pageText.length
        const sentences = splitSentences(preprocessText(pageText).text)
        allSentences.push(...sentences)
        if (page.cleanup) {
          try {
            page.cleanup()
          } catch {
            // ignore
          }
        }
      }

      // 扫描件 / 纯图片检测
      const avgCharsPerPage = totalChars / numPages
      if (allSentences.length === 0 || totalChars === 0 || (numPages >= 5 && avgCharsPerPage < 15)) {
        throw new Error(
          '该 PDF 为扫描件或纯图片 PDF，无可复制文字。\n请先用 OCR 工具处理后，将识别文字粘贴到「快速文本」中再朗读。'
        )
      }

      // 书签 → 分界点
      const boundaries: Boundary[] = []
      try {
        const outline = await doc.getOutline()
        if (outline && outline.length > 0) {
          await collectOutline(doc, outline, 1, pageSentenceStart, boundaries)
        }
      } catch {
        // 无书签或读取失败，走退路
      }

      let chapters: BuiltChapter[]
      if (boundaries.length >= 2) {
        // 有书签：按书签分章 + 归一化收拢
        chapters = buildChapters(allSentences.length, boundaries, {
          minSentences: PDF_MIN_SENTENCES,
          maxSentences: PDF_MAX_SENTENCES
        })
      } else {
        // 无书签：先试正文标题识别
        const headingBounds = detectHeadingBoundaries(allSentences)
        chapters =
          headingBounds.length >= 2
            ? buildChapters(allSentences.length, headingBounds, {
                minSentences: PDF_MIN_SENTENCES,
                maxSentences: PDF_MAX_SENTENCES
              })
            : buildChapters(allSentences.length, [], { pseudoChunkSize: 400 })
      }

      return { title, author, sentences: allSentences, chapters }
    } finally {
      if (doc.destroy) {
        try {
          await doc.destroy()
        } catch {
          // ignore
        }
      }
    }
  })()

  try {
    return await Promise.race([parsePromise, timeoutPromise])
  } finally {
    clearTimeout(timeout!)
  }
}
