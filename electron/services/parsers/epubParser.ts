// EPUB parser using adm-zip (EPUB is a ZIP archive of XHTML files)
// This approach works reliably in Node.js without needing a DOM environment.

import AdmZip from 'adm-zip'
import { readFileSync } from 'fs'
import { XMLParser } from 'fast-xml-parser'
import { v4 as uuidv4 } from 'uuid'
import { preprocessText, splitSentences, sanitizeControlChars } from './textPreprocessor'
import { basename, extname } from 'path'
import { deriveChapters, deriveSentences, regroupStructuredChapters } from './structureBuilder'
import { buildPseudoChapterTitle, chaptersToBoundaries } from './chapterBuilder'
import { hashSentences } from '../../../src/utils/contentHash'
import type { Block, StructuredChapter, StructureMeta } from '../../../src/global'

/**
 * 从 XHTML/HTML 内容中检测编码声明。
 * 检查顺序：<?xml encoding?> → <meta charset> → <meta http-equiv>
 * 未声明时返回 'utf-8'。
 */
function detectHtmlEncoding(htmlBytes: Buffer): string {
  // 取前 1024 字节即可，编码声明都在头部
  const head = htmlBytes.toString('ascii', 0, Math.min(htmlBytes.length, 1024))
  // <?xml version="1.0" encoding="GBK"?>
  const xmlEnc = head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)
  if (xmlEnc) return xmlEnc[1]
  // <meta charset="gbk">
  const metaCharset = head.match(/<meta[^>]*charset\s*=\s*["']([^"']+)["']/i)
  if (metaCharset) return metaCharset[1]
  // <meta http-equiv="Content-Type" content="text/html; charset=gbk">
  const metaHttp = head.match(
    /<meta[^>]*http-equiv\s*=\s*["']Content-Type["'][^>]*charset\s*=\s*([^\s"';]+)/i
  )
  if (metaHttp) return metaHttp[1]
  return 'utf-8'
}

/**
 * 安全解码 XHTML 内容：检测编码 → iconv-lite 解码（errors:'ignore'） → 消毒控制字符
 */
function decodeHtmlSafe(htmlBytes: Buffer): string {
  const encoding = detectHtmlEncoding(htmlBytes)
  try {
    const iconv = require('iconv-lite')
    return iconv.decode(htmlBytes, encoding, { errors: 'ignore' })
  } catch {
    // 编码名无效时回退 utf-8
    return htmlBytes.toString('utf-8')
  }
}

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
  sourceBoundaries?: Array<{ title: string; sentenceIndex: number }>
  coverDataUrl?: string
  structure?: StructuredChapter[]
  structureMeta?: StructureMeta
}

// Strip HTML tags and entities -> plain text
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

interface TocEntry {
  title: string
  href: string
}

const packageXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true
})

function xmlRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function xmlItems(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function xmlText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = xmlText(item)
      if (text) return text
    }
    return ''
  }
  const record = xmlRecord(value)
  return record ? xmlText(record['#text']) : ''
}

// Parse container.xml to find the OPF file path
function findOpfPath(zip: AdmZip): string {
  const container = zip.getEntry('META-INF/container.xml')
  if (!container) return 'OEBPS/content.opf'
  try {
    const parsed = xmlRecord(packageXmlParser.parse(container.getData().toString('utf-8')))
    const containerNode = xmlRecord(parsed?.container)
    const rootfiles = xmlRecord(containerNode?.rootfiles)
    for (const rootfile of xmlItems(rootfiles?.rootfile)) {
      const fullPath = xmlText(xmlRecord(rootfile)?.['@_full-path'])
      if (fullPath) return fullPath
    }
  } catch {
    // Keep the historical default so the caller emits the existing missing-OPF error.
  }
  return 'OEBPS/content.opf'
}

// Parse OPF to get spine order and metadata
function parseOpf(opfXml: string): {
  title: string
  author: string
  manifest: Map<string, { href: string; mediaType: string }>
  spine: string[]
} {
  const manifest = new Map<string, { href: string; mediaType: string }>()
  const spine: string[] = []

  const parsed = xmlRecord(packageXmlParser.parse(opfXml))
  const packageNode = xmlRecord(parsed?.package)
  const metadataNode = xmlRecord(packageNode?.metadata)
  const title = xmlText(metadataNode?.title)
  const author = xmlText(metadataNode?.creator)

  const manifestNode = xmlRecord(packageNode?.manifest)
  for (const value of xmlItems(manifestNode?.item)) {
    const item = xmlRecord(value)
    const id = xmlText(item?.['@_id'])
    const href = xmlText(item?.['@_href'])
    const mediaType = xmlText(item?.['@_media-type'])
    if (id && href && mediaType) manifest.set(id, { href, mediaType })
  }

  const spineNode = xmlRecord(packageNode?.spine)
  for (const value of xmlItems(spineNode?.itemref)) {
    const idref = xmlText(xmlRecord(value)?.['@_idref'])
    if (idref) spine.push(idref)
  }

  return { title, author, manifest, spine }
}

