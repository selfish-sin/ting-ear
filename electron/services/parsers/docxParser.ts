// DOCX parser using mammoth (extracts plain text from .docx files)

import { basename } from 'path'
import { preprocessText, splitSentences } from './textPreprocessor'
import { buildChapters, detectHeadingBoundaries } from './chapterBuilder'

// DOCX 无内嵌目录时按正文标题（第X章/Chapter X）分章；归一化防碎防巨
const DOCX_MIN_SENTENCES = 60
const DOCX_MAX_SENTENCES = 900

interface ParseResult {
  title: string
  author: string
  sentences: string[]
  chapters: Array<{ title: string; startIndex: number; sentenceCount: number }>
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

    // 优先按正文标题（第X章/Chapter X 等）分章；无标题时 buildChapters 自动退回尺寸伪分章
    const headingBounds = detectHeadingBoundaries(sentences)
    const chapters = buildChapters(sentences.length, headingBounds, {
      minSentences: DOCX_MIN_SENTENCES,
      maxSentences: DOCX_MAX_SENTENCES
    })

    return {
      title,
      author: '未知作者',
      sentences,
      chapters: chapters.length > 0
        ? chapters
        : [{ title: '全文', startIndex: 0, sentenceCount: sentences.length }]
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('不含可提取文字')) {
      throw error
    }
    throw new Error(`DOCX 解析失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}
