// MOBI/AZW/AZW3 解析：借 Calibre 的 ebook-convert 转为 EPUB，再复用 EPUB 解析。
// 纯 JS 解析 MOBI（KF7/KF8）不可靠，Calibre 转换保真度最好；未装 Calibre 时给出明确指引。

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { parseEpub } from './epubParser'

const execFileAsync = promisify(execFile)

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
}

// Calibre ebook-convert 候选位置（PATH + 常见安装目录）
const CONVERTER_CANDIDATES = [
  'ebook-convert.exe',
  'ebook-convert',
  'C:\\Program Files\\Calibre2\\ebook-convert.exe',
  'C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe'
]

let cachedConverter: string | null | undefined

/** 探测可用的 ebook-convert，结果缓存 */
async function findEbookConvert(): Promise<string | null> {
  if (cachedConverter !== undefined) return cachedConverter
  for (const cand of CONVERTER_CANDIDATES) {
    try {
      await execFileAsync(cand, ['--version'], { timeout: 15000 })
      cachedConverter = cand
      return cand
    } catch {
      // 该候选不可用，继续
    }
  }
  cachedConverter = null
  return null
}

const MOBI_EXT_REGEX = /\.(mobi|azw3?|prc)$/i

export async function parseMobi(filePath: string, cacheDir: string): Promise<ParseResult> {
  const converter = await findEbookConvert()
  if (!converter) {
    throw new Error(
      '导入 MOBI/AZW 需要 Calibre 支持。\n请安装 Calibre（免费，calibre-ebook.com）后重试，或先用其他工具将文件转换为 EPUB 再导入。'
    )
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'ting-ear-mobi-'))
  const epubPath = join(tmpDir, basename(filePath).replace(MOBI_EXT_REGEX, '') + '.epub')

  try {
    // 转换可能较慢（大书），给 5 分钟
    await execFileAsync(converter, [filePath, epubPath], {
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/drm|encrypted|copyright/i.test(msg)) {
      throw new Error('该文件受 DRM 保护，无法直接转换。请先移除 DRM 或改用未加密的 EPUB。', { cause: e })
    }
    throw new Error(`MOBI 转换失败：${msg}`, { cause: e })
  }

  if (!existsSync(epubPath)) {
    throw new Error('MOBI 转换未生成 EPUB，文件可能已损坏或受 DRM 保护。')
  }

  return parseEpub(epubPath, cacheDir)
}