// Parse toc.ncx for chapter titles
function parseNcx(ncxXml: string): TocEntry[] {
  const entries: TocEntry[] = []
  const navPointRegex =
    /<navPoint[^>]*>[\s\S]*?<navLabel[^>]*>[\s\S]*?<text>([^<]+)<\/text>[\s\S]*?<content[^>]*src="([^"]+)"[^>]*\/?>/gi
  let match: RegExpExecArray | null
  while ((match = navPointRegex.exec(ncxXml)) !== null) {
    entries.push({ title: match[1].trim(), href: match[2].trim() })
  }
  return entries
}

// Parse nav.xhtml (EPUB3) for chapter titles
function parseNav(navXml: string): TocEntry[] {
  // 优先取目录 nav（epub:type="toc" / role="doc-toc"），避免误读 landmarks / page-list
  const tocNavMatch = navXml.match(
    /<nav[^>]*(?:epub:type=["']toc["']|role=["']doc-toc["'])[^>]*>[\s\S]*?<\/nav>/i
  )
  const scope = tocNavMatch ? tocNavMatch[0] : navXml

  const entries: TocEntry[] = []
  // 链接文本用 [\s\S]*? 兜底嵌套标签，再 stripHtml 取纯文本
  const aRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = aRegex.exec(scope)) !== null) {
    const text = stripHtml(match[2]).trim()
    if (text) entries.push({ title: text, href: match[1].trim() })
  }
  return entries
}

/** 定位锚点在 HTML 中的位置，回退到所在标签的起始 `<`，找不到返回 -1 */
function findAnchorPosition(html: string, anchor: string): number {
  const patterns = [`id="${anchor}"`, `id='${anchor}'`, `name="${anchor}"`, `name='${anchor}'`]
  let attrIdx = -1
  for (const p of patterns) {
    const idx = html.indexOf(p)
    if (idx >= 0 && (attrIdx < 0 || idx < attrIdx)) attrIdx = idx
  }
  if (attrIdx < 0) return -1
  const tagStart = html.lastIndexOf('<', attrIdx)
  return tagStart >= 0 ? tagStart : attrIdx
}

/**
 * 按多级目录锚点把一个文件的原始 HTML 切成若干段（每段对应一个目录条目）。
 * - 目录条目少于 2 个时不切分（整文件作为一章）。
 * - 锚点找不到的条目跳过。
 * - 第一个锚点之前的内容归入第一章，避免丢失卷首文字。
 */
function splitHtmlByToc(html: string, entries: TocEntry[]): Array<{ title: string; html: string }> {
  if (entries.length <= 1) {
    return entries.length === 1 ? [{ title: entries[0].title, html }] : []
  }

  const points: Array<{ pos: number; title: string }> = []
  for (const entry of entries) {
    const hashIdx = entry.href.indexOf('#')
    const anchor = hashIdx >= 0 ? entry.href.slice(hashIdx + 1) : ''
    let pos = 0
    if (anchor) {
      pos = findAnchorPosition(html, anchor)
      if (pos < 0) continue
    }
    points.push({ pos, title: entry.title })
  }

  if (points.length <= 1) {
    return points.length === 1 ? [{ title: points[0].title, html }] : []
  }

  points.sort((a, b) => a.pos - b.pos)

  const segments: Array<{ title: string; html: string }> = []
  for (let i = 0; i < points.length; i++) {
    const start = i === 0 ? 0 : points[i].pos
    const end = i + 1 < points.length ? points[i + 1].pos : html.length
    if (end > start) segments.push({ title: points[i].title, html: html.slice(start, end) })
  }
  return segments
}

/** 原始 HTML 片段 → 句子数组 */
function toSentences(rawHtml: string): string[] {
  const text = preprocessText(sanitizeControlChars(stripHtml(rawHtml))).text
  return splitSentences(text)
}

// === 结构化解析（切片 A）===

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: true,
  trimValues: false
})

interface OrderedElement {
  tag: string
  children: unknown[]
  attributes: Record<string, unknown>
}

const CONTAINER_TAGS = new Set([
  'html',
  'body',
  'section',
  'article',
  'main',
  'div',
  'header',
  'footer',
  'nav',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'dl',
  'dt',
  'dd'
])

