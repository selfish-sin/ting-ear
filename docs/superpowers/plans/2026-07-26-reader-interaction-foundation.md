# Reader Interaction Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared accessible context menu, apply it to bookshelf and AI reading actions, restore chapter-title rendering, and improve continuous reading presentation.

**Architecture:** A generic portal-based `ContextMenu` owns placement and accessibility while feature surfaces provide declarative commands. Reader presentation stays inside existing `ContentCards` and `ContentCard` boundaries, with tests driving each behavioral change.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, Node `assert`, `react-dom/server`, existing `tsx` test runner.

## Global Constraints

- Do not add a new runtime dependency.
- Preserve every existing bookshelf command and mutation handler.
- Use the existing `queueSelectionForAi` flow for reader AI actions.
- Keep native subtitle and floating-ball context menus unchanged.
- Write a failing test before each production behavior change.
- Keep all user data, settings, logs, and caches outside Git.

---

### Task 1: Shared Accessible Context Menu

**Files:**
- Create: `src/components/ui/ContextMenu.tsx`
- Create: `tests/contextMenuComponents.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ContextMenuPoint`, `ContextMenuItem`, `ContextMenuGroup`, `clampContextMenuPosition(...)`, `ContextMenuSurface`, and default `ContextMenu`.
- Consumes: React portals and existing Tailwind tokens only.

- [ ] **Step 1: Write placement and semantics tests**

Add tests that assert a 208x420 menu opened at `(1180, 760)` in a `1200x800` viewport resolves to `{ left: 984, top: 372 }`, small viewports retain an 8 px margin, and `ContextMenuSurface` renders `role="menu"`, grouped separators, disabled items, and danger styling.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx tests/contextMenuComponents.test.ts`

Expected: FAIL because `src/components/ui/ContextMenu.tsx` does not exist.

- [ ] **Step 3: Implement the minimal menu**

Implement declarative groups, pure placement, portal rendering, measured repositioning, `max-height: calc(100vh - 16px)`, overflow scrolling, outside pointer/scroll/resize dismissal, Escape, ArrowUp/ArrowDown/Home/End navigation, and focus restoration.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx tests/contextMenuComponents.test.ts`

Expected: all context-menu tests pass.

- [ ] **Step 5: Register the test**

Append `tsx tests/contextMenuComponents.test.ts` to the existing `npm test` script without changing the order of existing tests.

### Task 2: Bookshelf Menu Migration

**Files:**
- Modify: `src/components/BookShelf.tsx`
- Modify: `tests/contextMenuComponents.test.ts`

**Interfaces:**
- Consumes: `ContextMenu`, `ContextMenuGroup`, and existing book handlers.
- Produces: one declarative command list used by right-click and overflow triggers.

- [ ] **Step 1: Add failing bookshelf integration assertions**

Read `BookShelf.tsx` as source and assert it imports the shared context menu, renders an accessible `更多书籍操作` trigger in grid and list layouts, and no longer renders the old fixed raw-coordinate menu container.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx tests/contextMenuComponents.test.ts`

Expected: FAIL because `BookShelf` still contains the custom fixed menu.

- [ ] **Step 3: Replace the old menu with command groups**

Keep `contextMenu` book and point state, add the triggering element, build grouped items from existing callbacks, render shared `ContextMenu`, and add overflow buttons to both book views. Close the menu before actions that open dialogs or begin async work.

- [ ] **Step 4: Run focused and existing bookshelf-adjacent tests**

Run: `npx tsx tests/contextMenuComponents.test.ts && npx tsx tests/bookStore.test.ts`

Expected: both commands pass.

### Task 3: Reader Context Actions and Chapter Contract

**Files:**
- Modify: `src/components/reader/ContentCards.tsx`
- Modify: `src/components/reader/AiReaderView.tsx`
- Modify: `tests/readerComponents.test.ts`
- Modify: `tests/contextMenuComponents.test.ts`

**Interfaces:**
- Consumes: `ContextMenu`, `queueSelectionForAi`, `useAiStore`, `useBookStore`, `onSpeakRaw`, `onSeekToChapter`.
- Produces: `hasEquivalentChapterHeading(chapter)` and block/selection context actions.

- [ ] **Step 1: Add failing chapter and reader-menu tests**

Assert a chapter title renders when blocks omit a matching heading, does not duplicate when the first heading matches, and reader source wires copy, quote, ask-AI, read-aloud, and play-from-here commands through the shared menu.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx tsx tests/readerComponents.test.ts && npx tsx tests/contextMenuComponents.test.ts`

Expected: reader test fails on the missing chapter title and context-action assertions fail.

- [ ] **Step 3: Implement chapter title and reader commands**

Render an `h1` chapter header only when no equivalent first heading exists. Snapshot selected text or block text at context-menu open, pass `onSeekToChapter` from `AiReaderView`, and invoke existing quote/focus actions for AI commands.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx tsx tests/readerComponents.test.ts && npx tsx tests/contextMenuComponents.test.ts && npx tsx tests/selectionQuoteComponents.test.ts`

Expected: all three commands pass.

### Task 4: Continuous Reading and Keyboard Focus

**Files:**
- Modify: `src/components/reader/ContentCard.tsx`
- Modify: `src/styles/globals.css`
- Modify: `tests/readerComponents.test.ts`

**Interfaces:**
- Consumes: existing block types and global component classes.
- Produces: unframed normal paragraphs, preserved semantic surfaces, global `focus-visible`, and reduced-motion behavior.

- [ ] **Step 1: Add failing presentation assertions**

Assert normal paragraph markup uses a stable `reader-paragraph` class without `border-gray-200 bg-white`, while quote/code/note branches retain specialized classes. Assert global CSS contains `:focus-visible` and `prefers-reduced-motion: reduce`.

- [ ] **Step 2: Run the reader test and verify RED**

Run: `npx tsx tests/readerComponents.test.ts`

Expected: FAIL on paragraph and global accessibility assertions.

- [ ] **Step 3: Implement presentation and accessibility CSS**

Use an unframed paragraph surface with a subtle active left marker, retain framed quote/code/note treatments, add a global keyboard focus ring, and disable nonessential animation/transition behavior for reduced motion.

- [ ] **Step 4: Run the reader test and verify GREEN**

Run: `npx tsx tests/readerComponents.test.ts`

Expected: all reader component tests pass.

### Task 5: Performance Cleanup and Verification

**Files:**
- Modify: `src/components/reader/AiReaderView.tsx`
- Modify: `CONTEXT.md`
- Modify: `.trellis/tasks/07-26-reader-interaction-foundation/verification.md`

**Interfaces:**
- Consumes: Zustand selector API and the completed UI behaviors.
- Produces: narrow reader-store subscriptions and final verification record.

- [ ] **Step 1: Add a source assertion for narrow store subscriptions**

Extend the reader test to reject `const { currentBook, sentences, isLoading } = useBookStore()` and require explicit selector subscriptions.

- [ ] **Step 2: Run the reader test and verify RED**

Run: `npx tsx tests/readerComponents.test.ts`

Expected: FAIL on the whole-store subscription.

- [ ] **Step 3: Replace the whole-store subscription**

Subscribe separately to `currentBook`, `sentences`, and `isLoading` selectors so playback and unrelated book-store updates do not rerender the reader root.

- [ ] **Step 4: Run full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build`

Expected: all commands exit 0 with no test failures. Record any pre-existing lint warning explicitly if it remains.

- [ ] **Step 5: Update project memory**

Update `CONTEXT.md` with the shared context-menu file, its reading conditions, the reader context-action flow, chapter-title rule, current status, and exact verification commands. Write the verification summary into the Trellis task.
