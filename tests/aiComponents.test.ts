import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AiChatMessage } from '../src/global'

async function run(): Promise<void> {
  console.log('\nAI components')
  const { AiChatPanelContent, clampAiPanelWidth, resolveChatFocusRequest } = await import('../src/components/ai/AiChatPanel')

  assert.equal(clampAiPanelWidth(120), 280)
  assert.equal(clampAiPanelWidth(420), 420)
  assert.equal(clampAiPanelWidth(900), 560)
  assert.equal(clampAiPanelWidth(560, 1024), 280)
  assert.equal(clampAiPanelWidth(560, 1280), 536)
  assert.equal(clampAiPanelWidth(560, 1440), 560)
  assert.equal(resolveChatFocusRequest(null, true, false), 'none')
  assert.equal(resolveChatFocusRequest(1, true, false), 'expand')
  assert.equal(resolveChatFocusRequest(1, false, false), 'wait')
  assert.equal(resolveChatFocusRequest(1, false, true), 'focus')

  const notConfigured = renderToStaticMarkup(
    createElement(AiChatPanelContent, {
      messages: [],
      isStreaming: false,
      isConfigured: false,
      onSend: async () => false,
      onCancel: async () => undefined,
      onClear: async () => undefined
    })
  )
  assert.match(notConfigured, /请先在设置中配置 AI/)

  const messages: AiChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: '**重点**\n\n- 第一项' }],
      createdAt: '2026-07-26T00:00:00.000Z',
      status: 'complete'
    }
  ]
  const configured = renderToStaticMarkup(
    createElement(AiChatPanelContent, {
      messages,
      isStreaming: false,
      isConfigured: true,
      onSend: async () => true,
      onCancel: async () => undefined,
      onClear: async () => undefined
    })
  )
  assert.match(configured, /<strong>重点<\/strong>/)
  assert.match(configured, /第一项/)
  assert.match(configured, /placeholder="问问这本书/)
  assert.match(configured, /aria-label="发送消息"/)

  assert.match(configured, /aria-label="调整 AI 助手宽度"/)
  assert.match(configured, /width:360px/)

  console.log('  ok renders configuration guidance, Markdown messages, chat controls, and a resizable sidebar')
  console.log('AI components result: 1 passed')
}

void run()
