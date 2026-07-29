// DOCX parser using mammoth (extracts plain text from .docx files)

import { basename } from 'path'
import { preprocessText, splitSentences } from './textPreprocessor'
import { buildChaptersByMode, detectHeadingBoundaries, type Boundary } from './chapterBuilder'

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
  sourceBoundaries?: Boundary[]
}

export async function parseDocx(filePath: string): Promise<ParseResult> {
  let mammoth: typeof import('mammoth')
  try {
    mammoth = await import('mammoth')
  } catch {
    throw new Error('DOCX 解析库未安装。请运行 npm install mammoth')
  }

  const fileName = basename(filePath, '.docx')

  try {
    // Extract raw text from docx
    const result = await mammoth.extractRawText({ path: filePath })
    const text = result.value

    if (!text || text.trim().length === 0) {
      throw new Error('该 DOCX 文件不含可提取文字内容')
    }

    const cleaned = preprocessText(text).text
    const sentences = splitSentences(cleaned)

    // Try to get title from first few sentences or use filename
    let title = fileName
    if (sentences.length > 0 && sentences[0].length < 100) {
      title = sentences[0].slice(0, 60)
    }

    // 导入只存原始切法；合并留给预选页
    const headingBounds = detectHeadingBoundaries(sentences)
    const sourceBoundaries: Boundary[] = headingBounds.length >= 2 ? headingBounds : []
    const chapters = buildChaptersByMode(sentences.length, sourceBoundaries, 'original')

    return {
      title,
      author: '未知作者',
      sentences,
      chapters: chapters.length > 0
        ? chapters
        : [{ title: '全文', startIndex: 0, sentenceCount: sentences.length }],
      sourceBoundaries
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('不含可提取文字')) {
      throw error
    }
    throw new Error(`DOCX 解析失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}