const BLOCK_TAGS = new Set([
  'p',
  'aside',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  ...Array.from({ length: 6 }, (_, index) => `h${index + 1}`)
])

function normalizeTag(tag: string): string {
  return (tag.split(':').pop() || tag).toLowerCase()
}

function orderedElement(node: unknown): OrderedElement | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null
  const record = node as Record<string, unknown>
  const entry = Object.entries(record).find(([key]) => key !== ':@' && key !== '#text')
  if (!entry) return null
  const attributes = record[':@']
  return {
    tag: normalizeTag(entry[0]),
    children: Array.isArray(entry[1]) ? entry[1] : [],
    attributes:
      attributes && typeof attributes === 'object' && !Array.isArray(attributes)
        ? (attributes as Record<string, unknown>)
        : {}
  }
}

/** 按 preserveOrder 节点顺序提取行内文本。 */
function extractOrderedText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractOrderedText).join('')
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>
    if ('#text' in record) return extractOrderedText(record['#text'])
    const element = orderedElement(node)
    if (element?.tag === 'br') return '\n'
    if (element) return extractOrderedText(element.children)
  }
  return ''
}

function isFootnoteAttributes(attributes: Record<string, unknown>): boolean {
  const epubType = String(attributes['@_epub:type'] || attributes['@_type'] || '').toLowerCase()
  const cls = String(attributes['@_class'] || '').toLowerCase()
  const role = String(attributes['@_role'] || '').toLowerCase()
  return (
    epubType.includes('footnote') ||
    epubType.includes('endnote') ||
    cls.includes('footnote') ||
    cls.includes('endnote') ||
    role === 'doc-footnote' ||
    role === 'doc-endnote'
  )
}

function isPageBreakAttributes(attributes: Record<string, unknown>): boolean {
  const epubType = String(attributes['@_epub:type'] || attributes['@_type'] || '').toLowerCase()
  const role = String(attributes['@_role'] || '').toLowerCase()
  return epubType.includes('pagebreak') || role === 'doc-pagebreak'
}

function hasStructuredDescendant(nodes: unknown[]): boolean {
  return nodes.some((node) => {
    const element = orderedElement(node)
    if (!element) return false
    return (
      BLOCK_TAGS.has(element.tag) ||
      CONTAINER_TAGS.has(element.tag) ||
      hasStructuredDescendant(element.children)
    )
  })
}

/**
 * 用 fast-xml-parser 解析 XHTML 为 Block[]。
 * 解析失败时返回 null（调用方降级到 stripHtml）。
 */
export function parseXhtmlToBlocks(xhtml: string): Block[] | null {
  try {
    const cleaned = xhtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    const blocks: Block[] = []

    const addBlock = (
      type: Block['type'],
      rawText: string,
      ttsSkip: boolean,
      level?: number
    ): void => {
      const text = type === 'code' ? rawText.trim() : rawText.replace(/\s+/g, ' ').trim()
      if (!text && type !== 'page_break') return
      blocks.push({
        blockId: uuidv4(),
        type,
        ...(level ? { level } : {}),
        text,
        ttsSkip,
        sentenceRange: [0, 0]
      })
    }

    const processNodes = (nodes: unknown[], inheritedFootnote = false): void => {
      let inlineText = ''
      const flushInline = (): void => {
        addBlock(inheritedFootnote ? 'footnote' : 'paragraph', inlineText, inheritedFootnote)
        inlineText = ''
      }

      for (const node of nodes) {
        const element = orderedElement(node)
        if (!element) {
          inlineText += extractOrderedText(node)
          continue
        }

        if (element.tag === 'script' || element.tag === 'style' || element.tag === 'head') continue
        const structured =
          BLOCK_TAGS.has(element.tag) ||
          CONTAINER_TAGS.has(element.tag) ||
          hasStructuredDescendant(element.children)
        if (!structured) {
          inlineText += extractOrderedText(node)
          continue
        }

        flushInline()
        const footnote = inheritedFootnote || isFootnoteAttributes(element.attributes)
        const heading = /^h([1-6])$/.exec(element.tag)
        if (isPageBreakAttributes(element.attributes)) {
          addBlock('page_break', extractOrderedText(element.children), true)
        } else if (heading) {
          addBlock('heading', extractOrderedText(element.children), false, Number(heading[1]))
        } else if (element.tag === 'p') {
          addBlock(footnote ? 'footnote' : 'paragraph', extractOrderedText(element.children), footnote)
        } else if (element.tag === 'aside' || (element.tag === 'div' && footnote)) {
          addBlock('footnote', extractOrderedText(element.children), true)
        } else if (element.tag === 'blockquote') {
          addBlock('quote', extractOrderedText(element.children), false)
        } else if (element.tag === 'pre' || element.tag === 'code') {
          addBlock('code', extractOrderedText(element.children), true)
        } else if (element.tag === 'li') {
          addBlock('list', extractOrderedText(element.children), false)
        } else if (element.tag === 'ul' || element.tag === 'ol') {
          for (const child of element.children) {
            const item = orderedElement(child)
            if (item?.tag === 'li') addBlock('list', extractOrderedText(item.children), false)
            else if (item) processNodes([child], footnote)
          }
        } else {
          processNodes(element.children, footnote)
        }
      }
      flushInline()
    }

    const parsed = xmlParser.parse(cleaned) as unknown
    processNodes(Array.isArray(parsed) ? parsed : [parsed])
    return blocks.length > 0 ? blocks : null
  } catch {
    return null
  }
}

