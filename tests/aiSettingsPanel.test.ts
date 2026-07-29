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

  // 列表/缩略视图：不展开整页表单
  assert.match(markup, /AI 引擎/)
  assert.match(markup, /添加引擎/)
  assert.match(markup, /编辑/)
  assert.match(markup, /AI 对话使用/)
  assert.match(markup, /大纲生成使用/)
  assert.match(markup, /知识库/)
  assert.match(markup, /章节大纲/)
  assert.match(markup, /高级设置/)
  // 模型名应出现在缩略卡摘要里
  assert.match(markup, new RegExp(AI_DEFAULTS.llm.model))
  // 详情字段默认收起，避免首屏过长
  assert.doesNotMatch(markup, /API Key/)
  assert.doesNotMatch(markup, /获取模型/)
  assert.doesNotMatch(markup, /防剧透/)

  console.log('  ok compact card list for engines / knowledge / outline')

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

  // 源码仍含详情编辑能力（点编辑后）
  const panelSource = readFileSync(
    new URL('../src/components/settings/AiSettingsPanel.tsx', import.meta.url),
    'utf8'
  )
  for (const token of ['API Key', '获取模型', '测试连接', '选择模型', '测试知识库', '立即同步', '知识库地址']) {
    assert.match(panelSource, new RegExp(token), `detail UI must still include ${token}`)
  }
  console.log('  ok detail editor still contains full engine fields')

  console.log('AI settings panel result: 3 passed')
}

void run()
