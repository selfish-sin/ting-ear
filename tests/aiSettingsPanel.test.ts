import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AI_DEFAULTS } from '../src/aiSettings'

async function run(): Promise<void> {
  console.log('\nAI settings panel')
  const { default: AiSettingsPanel } = await import(
    '../src/components/settings/AiSettingsPanel'
  )
  const markup = renderToStaticMarkup(
    createElement(AiSettingsPanel, {
      value: AI_DEFAULTS,
      onChange: () => undefined
    })
  )

  assert.match(markup, /AI 引擎/)
  assert.match(markup, /添加引擎/)
  assert.match(markup, /API 地址/)
  assert.match(markup, /API Key/)
  assert.match(markup, /获取模型/)
  assert.match(markup, /测试连接/)
  assert.match(markup, /选择模型/)
  assert.match(markup, /AI 对话使用/)
  assert.match(markup, /大纲生成使用/)
  assert.match(markup, /高级设置/)
  assert.match(markup, /知识库地址/)
  assert.match(markup, /测试知识库/)
  assert.match(markup, /立即同步/)
  assert.match(markup, /自动同步新书/)
  assert.match(markup, /启用书内检索/)
  assert.doesNotMatch(markup, /防剧透/)
  assert.match(markup, new RegExp(AI_DEFAULTS.llm.model))

  console.log('  ok renders model, knowledge base, retrieval, and chat settings')

  const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  const aiHandlersSource = readFileSync(new URL('../electron/ipc/aiHandlers.ts', import.meta.url), 'utf8')
  const fileHandlersSource = readFileSync(new URL('../electron/ipc/fileHandlers.ts', import.meta.url), 'utf8')
  for (const method of ['aiListModels', 'aiTestModel', 'aiNmemStatus', 'aiNmemSyncAll']) {
    assert.match(preloadSource, new RegExp(`\\b${method}:`), `${method} must be exposed by preload`)
  }
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:model:test'/)
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:nmem:status'/)
  assert.match(fileHandlersSource, /ipcMain\.handle\('ai:nmem:sync-all'/)
  console.log('  ok keeps AI settings actions wired through preload and IPC')

  console.log('AI settings panel result: 2 passed')
}

void run()