/** 从 EPUB 中提取封面图片，返回 data URL；找不到返回 undefined */
function extractCover(
  zip: AdmZip,
  opfXml: string,
  opfBase: string,
  manifest: Map<string, { href: string; mediaType: string }>
): string | undefined {
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
  const extToMime: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
  }

  const toDataUrl = (entryPath: string): string | undefined => {
    const entry = zip.getEntry(entryPath)
    if (!entry) return undefined
    const buf = entry.getData()
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return undefined // 跳过空文件或>5MB
    const ext = entryPath.substring(entryPath.lastIndexOf('.')).toLowerCase()
    const mime = extToMime[ext] || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  }

  // 策略1: OPF <meta name="cover" content="id"/>
  const metaCover = opfXml.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)
    || opfXml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/i)
  if (metaCover) {
    const item = manifest.get(metaCover[1])
    if (item && IMAGE_TYPES.some(t => item.mediaType.includes(t))) {
      const result = toDataUrl(opfBase + item.href)
      if (result) return result
    }
  }

  // 策略2: manifest item 带 properties="cover-image" (EPUB3)
  const coverPropMatch = opfXml.match(/<item[^>]*properties=["'][^"']*cover-image[^"']*["'][^>]*\/?>/i)
  if (coverPropMatch) {
    const idMatch = coverPropMatch[0].match(/id=["']([^"']+)["']/)
    if (idMatch) {
      const item = manifest.get(idMatch[1])
      if (item) {
        const result = toDataUrl(opfBase + item.href)
        if (result) return result
      }
    }
  }

  // 策略3: manifest 中 id 或 href 含 "cover" 的图片项
  for (const [id, item] of manifest) {
    if (!IMAGE_TYPES.some(t => item.mediaType.includes(t))) continue
    if (/cover/i.test(id) || /cover/i.test(item.href)) {
      const result = toDataUrl(opfBase + item.href)
      if (result) return result
    }
  }

  // 策略4: 常见封面文件名
  const candidates = ['cover.jpg', 'cover.jpeg', 'cover.png', 'images/cover.jpg', 'images/cover.png', 'Images/cover.jpg']
  for (const c of candidates) {
    const result = toDataUrl(opfBase + c) || toDataUrl(c)
    if (result) return result
  }

  return undefined
}

export async function parseEpub(filePath: string, _cacheDir: string): Promise<ParseResult> {
  const fileBuffer = readFileSync(filePath)
  const zip = new AdmZip(fileBuffer)

  // 1. Find the OPF file
  const opfPath = findOpfPath(zip)
  const opfEntry = zip.getEntry(opfPath)
  if (!opfEntry) {
    throw new Error('无法找到 EPUB 内容描述文件 (OPF)')
  }
  const opfXml = opfEntry.getData().toString('utf-8')

  // OPF base directory (for resolving relative hrefs)
  const opfBase = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''

  // 2. Parse OPF
  const { title: opfTitle, author, manifest, spine } = parseOpf(opfXml)

  const title = opfTitle || basename(filePath, extname(filePath))

  // 2.5 Extract cover image
  const coverDataUrl = extractCover(zip, opfXml, opfBase, manifest)

  // 3. Try to find TOC (ncx or nav)
  const tocEntries: TocEntry[] = []
  // Find ncx entry in manifest
  for (const [, item] of manifest) {
    if (item.mediaType === 'application/x-dtbncx+xml' || item.href.endsWith('.ncx')) {
      const ncxPath = opfBase + item.href
      const ncxEntry = zip.getEntry(ncxPath)
      if (ncxEntry) {
        const ncxXml = ncxEntry.getData().toString('utf-8')
        tocEntries.push(...parseNcx(ncxXml))
        break
      }
    }
  }
  // If no ncx, try nav (EPUB3)
  if (tocEntries.length === 0) {
    for (const [, item] of manifest) {
      if (item.mediaType === 'application/xhtml+xml' && /nav/i.test(item.href)) {
        const navPath = opfBase + item.href
        const navEntry = zip.getEntry(navPath)
        if (navEntry) {
          const navXml = navEntry.getData().toString('utf-8')
          tocEntries.push(...parseNav(navXml))
          break
        }
      }
    }
  }

  // 按文件分组目录条目（保留顺序与 #锚点），供多级切分使用
  const entriesByFile = new Map<string, TocEntry[]>()
  for (const entry of tocEntries) {
    const fileName = entry.href.split('#')[0]
    if (!entriesByFile.has(fileName)) entriesByFile.set(fileName, [])
    entriesByFile.get(fileName)!.push(entry)
  }

  // 4. 遍历 spine 提取文本 + 构建 structure
  const allSentences: string[] = []
  const structure: StructuredChapter[] = []
  let chapterCounter = 0

  for (const idref of spine) {
    const item = manifest.get(idref)
    if (!item) continue
    if (
      !item.mediaType.includes('xhtml') &&
      !item.mediaType.includes('html') &&
      !item.href.endsWith('.html') &&
      !item.href.endsWith('.xhtml')
    ) {
      continue
    }

    const filePath = opfBase + item.href
    const entry = zip.getEntry(filePath)
    if (!entry) continue

    const rawHtml = decodeHtmlSafe(entry.getData())
    const fileName = item.href.split('#')[0]
    const segments = splitHtmlByToc(rawHtml, entriesByFile.get(fileName) || [])
    const fileStructureStart = structure.length

    const processSegment = (title: string, html: string): void => {
      // 尝试结构化解析
      const blocks = parseXhtmlToBlocks(html)
      if (blocks && blocks.length > 0) {
        const ch: StructuredChapter = { title, level: 1, blocks, sentenceRange: [0, 0] }
        const sentences = deriveSentences([ch])
        if (sentences.length > 0) {
          const offset = allSentences.length
          ch.sentenceRange = [ch.sentenceRange[0] + offset, ch.sentenceRange[1] + offset]
          for (const block of ch.blocks) {
            block.sentenceRange = [
              block.sentenceRange[0] + offset,
              block.sentenceRange[1] + offset
            ]
          }
          allSentences.push(...sentences)
          structure.push(ch)
          chapterCounter++
        }
      } else {
        // fallback: stripHtml
        const sentences = toSentences(html)
        if (sentences.length > 0) {
          allSentences.push(...sentences)
          // 构建单段落 block 作为 pseudo structure
          structure.push({
            title,
            level: 1,
            blocks: [{
              blockId: uuidv4(),
              type: 'paragraph',
              text: sentences.join(' '),
              ttsSkip: false,
              sentenceRange: [allSentences.length - sentences.length, allSentences.length]
            }],
            sentenceRange: [allSentences.length - sentences.length, allSentences.length]
          })
          chapterCounter++
        }
      }
    }

    if (segments.length > 0) {
      for (const seg of segments) processSegment(seg.title, seg.html)
    } else {
      // 该 spine 文件无目录锚点命中 → 走「第N部分」兜底，不再凭空造「第N章」假标题
      processSegment(buildPseudoChapterTitle(chapterCounter + 1), rawHtml)
    }

    const fileStructure = structure.slice(fileStructureStart)
    if (fileStructure.length > 1) {
      const regroupedFile = regroupStructuredChapters(fileStructure)
      structure.splice(fileStructureStart, fileStructure.length, ...regroupedFile.structure)
    }
  }

  if (allSentences.length === 0) {
    throw new Error('无法从 EPUB 中提取文本内容。文件可能已损坏或使用了不支持的格式。')
  }

  // 原料边界 = TOC 原始章节；导入默认 original（仅切超长，不做 35 合并）
  const sourceBoundaries = chaptersToBoundaries(deriveChapters(structure))
  const refined =
    structure.length > 0
      ? regroupStructuredChapters(structure, { mode: 'original' })
      : { structure, chapters: deriveChapters(structure) }

  const chapters =
    refined.chapters.length > 0
      ? refined.chapters
      : [{ title: '全文', startIndex: 0, sentenceCount: allSentences.length }]

  return {
    title,
    author: author || '未知作者',
    sentences: allSentences,
    chapters,
    sourceBoundaries,
    coverDataUrl,
    structure: refined.structure,
    structureMeta: {
      schemaVersion: 1,
      contentHash: hashSentences(allSentences),
      sourceFormat: 'epub'
    }
  }
}
