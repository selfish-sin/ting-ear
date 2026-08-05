import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AiSourceRef, BookData } from '../src/global'

async function run(): Promise<void> {
  console.log('\nRAG components')
  const { default: NmemBanner } = await import('../src/components/ai/NmemBanner')
  const { default: EvidencePanel } = await import('../src/components/ai/EvidencePanel')
  const { default: CitationPopover } = await import('../src/components/ai/CitationPopover')
  const chatPanelModule = await import('../src/components/ai/AiChatPanel')
  const findSourceBlockId = (
    chatPanelModule as unknown as {
      findSourceBlockId?: (book: BookData, source: AiSourceRef) => string
    }
  ).findSourceBlockId

  const source: AiSourceRef = {
    index: 1,
    memoryId: 'memory-1',
    content: '这是一段可以核对的书内原文。',
    source: '[bookId=book-1][ch=1] 第二章',
    score: 0.91,
    bookId: 'book-1',
    chapterIndex: 1,
    chapterTitle: '第二章'
  }

  const banner = renderToStaticMarkup(
    createElement(NmemBanner, {
      status: 'offline',
      error: '无法连接',
      onRetry: async () => undefined
    })
  )
  assert.match(banner, /知识库未连接/)
  assert.match(banner, /重试/)

  const searching = renderToStaticMarkup(
    createElement(EvidencePanel, { status: 'searching', sources: [] })
  )
  assert.match(searching, /本轮引用/)
  assert.match(searching, /检索中|书内/)
  const done = renderToStaticMarkup(
    createElement(EvidencePanel, {
      status: 'done',
      sources: [source],
      webSearchUsed: true,
      webSources: [
        {
          index: 1,
          title: '示例网页',
          url: 'https://example.com/a',
          snippet: '摘要',
          provider: 'ollama',
          sourceType: '网页',
          fetchedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      toolTraces: [
        { name: 'search_book', ok: true, summary: '命中 1 条' },
        { name: 'mcp_zotero_search_items', ok: true, summary: '命中 2 条' }
      ]
    })
  )
  assert.match(done, /本轮引用/)
  assert.match(done, /书内 1/)
  assert.match(done, /联网 1/)
  assert.match(done, /MCP/)
  assert.match(done, /工具 2/)
  assert.match(done, /第二章/)
  assert.match(done, /书内记忆/)

  const citation = renderToStaticMarkup(
    createElement(CitationPopover, { source, onNavigate: () => undefined })
  )
  assert.match(citation, /\[1\]/)
  assert.match(citation, /书内原文/)
  assert.match(citation, /定位/)

  assert.equal(typeof findSourceBlockId, 'function')
  const book = {
    id: 'book-1',
    title: '测试书',
    author: '',
    filePath: '',
    format: 'md',
    sentences: ['第一段。', '真正引用位于第二段。'],
    chapters: [{ title: '第一章', startIndex: 0, sentenceCount: 2 }],
    currentChapterIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    isCompleted: false,
    addedAt: '',
    lastReadAt: '',
    structure: [
      {
        title: '第一章',
        level: 1,
        sentenceRange: [0, 2],
        blocks: [
          { blockId: 'block-1', type: 'paragraph', text: '第一段。', ttsSkip: false, sentenceRange: [0, 1] },
          { blockId: 'block-2', type: 'paragraph', text: '真正引用位于第二段。', ttsSkip: false, sentenceRange: [1, 2] }
        ]
      }
    ]
  } satisfies BookData
  assert.equal(findSourceBlockId!(book, { ...source, chapterIndex: 0, content: '引用位于第二段' }), 'block-2')

  const legacyBook: BookData = {
    ...book,
    structure: undefined,
    sentences: ['第1句', '第2句', '第3句', '第4句', '第5句', '旧书引用在第6句', '第7句'],
    chapters: [{ title: '第一章', startIndex: 0, sentenceCount: 7 }]
  }
  assert.equal(
    findSourceBlockId!(legacyBook, { ...source, chapterIndex: 0, content: '引用在第6句' }),
    'legacy-book-1-0-5'
  )

  console.log('  ok renders offline recovery, retrieval progress, and navigable citations')
  console.log('RAG components result: 1 passed')
}

void run()
