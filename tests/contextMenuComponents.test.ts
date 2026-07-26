import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ContextMenuSurface,
  clampContextMenuPosition,
  type ContextMenuGroup
} from '../src/components/ui/ContextMenu'

function run(): void {
  console.log('\nContext menu components')

  const bottomRight = clampContextMenuPosition(
    { x: 1180, y: 760 },
    { width: 208, height: 420 },
    { width: 1200, height: 800 }
  )
  assert.deepEqual(bottomRight, { left: 984, top: 372 })
  console.log('  ok clamps a long menu inside the bottom-right viewport edge')

  const smallViewport = clampContextMenuPosition(
    { x: 90, y: 80 },
    { width: 208, height: 420 },
    { width: 160, height: 120 }
  )
  assert.deepEqual(smallViewport, { left: 8, top: 8 })
  console.log('  ok retains a viewport margin when the menu is larger than the viewport')

  const groups: ContextMenuGroup[] = [
    {
      id: 'reading',
      items: [
        { id: 'open', label: '打开阅读', onSelect: () => undefined },
        { id: 'disabled', label: '暂不可用', disabled: true, onSelect: () => undefined }
      ]
    },
    {
      id: 'danger',
      items: [{ id: 'delete', label: '删除书籍', danger: true, onSelect: () => undefined }]
    }
  ]
  const markup = renderToStaticMarkup(
    React.createElement(ContextMenuSurface, {
      ariaLabel: '书籍操作',
      groups,
      position: { left: 24, top: 32 },
      menuRef: { current: null },
      onRequestClose: () => undefined
    })
  )
  assert.match(markup, /role="menu"/)
  assert.match(markup, /aria-label="书籍操作"/)
  assert.match(markup, /role="menuitem"/)
  assert.match(markup, /role="separator"/)
  assert.match(markup, /disabled=""/)
  assert.match(markup, /text-red-600/)
  console.log('  ok renders menu semantics, groups, disabled state, and danger styling')

  const bookshelfSource = readFileSync(
    join(process.cwd(), 'src/components/BookShelf.tsx'),
    'utf8'
  )
  assert.match(bookshelfSource, /\.\/ui\/ContextMenu/)
  assert.equal(
    bookshelfSource.match(/aria-label="更多书籍操作"/g)?.length,
    2,
    'grid and list views should both expose book action triggers'
  )
  assert.doesNotMatch(
    bookshelfSource,
    /className="fixed z-50 bg-white\/95/,
    'the raw fixed-coordinate bookshelf menu should be removed'
  )
  console.log('  ok bookshelf uses the shared menu with visible grid and list triggers')

  const readerSource = readFileSync(
    join(process.cwd(), 'src/components/reader/ContentCards.tsx'),
    'utf8'
  )
  assert.match(readerSource, /\.\.\/ui\/ContextMenu/)
  assert.match(readerSource, /从此处播放/)
  assert.match(readerSource, /朗读本段/)
  assert.match(readerSource, /复制/)
  assert.match(readerSource, /引用/)
  assert.match(readerSource, /问 AI/)
  assert.match(readerSource, /queueSelectionForAi/)
  console.log('  ok reader uses shared block and selected-text context actions')
}

run()
