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
  assert.match(markup, /编辑/)
  assert.match(markup, /AI 对话使用/)
  assert.match(markup, /大纲生成使用/)
  assert.match(markup, /工具服务/)
  assert.match(markup, new RegExp(AI_DEFAULTS.llm.model))
  assert.doesNotMatch(markup, /API Key/)
  assert.doesNotMatch(markup, /获取模型/)

  const panelSource = readFileSync(
    new URL('../src/components/settings/AiSettingsPanel.tsx', import.meta.url),
    'utf8'
  )
  assert.match(panelSource, /MCP/)
  assert.match(panelSource, /Zotero/)
  assert.match(panelSource, /toolChoice|工具调用|Agent|agent/)
  assert.match(panelSource, /API Key/)
  assert.match(panelSource, /获取模型/)
  assert.match(panelSource, /测试连接/)
  console.log('  ok panel markup + MCP/agent source present')

  const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  const aiHandlersSource = readFileSync(
    new URL('../electron/ipc/aiHandlers.ts', import.meta.url),
    'utf8'
  )
  const fileHandlersSource = readFileSync(
    new URL('../electron/ipc/fileHandlers.ts', import.meta.url),
    'utf8'
  )
  for (const method of [
    'aiListModels',
    'aiTestModel',
    'aiNmemStatus',
    'aiNmemSyncAll',
    'aiConvEnsure',
    'aiMcpListTools',
    'aiMcpProbe'
  ]) {
    assert.match(preloadSource, new RegExp(`\\b${method}:`), `${method} must be exposed by preload`)
  }
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:model:test'/)
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:nmem:status'/)
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:conv:ensure'/)
  assert.match(aiHandlersSource, /ipcMain\.handle\('ai:mcp:probe'/)
  assert.match(fileHandlersSource, /ipcMain\.handle\('ai:nmem:sync-all'/)
  console.log('  ok AI settings actions wired through preload and IPC')

  console.log('AI settings panel result: 2 passed')
}

void run()
