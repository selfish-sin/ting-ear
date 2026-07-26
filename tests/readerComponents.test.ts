import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useBookStore } from '../src/stores/bookStore'
import { usePlayerStore } from '../src/stores/playerStore'
import type { BookData } from '../src/global'

function createBook(structured: boolean): BookData {
  const sentences = [
    '第一段正文包含足够的信息用于结构化阅读页面测试。',
    '第二段正文继续验证当前句子的高亮状态。'
  ]
  return {
    id: structured ? 'structured-book' : 'legacy-book',
    title: structured ? '结构化测试书' : '旧书测试',
    author: '测试作者',
    filePath: structured ? 'structured.md' : 'legacy.txt',
    format: structured ? 'md' : 'txt',
    sentences,
    chapters: [{ title: '第一章', startIndex: 0, sentenceCount: sentences.length }],
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: '2026-07-25T00:00:00.000Z',
    lastReadAt: '2026-07-25T00:00:00.000Z',
    structure: structured
      ? [
          {
            title: '第一章',
            level: 1,
            sentenceRange: [0, sentences.length],
            blocks: [
              {
                blockId: 'block-1',
                type: 'paragraph',
                text: sentences.join(''),
                ttsSkip: false,
                sentenceRange: [0, sentences.length]
              }
            ]
          }
        ]
      : undefined
  }
}

async function run(): Promise<void> {
  console.log('\nReader components')
  try {
    const [
      { default: ModeSwitch },
      { AiReaderContent },
      { default: ContentCard },
      { hasEquivalentChapterHeading }
    ] = await Promise.all([
      import('../src/components/reader/ModeSwitch'),
      import('../src/components/reader/AiReaderView'),
      import('../src/components/reader/ContentCard'),
      import('../src/components/reader/ContentCards')
    ])

    const structuredBook = createBook(true)
    useBookStore.getState().setCurrentBook(structuredBook)
    usePlayerStore.setState({ currentSentenceIndex: 1 })

    const switchMarkup = renderToStaticMarkup(createElement(ModeSwitch))
    assert.match(switchMarkup, /AI 阅读/)
    assert.match(switchMarkup, /听书/)
    assert.match(switchMarkup, /aria-pressed="true"/)

    const structuredMarkup = renderToStaticMarkup(
      createElement(AiReaderContent, {
        currentBook: structuredBook,
        sentences: structuredBook.sentences,
        currentSentenceIndex: 1,
        isLoading: false
      })
    )
    assert.match(structuredMarkup, /第一章/)
    assert.match(structuredMarkup, /data-chapter-title="true"/)
    assert.match(structuredMarkup, /第二段正文/)
    assert.match(structuredMarkup, /data-active="true"/)
    assert.match(structuredMarkup, /AI 助手/)

    const immersiveMarkup = renderToStaticMarkup(
      createElement(AiReaderContent, {
        currentBook: structuredBook,
        sentences: structuredBook.sentences,
        currentSentenceIndex: 1,
        isLoading: false,
        immersive: true
      })
    )
    assert.match(immersiveMarkup, /data-ai-chat-host="mounted"/)
    assert.match(immersiveMarkup, /class="hidden"/)
    assert.match(immersiveMarkup, /AI 助手/)

    const legacyBook = createBook(false)
    const fallbackMarkup = renderToStaticMarkup(
      createElement(AiReaderContent, {
        currentBook: legacyBook,
        sentences: legacyBook.sentences,
        currentSentenceIndex: 0,
        isLoading: false
      })
    )
    assert.match(fallbackMarkup, /第一段正文/)

    assert.equal(hasEquivalentChapterHeading(structuredBook.structure![0]), false)
    assert.equal(
      hasEquivalentChapterHeading({
        ...structuredBook.structure![0],
        blocks: [
          {
            blockId: 'chapter-heading',
            type: 'heading',
            level: 1,
            text: '第一章',
            ttsSkip: true,
            sentenceRange: [0, 0]
          },
          ...structuredBook.structure![0].blocks
        ]
      }),
      true
    )

    const headingMarkup = renderToStaticMarkup(
      createElement(ContentCard, {
        block: {
          blockId: 'readable-heading',
          type: 'heading',
          level: 2,
          text: '可朗读标题',
          ttsSkip: false,
          sentenceRange: [0, 1]
        },
        sentences: ['可朗读标题'],
        currentSentenceIndex: 1,
        onSpeakRaw: async () => undefined
      })
    )
    assert.match(headingMarkup, /aria-label="朗读本段"/)
    assert.match(headingMarkup, /pr-8/)

    const paragraphMarkup = renderToStaticMarkup(
      createElement(ContentCard, {
        block: structuredBook.structure![0].blocks[0],
        sentences: structuredBook.sentences,
        currentSentenceIndex: -1
      })
    )
    assert.match(paragraphMarkup, /reader-paragraph/)
    assert.doesNotMatch(paragraphMarkup, /border-gray-200 bg-white/)

    const quoteMarkup = renderToStaticMarkup(
      createElement(ContentCard, {
        block: {
          ...structuredBook.structure![0].blocks[0],
          blockId: 'quote-block',
          type: 'quote'
        },
        sentences: structuredBook.sentences,
        currentSentenceIndex: -1
      })
    )
    assert.match(quoteMarkup, /border-l-emerald-500/)

    const globalCss = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8')
    assert.match(globalCss, /:focus-visible/)
    assert.match(globalCss, /prefers-reduced-motion:\s*reduce/)

    const readerSource = readFileSync(
      join(process.cwd(), 'src/components/reader/AiReaderView.tsx'),
      'utf8'
    )
    assert.doesNotMatch(
      readerSource,
      /const \{ currentBook, sentences, isLoading \} = useBookStore\(\)/
    )
    assert.match(readerSource, /useBookStore\(\(state\) => state\.currentBook\)/)
    assert.match(readerSource, /useBookStore\(\(state\) => state\.sentences\)/)
    assert.match(readerSource, /useBookStore\(\(state\) => state\.isLoading\)/)

    console.log('  ok renders chapter contracts, continuous paragraphs, semantic blocks, and accessible controls')
    console.log('Reader components result: 2 passed')
  } catch (error) {
    assert.fail(`reader components should satisfy the rendering contract: ${(error as Error).message}`)
  } finally {
    useBookStore.setState({ currentBook: null, sentences: [], chapters: [] })
    usePlayerStore.getState().reset()
  }
}

void run()
