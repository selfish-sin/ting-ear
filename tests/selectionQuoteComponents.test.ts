import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function run(): Promise<void> {
  console.log('\nSelection and quote components')

  const popupPath = resolve('src/components/ai/SelectionPopup.tsx')
  const chipsPath = resolve('src/components/ai/QuoteChips.tsx')
  assert.equal(existsSync(popupPath), true, 'SelectionPopup must replace the legacy copy bubble')
  assert.equal(existsSync(chipsPath), true, 'QuoteChips must render attached quotes')

  const popupModule = await import(pathToFileURL(popupPath).href)
  const chipsModule = await import(pathToFileURL(chipsPath).href)
  const { default: ChatInput } = await import('../src/components/ai/ChatInput')

  assert.equal(popupModule.isSelectableText('ab'), false)
  assert.equal(popupModule.isSelectableText('  abc  '), true)
  assert.deepEqual(
    popupModule.clampSelectionPopupPosition(
      { left: 0, right: 24, top: 2, bottom: 18, width: 24, height: 16 },
      { width: 320, height: 200 },
      { width: 220, height: 40 }
    ),
    { left: 8, top: 26 }
  )
  assert.deepEqual(
    popupModule.clampSelectionPopupPosition(
      { left: 300, right: 320, top: 190, bottom: 200, width: 20, height: 10 },
      { width: 320, height: 200 },
      { width: 220, height: 40 }
    ),
    { left: 92, top: 142 }
  )

  assert.equal(typeof popupModule.queueSelectionForAi, 'function')
  const selectionActions: string[] = []
  popupModule.queueSelectionForAi('准备提问的选区', {
    addQuote: (text: string) => selectionActions.push(`quote:${text}`),
    setReaderMode: (mode: string) => selectionActions.push(`mode:${mode}`),
    requestChatFocus: () => selectionActions.push('focus')
  })
  assert.deepEqual(selectionActions, ['quote:准备提问的选区', 'mode:ai-reading', 'focus'])

  // 从 Range 解析句索引
  if (typeof document !== 'undefined') {
    const host = document.createElement('div')
    const span = document.createElement('span')
    span.setAttribute('data-sentence-index', '42')
    span.textContent = '句子内容足够长'
    host.appendChild(span)
    document.body.appendChild(host)
    const range = document.createRange()
    range.selectNodeContents(span)
    assert.equal(popupModule.findSentenceIndexFromRange(range), 42)
    document.body.removeChild(host)
    console.log('  ok resolves sentence index from selection DOM')
  }

  const QuoteChips = chipsModule.default as ComponentType<{
    quotes: string[]
    onRemove: (index: number) => void
  }>
  const chipsMarkup = renderToStaticMarkup(
    createElement(QuoteChips, {
      quotes: ['第一段引用', '第二段引用'],
      onRemove: () => undefined
    })
  )
  assert.match(chipsMarkup, /第一段引用/)
  assert.match(chipsMarkup, /第二段引用/)
  assert.match(chipsMarkup, /aria-label="移除引用 1"/)
  assert.match(chipsMarkup, /aria-label="移除引用 2"/)

  const inputMarkup = renderToStaticMarkup(
    createElement(ChatInput as ComponentType<Record<string, unknown>>, {
      isStreaming: false,
      isConfigured: true,
      quotes: ['输入框引用'],
      onRemoveQuote: () => undefined,
      onSend: async () => true,
      onCancel: async () => undefined
    })
  )
  assert.match(inputMarkup, /输入框引用/)
  assert.match(inputMarkup, /id="ai-chat-input"/)

  // 工具栏源码应暴露应用专属动作
  const { readFileSync } = await import('node:fs')
  const popupSource = readFileSync(popupPath, 'utf8')
  assert.match(popupSource, /data-selection-toolbar/)
  assert.match(popupSource, /问 AI/)
  assert.match(popupSource, /朗读/)
  assert.match(popupSource, /从此播/)
  assert.match(popupSource, /Ctrl\+Shift\+Q/)

  console.log('  ok clamps the popup, queues durable chat focus, and renders removable quotes')
  console.log('Selection and quote components result: 2 passed')
}

void run()
